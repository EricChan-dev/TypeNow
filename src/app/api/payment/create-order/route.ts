import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders } from "@/lib/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import {
  createNativeOrder,
  generateOutTradeNo,
  getPlanAmount,
  getPlanDescription,
} from "@/lib/wechat-pay"
import { isPlanKey } from "@/lib/pricing"

export async function POST(request: Request) {
  try {
    if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

    const { plan } = await request.json()
    // 档位白名单来自 lib/pricing 的 PLANS，不再手写枚举 ——
    // 此前这里硬编码了三个档位，加季度档时必然漏改。
    if (!isPlanKey(plan)) {
      return NextResponse.json({ error: "无效的订阅方案" }, { status: 400 })
    }

    // 「首期优惠」的资格只能在**服务端**判定：只要该用户历史上有一笔已支付订单，
    // 就不再享受首期价，一律按标准价下单。
    //
    // 绝不能把价格或 isFirstPurchase 交给客户端 —— 那等于把定价权交给浏览器。
    // 用 limit(1) 而不是 count：只需要「有没有」，不需要知道几笔。
    const [paidBefore] = await db
      .select({ id: paymentOrders.id })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.userId, session.userId), eq(paymentOrders.status, "paid")))
      .limit(1)
    const isFirstPurchase = !paidBefore

    const standardAmount = getPlanAmount(plan, isFirstPurchase)
    if (standardAmount === null) {
      return NextResponse.json({ error: "无效的订阅方案" }, { status: 400 })
    }

    const outTradeNo = generateOutTradeNo()
    // 测试价（1 分钱）只在开发环境生效。此前还接受 WECHAT_PAY_TEST_MODE
    // 环境变量，生产环境只要该变量为 "true"，就能用 1 分钱买下终身会员
    // （库里那两条 amount=1 的 paid 订单就是这么来的）。
    const isTestMode = process.env.NODE_ENV === "development"
    const amount = isTestMode ? 1 : standardAmount
    const description = getPlanDescription(plan)

    const { code_url } = await createNativeOrder({ plan, outTradeNo, description, amount })

    // 有效期必须用**数据库时钟**算，不能用应用进程的 Date.now()。
    //
    // created_at 是列默认值 CURRENT_TIMESTAMP（数据库时钟）。如果 expires_at 取
    // JS 时间戳，两者就来自两个钟，差值还要叠上「取时间戳 → INSERT 完成」的往返延迟。
    // 这个延迟是 sub-second 的，于是 TIMESTAMPDIFF(MINUTE, ...) 的截断结果会在
    // 120 / 119 之间随机跳 —— e2e 里那条「订单有效期是下单后 2 小时（口径必须与
    // created_at 一致）」就因此偶发失败过，而它断言的正是这个口径问题。
    //
    // 同一条 INSERT 语句里的 NOW() 是**语句级常量**，与列默认值同源，
    // 所以 expires_at - created_at 恒等于 7200 秒，不再受延迟相位影响。
    await db.insert(paymentOrders).values({
      userId: session.userId,
      plan,
      amount,
      outTradeNo,
      codeUrl: code_url,
      status: "pending",
      expiresAt: sql`DATE_ADD(NOW(), INTERVAL 2 HOUR)`,
    })

    return NextResponse.json({
      code_url,
      out_trade_no: outTradeNo,
      amount,
      plan,
      // 前端据此显示「首期优惠」还是「标准价」，避免用户以为被多收了钱。
      is_first_purchase: isFirstPurchase,
    })
  } catch (err) {
    console.error("Create order error:", err)
    return NextResponse.json({ error: "创建订单失败，请稍后重试" }, { status: 500 })
  }
}
