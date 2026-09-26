import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, and } from "drizzle-orm"
import { queryOrder } from "@/lib/wechat-pay"
import { activateSubscription } from "@/lib/subscription"
import { affectedRows } from "@/lib/db/affected-rows"

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
          // 原子占用订单：与 /api/payment/notify 使用同一套条件更新。
          // 此前这里是无条件 UPDATE，如果用户在支付页轮询的同时微信回调到达，
          // 两条路径都会各自调用 activateSubscription，会员时长被开两次。
          const updateResult = await db
            .update(paymentOrders)
            .set({ status: "paid", transactionId: wxOrder.transaction_id, paidAt: new Date() })
            .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "pending")))

          if (affectedRows(updateResult) > 0) {
            await activateSubscription(
              session.userId,
              order.plan as "monthly" | "yearly" | "partner",
              order.id,
              order.amount
            )
            return NextResponse.json({ status: "paid", plan: order.plan })
          }

          // 抢单失败说明回调/另一次轮询已经处理过，回读真实状态再应答
          const [fresh] = await db
            .select({ status: paymentOrders.status, plan: paymentOrders.plan })
            .from(paymentOrders)
            .where(eq(paymentOrders.id, order.id))
            .limit(1)
          return NextResponse.json({ status: fresh?.status ?? "paid", plan: fresh?.plan ?? order.plan })
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
