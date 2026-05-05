import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { getActiveSubscription, checkAndExpirePro } from "@/lib/subscription"

export async function GET() {
  try {
    const supabase = await createSupabaseClient()
    if (!supabase) {
      return NextResponse.json({ error: "服务未配置" }, { status: 500 })
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 })
    }

    await checkAndExpirePro(session.user.id)
    const sub = await getActiveSubscription(session.user.id)

    return NextResponse.json({
      hasActive: !!sub,
      plan: sub?.plan || null,
      starts_at: sub?.starts_at || null,
      expires_at: sub?.expires_at || null,
    })
  } catch (err) {
    console.error("Subscription status error:", err)
    return NextResponse.json({ error: "查询失败" }, { status: 500 })
  }
}
