import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { cancelSubscription } from "@/lib/subscription"

export async function POST() {
  try {
    const supabase = await createSupabaseClient()
    if (!supabase) {
      return NextResponse.json({ error: "服务未配置" }, { status: 500 })
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 })
    }

    await cancelSubscription(session.user.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Cancel subscription error:", err)
    return NextResponse.json({ error: "取消失败，请稍后重试" }, { status: 500 })
  }
}
