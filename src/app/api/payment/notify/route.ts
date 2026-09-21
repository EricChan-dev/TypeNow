import { NextResponse } from "next/server"
import { verifyNotifySignature, decryptNotifyResource } from "@/lib/wechat-pay"
import { activateSubscription } from "@/lib/subscription"
import { db } from "@/lib/db"
import { paymentOrders, partnerCommissions, subscriptions, users } from "@/lib/db/schema"
import { eq, and, desc } from "drizzle-orm"

/**
 * WeChat Pay v3 callback notification handler.
 * Handles both TRANSACTION.SUCCESS (payment) and REFUND.SUCCESS (refund) events.
 *
 * Notification JSON structure (v3):
 *   { id, create_time, resource_type, event_type, summary, resource: { algorithm, ciphertext, associated_data, nonce, original_type } }
 *
 * Decrypted resource fields:
 *   - Payment: { out_trade_no, transaction_id, trade_state, ... }
 *   - Refund:  { out_trade_no, out_refund_no, refund_status, ... }
 *
 * 安全约束（不要放宽）：
 *   1. 报文只能来自加密的 resource，不接受 body 顶层明文兜底；
 *   2. 验签不通过一律 401（未配置微信支付时，verifyNotifySignature 在生产
 *      环境返回 false，不会再 fail-open）；
 *   3. 订单状态用条件更新原子占用，重复/并发回调只会生效一次；
 *   4. 激活失败要回退为 pending，保证微信重试能真正补开会员。
 */

/** drizzle 的 mysql2 update 返回 [ResultSetHeader, ...] */
function affectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number } | undefined
    return Number(header?.affectedRows ?? 0)
  }
  return 0
}

export async function POST(request: Request) {
  try {
    const body = await request.text()
    const signature = request.headers.get("Wechatpay-Signature") || ""
    const timestamp = request.headers.get("Wechatpay-Timestamp") || ""
    const nonce = request.headers.get("Wechatpay-Nonce") || ""
    const serialNo = request.headers.get("Wechatpay-Serial") || ""

    if (!(await verifyNotifySignature(timestamp, nonce, body, signature, serialNo))) {
      return NextResponse.json({ code: "FAIL", message: "Invalid signature" }, { status: 401 })
    }

    const notify = JSON.parse(body)
    const eventType = notify.event_type as string | undefined

    // ── Refund notification ──────────────────────────────────────────────
    if (eventType === "REFUND.SUCCESS") {
      return handleRefund(notify)
    }

    // ── Payment notification ─────────────────────────────────────────────
    const rawResource = notify.resource as
      | { ciphertext: string; nonce: string; associated_data?: string }
      | undefined

    if (!rawResource?.ciphertext) {
      return NextResponse.json({ code: "FAIL", message: "Missing resource" }, { status: 400 })
    }

    type PaymentResource = { out_trade_no: string; transaction_id: string; trade_state: string }
    const resource = decryptNotifyResource(
      rawResource.ciphertext,
      rawResource.nonce,
      rawResource.associated_data || "",
    ) as PaymentResource

    const outTradeNo = resource.out_trade_no
    const transactionId = resource.transaction_id
    const tradeState = resource.trade_state

    if (!outTradeNo) {
      return NextResponse.json({ code: "FAIL", message: "Missing out_trade_no" }, { status: 400 })
    }

    if (tradeState !== "SUCCESS") {
      return NextResponse.json({ code: "SUCCESS", message: "OK" })
    }

    if (!db) {
      return NextResponse.json({ code: "FAIL", message: "Service not configured" }, { status: 500 })
    }

    const [existing] = await db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.outTradeNo, outTradeNo))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ code: "FAIL", message: "Order not found" }, { status: 404 })
    }

    // 原子占用订单：并发或重复回调只有一个能把 pending 翻成 paid，避免同一笔
    // 订单被激活两次（会员时长翻倍 + 重复佣金）。
    const updateResult = await db
      .update(paymentOrders)
      .set({ status: "paid", transactionId: transactionId, paidAt: new Date() })
      .where(and(eq(paymentOrders.id, existing.id), eq(paymentOrders.status, "pending")))

    if (affectedRows(updateResult) === 0) {
      // 已支付，或已被其它并发回调抢先处理
      return NextResponse.json({ code: "SUCCESS", message: "OK" })
    }

    try {
      await activateSubscription(existing.userId, existing.plan, existing.id, existing.amount)
    } catch (err) {
      // 激活失败则回退为 pending，让微信的重试能重新激活。否则订单已经是
      // paid，重试会在幂等分支被直接放行，永久留下"钱已收到但会员没开通"。
      console.error("[Notify] 订阅激活失败，回退订单状态以便重试:", err)
      await db
        .update(paymentOrders)
        .set({ status: "pending" })
        .where(eq(paymentOrders.id, existing.id))
        .catch(() => {
          /* 回退失败需要人工介入 */
        })
      return NextResponse.json({ code: "FAIL", message: "Activation failed" }, { status: 500 })
    }

    return NextResponse.json({ code: "SUCCESS", message: "OK" })
  } catch (err) {
    console.error("Notify error:", err)
    return NextResponse.json({ code: "FAIL", message: "Internal error" }, { status: 500 })
  }
}

