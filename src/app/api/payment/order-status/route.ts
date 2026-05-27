import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, and } from "drizzle-orm"
import { queryOrder } from "@/lib/wechat-pay"
import { activateSubscription } from "@/lib/subscription"

export async function GET(request: Request) {
  try {
    if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const outTradeNo = searchParams.get("out_trade_no")
    if (!outTradeNo) return NextResponse.json({ error: "Missing out_trade_no" }, { status: 400 })

    const [order] = await db
      .select({ id: paymentOrders.id, status: paymentOrders.status, plan: paymentOrders.plan, amount: paymentOrders.amount })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.outTradeNo, outTradeNo), eq(paymentOrders.userId, session.userId)))
      .limit(1)

    if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 })

    if (order.status === "pending") {
      try {
        const wxOrder = await queryOrder(outTradeNo)
        if (wxOrder.trade_state === "SUCCESS") {
          await db
            .update(paymentOrders)
            .set({ status: "paid", transactionId: wxOrder.transaction_id, paidAt: new Date() })
            .where(eq(paymentOrders.outTradeNo, outTradeNo))

          await activateSubscription(session.userId, order.plan as "monthly" | "yearly" | "partner", order.id, order.amount)
          return NextResponse.json({ status: "paid", plan: order.plan })
        }
      } catch {
        // WeChat query failed, rely on local status
      }
    }

    return NextResponse.json({ status: order.status, plan: order.plan })
  } catch (err) {
    console.error("Order status error:", err)
    return NextResponse.json({ error: "查询失败" }, { status: 500 })
  }
}
