import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { queryOrder } from "@/lib/wechat-pay"

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseClient()
    if (!supabase) {
      return NextResponse.json({ error: "服务未配置" }, { status: 500 })
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const outTradeNo = searchParams.get("out_trade_no")
    if (!outTradeNo) {
      return NextResponse.json({ error: "Missing out_trade_no" }, { status: 400 })
    }

    const serviceClient = createServiceClient()
    if (!serviceClient) {
      return NextResponse.json({ error: "服务未配置" }, { status: 500 })
    }

    const { data: order } = await serviceClient
      .from("payment_orders")
      .select("id, status, plan")
      .eq("out_trade_no", outTradeNo)
      .eq("user_id", session.user.id)
      .maybeSingle()

    if (!order) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 })
    }

    // If still pending, check WeChat for real-time status
    if (order.status === "pending") {
      try {
        const wxOrder = await queryOrder(outTradeNo)
        if (wxOrder.trade_state === "SUCCESS") {
          await serviceClient
            .from("payment_orders")
            .update({
              status: "paid",
              transaction_id: wxOrder.transaction_id,
              paid_at: new Date().toISOString(),
            })
            .eq("out_trade_no", outTradeNo)

          const { activateSubscription } = await import("@/lib/subscription")
          await activateSubscription(session.user.id, order.plan as "monthly" | "yearly", order.id)

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