/**
 * Handle REFUND.SUCCESS notification.
 * Claws back all commissions tied to the refunded order, and revokes the
 * membership that order had granted.
 */
async function handleRefund(notify: Record<string, unknown>): Promise<NextResponse> {
  if (!db) {
    return NextResponse.json({ code: "FAIL", message: "Service not configured" }, { status: 500 })
  }

  const resource = notify.resource as
    | { ciphertext: string; nonce: string; associated_data?: string }
    | undefined

  if (!resource?.ciphertext) {
    // 过去这里会把 body 顶层当成退款数据解析，等于给伪造退款留了明文通道。
    console.warn("[Notify] REFUND.SUCCESS 缺少加密 resource，已拒绝")
    return NextResponse.json({ code: "FAIL", message: "Missing resource" }, { status: 400 })
  }

  const refundData = decryptNotifyResource(
    resource.ciphertext,
    resource.nonce,
    resource.associated_data || "",
  ) as { out_trade_no?: string; out_refund_no?: string; refund_status?: string }

  const outTradeNo = refundData.out_trade_no
  const refundStatus = refundData.refund_status

  if (!outTradeNo) {
    console.warn("[Notify] REFUND.SUCCESS without out_trade_no — ignored")
    return NextResponse.json({ code: "SUCCESS", message: "OK" })
  }

  if (refundStatus !== "SUCCESS") {
    // Refund is still processing — acknowledge to stop WeChat retries
    return NextResponse.json({ code: "SUCCESS", message: "OK" })
  }

  // Locate the original payment order
  const [order] = await db
    .select({ id: paymentOrders.id, status: paymentOrders.status, userId: paymentOrders.userId })
    .from(paymentOrders)
    .where(eq(paymentOrders.outTradeNo, outTradeNo))
    .limit(1)

  if (!order) {
    console.warn(`[Notify] REFUND.SUCCESS for unknown order: ${outTradeNo}`)
    return NextResponse.json({ code: "SUCCESS", message: "OK" })
  }

  // Mark order as refunded
  await db
    .update(paymentOrders)
    .set({ status: "cancelled" })
    .where(eq(paymentOrders.id, order.id))

  // Claw back all commissions tied to this order
  await db
    .update(partnerCommissions)
    .set({ status: "clawed_back" })
    .where(eq(partnerCommissions.orderId, order.id))

  // 撤销该笔订单开通的订阅与会员权益。此前只把订单标记为 cancelled，会员依然
  // 有效，等于退款后权益不回收。
  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.paymentOrderId, order.id))
    .limit(1)

  if (sub) {
    await db
      .update(subscriptions)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(subscriptions.id, sub.id))

    // 按剩余的有效订阅重算会员，避免误伤还有其它有效订阅的用户
    const [remaining] = await db
      .select({ expiresAt: subscriptions.expiresAt })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, order.userId), eq(subscriptions.status, "active")))
      .orderBy(desc(subscriptions.expiresAt))
      .limit(1)

    const stillPro = Boolean(remaining?.expiresAt && new Date(remaining.expiresAt) > new Date())
    await db
      .update(users)
      .set({
        isPro: stillPro ? 1 : 0,
        proExpires: stillPro && remaining ? remaining.expiresAt : null,
      })
      .where(eq(users.id, order.userId))
  }

  console.log(
    `[Notify] REFUND.SUCCESS: order ${outTradeNo} refunded, commissions clawed back, membership revoked`,
  )

  return NextResponse.json({ code: "SUCCESS", message: "OK" })
}
