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

  const availableRows = await db
    .select({ commissionAmount: partnerCommissions.commissionAmount, id: partnerCommissions.id })
    .from(partnerCommissions)
    .where(
      and(
        eq(partnerCommissions.partnerId, session.userId),
        eq(partnerCommissions.status, "available")
      )
    )

  const totalAvailable = availableRows.reduce((s, r) => s + r.commissionAmount, 0)
  if (amount > totalAvailable) {
    return NextResponse.json({ error: "可提现余额不足" }, { status: 400 })
  }

  const outBatchNo = `WD-${Date.now().toString(36).toUpperCase()}-${randomUUID().replace(/-/g, "").substring(0, 6).toUpperCase()}`
  const requestId = randomUUID()
  const appId = process.env.WECHAT_APP_ID ?? process.env.NEXT_PUBLIC_WECHAT_APP_ID ?? ""

  try {
    if (!isWeChatPayConfigured()) throw new Error("微信支付未配置，请联系管理员")

    const { batchId } = await wechatTransferBatch({
      appId,
      outBatchNo,
      openid: partner.wechatOpenid,
      amount,
      remark: "TypeNow 合伙人佣金提现",
    })

    await db.insert(withdrawalRequests).values({
      id: requestId,
      partnerId: session.userId,
      amount,
      wechatOpenid: partner.wechatOpenid,
      partnerTradeNo: outBatchNo,
      wxTransferId: batchId,
      status: "completed",
      completedAt: new Date(),
    })

    // Mark used commissions as withdrawn (FIFO)
    let remaining = amount
    for (const row of availableRows) {
      if (remaining <= 0) break
      await db
        .update(partnerCommissions)
        .set({ status: "withdrawn" })
        .where(eq(partnerCommissions.id, row.id))
      remaining -= row.commissionAmount
    }

    return NextResponse.json({ success: true, amount, outBatchNo })
  } catch (e) {
    const failReason = e instanceof Error ? e.message : String(e)
    await db.insert(withdrawalRequests).values({
      id: requestId,
      partnerId: session.userId,
      amount,
      wechatOpenid: partner.wechatOpenid,
      partnerTradeNo: outBatchNo,
      status: "failed",
      failReason,
    })
    console.error("Withdrawal failed:", e)
    return NextResponse.json({ error: "提现失败，请联系客服处理" }, { status: 500 })
  }
}
