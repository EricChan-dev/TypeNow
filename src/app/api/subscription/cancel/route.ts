import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { cancelSubscription } from "@/lib/subscription"

export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

    await cancelSubscription(session.userId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Cancel subscription error:", err)
    return NextResponse.json({ error: "取消失败，请稍后重试" }, { status: 500 })
  }
}
