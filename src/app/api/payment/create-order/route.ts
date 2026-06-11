import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import {
  createNativeOrder,
  generateOutTradeNo,
  getPlanAmount,
  getPlanDescription,
} from "@/lib/wechat-pay"

export async function POST(request: Request) {
  try {
    if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

    const { plan } = await request.json()
    if (plan !== "monthly" && plan !== "yearly" && plan !== "partner") {
      return NextResponse.json({ error: "无效的订阅方案" }, { status: 400 })
    }

    const outTradeNo = generateOutTradeNo()
    const isTestMode = process.env.NODE_ENV === "development" || process.env.WECHAT_PAY_TEST_MODE === "true"
    const amount = isTestMode ? 1 : getPlanAmount(plan)
    const description = getPlanDescription(plan)

    const { code_url } = await createNativeOrder({ plan, outTradeNo, description, amount })

    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
    await db.insert(paymentOrders).values({
      userId: session.userId,
      plan,
      amount,
      outTradeNo,
      codeUrl: code_url,
      status: "pending",
      expiresAt,
    })

    return NextResponse.json({ code_url, out_trade_no: outTradeNo, amount, plan })
  } catch (err) {
    console.error("Create order error:", err)
    return NextResponse.json({ error: "创建订单失败，请稍后重试" }, { status: 500 })
  }
}
