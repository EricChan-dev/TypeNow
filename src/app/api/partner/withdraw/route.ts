import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { partnerCommissions, withdrawalRequests, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, and } from "drizzle-orm"
import { randomUUID } from "crypto"
import { wechatTransferBatch, isWeChatPayConfigured } from "@/lib/wechat-pay"

const MIN_WITHDRAW = 5000 // ¥50 in fen

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  const [partner] = await db
    .select({ isPartner: users.isPartner, wechatOpenid: users.wechatOpenid })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!partner?.isPartner) {
    return NextResponse.json({ error: "您还不是合伙人" }, { status: 403 })
  }

  if (!partner.wechatOpenid) {
    return NextResponse.json({ error: "请先绑定微信账号以接收转账" }, { status: 400 })
  }

  let body: { amount?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const amount = Math.floor(Number(body.amount))
  if (!amount || amount < MIN_WITHDRAW) {
    return NextResponse.json({ error: `最低提现金额为 ¥${MIN_WITHDRAW / 100}` }, { status: 400 })
  }

  const outBatchNo = `WD-${Date.now().toString(36).toUpperCase()}-${randomUUID().replace(/-/g, "").substring(0, 6).toUpperCase()}`
  const requestId = randomUUID()
  const appId = process.env.WECHAT_APP_ID ?? process.env.NEXT_PUBLIC_WECHAT_APP_ID ?? ""

  // ── Step 1: Atomically claim commissions ──────────────────────────────────
  // FOR UPDATE locks the rows so concurrent withdrawals on the same partner
  // serialize at the DB level — no double-withdrawal possible.
  let lockedAmount = 0
  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: partnerCommissions.id,
          commissionAmount: partnerCommissions.commissionAmount,
        })
        .from(partnerCommissions)
        .where(
          and(
            eq(partnerCommissions.partnerId, session.userId),
            eq(partnerCommissions.status, "available"),
          ),
        )
        .for("update")

      lockedAmount = rows.reduce((s: number, r) => s + r.commissionAmount, 0)

      if (lockedAmount === 0) {
        throw new Error("INSUFFICIENT_BALANCE")
      }

      // Full-withdrawal-only policy: the requested amount must equal
      // the actually-locked amount (which is race-free).
      if (amount !== lockedAmount) {
        throw new Error("PARTIAL_NOT_ALLOWED")
      }

      await tx
        .update(partnerCommissions)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(partnerCommissions.partnerId, session.userId),
            eq(partnerCommissions.status, "available"),
          ),
        )
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === "INSUFFICIENT_BALANCE") {
      return NextResponse.json({ error: "可提现余额不足" }, { status: 400 })
    }
    if (msg === "PARTIAL_NOT_ALLOWED") {
      return NextResponse.json({
        error: `当前只能全额提现 ¥${(lockedAmount / 100).toFixed(2)}，不支持部分提现。请提现全部可提余额`,
      }, { status: 400 })
    }
    // Unexpected error — re-throw to 500
    console.error("[Withdraw] Claim transaction failed:", e)
    return NextResponse.json({ error: "提现失败，请稍后重试" }, { status: 500 })
  }

  // ── Step 2: WeChat transfer (outside transaction) ─────────────────────────
  try {
    if (!isWeChatPayConfigured()) throw new Error("微信支付未配置，请联系管理员")

    const { batchId } = await wechatTransferBatch({
      appId,
      outBatchNo,
      openid: partner.wechatOpenid,
      amount: lockedAmount,
      remark: "TypeNow 合伙人佣金提现",
    })

    await db.insert(withdrawalRequests).values({
      id: requestId,
      partnerId: session.userId,
      amount: lockedAmount,
      wechatOpenid: partner.wechatOpenid,
      partnerTradeNo: outBatchNo,
      wxTransferId: batchId,
      status: "completed",
      completedAt: new Date(),
    })

    return NextResponse.json({ success: true, amount: lockedAmount, outBatchNo })
  } catch (e) {
    // ── Step 3: Rollback — atomically restore commission status ────────────
    const failReason = e instanceof Error ? e.message : String(e)
    console.error("[Withdraw] Transfer failed, rolling back:", failReason)

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(partnerCommissions)
          .set({ status: "available" })
          .where(
            and(
              eq(partnerCommissions.partnerId, session.userId),
              eq(partnerCommissions.status, "withdrawn"),
            ),
          )

        await tx.insert(withdrawalRequests).values({
          id: requestId,
          partnerId: session.userId,
          amount: lockedAmount,
          wechatOpenid: partner.wechatOpenid,
          partnerTradeNo: outBatchNo,
          status: "failed",
          failReason,
        })
      })
    } catch (rollbackErr) {
      // If rollback also fails, the commission rows stay in "withdrawn" state.
      // This is an emergency situation requiring manual intervention.
      console.error("[Withdraw] CRITICAL: Rollback transaction failed!", rollbackErr)
    }

    return NextResponse.json({ error: "提现失败，请联系客服处理" }, { status: 500 })
  }
}
