import { NextResponse } from "next/server"
import { verifyNotifySignature, decryptNotifyResource } from "@/lib/wechat-pay"
import { activateSubscription } from "@/lib/subscription"
import { db } from "@/lib/db"
import { paymentOrders, partnerCommissions } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

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
 */
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

    // ── Payment notification (existing flow) ─────────────────────────────
    const rawResource = notify.resource as
      | { ciphertext: string; nonce: string; associated_data?: string }
      | undefined

    type PaymentResource = { out_trade_no: string; transaction_id: string; trade_state: string }
    const resource: PaymentResource | null = rawResource
      ? (decryptNotifyResource(
          rawResource.ciphertext,
          rawResource.nonce,
          rawResource.associated_data || "",
        ) as PaymentResource)
      : null

    // Fallback: if no resource field, the body itself may be the plain order data
    const outTradeNo = resource?.out_trade_no ?? (notify.out_trade_no as string)
    const transactionId = resource?.transaction_id ?? (notify.transaction_id as string)
    const tradeState = resource?.trade_state ?? (notify.trade_state as string)

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

    if (existing.status === "paid") {
      return NextResponse.json({ code: "SUCCESS", message: "OK" })
    }

    await db
      .update(paymentOrders)
      .set({ status: "paid", transactionId: transactionId, paidAt: new Date() })
      .where(eq(paymentOrders.id, existing.id))

    await activateSubscription(existing.userId, existing.plan, existing.id, existing.amount)

    return NextResponse.json({ code: "SUCCESS", message: "OK" })
  } catch (err) {
    console.error("Notify error:", err)
    return NextResponse.json({ code: "FAIL", message: "Internal error" }, { status: 500 })
  }
}

/**
 * Handle REFUND.SUCCESS notification.
 * Claws back all commissions associated with the refunded order.
 */
async function handleRefund(notify: Record<string, unknown>): Promise<NextResponse> {
  if (!db) {
    return NextResponse.json({ code: "FAIL", message: "Service not configured" }, { status: 500 })
  }

  const resource = notify.resource as
    | { ciphertext: string; nonce: string; associated_data?: string }
    | undefined

  let refundData: { out_trade_no?: string; out_refund_no?: string; refund_status?: string }
  if (resource) {
    refundData = decryptNotifyResource(
      resource.ciphertext,
      resource.nonce,
      resource.associated_data || "",
    ) as Record<string, string>
  } else {
    // Fallback: body itself is the refund data (non-encrypted / dev mode)
    refundData = notify as Record<string, string>
  }

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
    .select({ id: paymentOrders.id, status: paymentOrders.status })
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
  const result = await db
    .update(partnerCommissions)
    .set({ status: "clawed_back" })
    .where(eq(partnerCommissions.orderId, order.id))

  console.log(
    `[Notify] REFUND.SUCCESS: order ${outTradeNo} refunded, commissions clawed back`,
  )

  return NextResponse.json({ code: "SUCCESS", message: "OK" })
}
