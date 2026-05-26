import { NextResponse } from "next/server"
import { verifyNotifySignature } from "@/lib/wechat-pay"
import { activateSubscription } from "@/lib/subscription"
import { db } from "@/lib/db"
import { paymentOrders } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export async function POST(request: Request) {
  try {
    const body = await request.text()
    const signature = request.headers.get("Wechatpay-Signature") || ""
    const timestamp = request.headers.get("Wechatpay-Timestamp") || ""
    const nonce = request.headers.get("Wechatpay-Nonce") || ""

    if (!verifyNotifySignature(timestamp, nonce, body, signature)) {
      return NextResponse.json({ code: "FAIL", message: "Invalid signature" }, { status: 401 })
    }

    const notify = JSON.parse(body)
    const { out_trade_no, transaction_id, trade_state } = notify

    if (trade_state !== "SUCCESS") {
      return NextResponse.json({ code: "SUCCESS", message: "OK" })
    }

    if (!db) {
      return NextResponse.json({ code: "FAIL", message: "Service not configured" }, { status: 500 })
    }

    const [existing] = await db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.outTradeNo, out_trade_no))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ code: "FAIL", message: "Order not found" }, { status: 404 })
    }

    if (existing.status === "paid") {
      return NextResponse.json({ code: "SUCCESS", message: "OK" })
    }

    await db
      .update(paymentOrders)
      .set({ status: "paid", transactionId: transaction_id, paidAt: new Date() })
      .where(eq(paymentOrders.id, existing.id))

    await activateSubscription(existing.userId, existing.plan, existing.id)

    return NextResponse.json({ code: "SUCCESS", message: "OK" })
  } catch (err) {
    console.error("Notify error:", err)
    return NextResponse.json({ code: "FAIL", message: "Internal error" }, { status: 500 })
  }
}
