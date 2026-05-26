import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { getActiveSubscription, checkAndExpirePro } from "@/lib/subscription"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

    await checkAndExpirePro(session.userId)
    const sub = await getActiveSubscription(session.userId)

    return NextResponse.json({
      hasActive: !!sub,
      plan: sub?.plan || null,
      starts_at: sub?.startsAt || null,
      expires_at: sub?.expiresAt || null,
    })
  } catch (err) {
    console.error("Subscription status error:", err)
    return NextResponse.json({ error: "查询失败" }, { status: 500 })
  }
}
