import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import {
  createNativeOrder,
  generateOutTradeNo,
  getPlanAmount,
  getPlanDescription,
} from "@/lib/wechat-pay"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseClient()
    if (!supabase) {
      return NextResponse.json({ error: "服务未配置" }, { status: 500 })
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 })
    }

    const { plan } = await request.json()
    if (plan !== "monthly" && plan !== "yearly") {
      return NextResponse.json({ error: "无效的订阅方案" }, { status: 400 })
    }

    const outTradeNo = generateOutTradeNo()
    const amount = getPlanAmount(plan)
    const description = getPlanDescription(plan)

    const { code_url } = await createNativeOrder({
      plan,
      outTradeNo,
      description,
      amount,
    })

    const serviceClient = createServiceClient()
    if (!serviceClient) {
      return NextResponse.json({ error: "服务未配置" }, { status: 500 })
    }

    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)

    const { error } = await serviceClient.from("payment_orders").insert({
      user_id: session.user.id,
      plan,
      amount,
      out_trade_no: outTradeNo,
      code_url,
      status: "pending",
      expires_at: expiresAt.toISOString(),
    })

    if (error) {
      return NextResponse.json({ error: "创建订单失败" }, { status: 500 })
    }

    return NextResponse.json({
      code_url,
      out_trade_no: outTradeNo,
      amount,
      plan,
    })
  } catch (err) {
    console.error("Create order error:", err)
    return NextResponse.json({ error: "创建订单失败，请稍后重试" }, { status: 500 })
  }
}
