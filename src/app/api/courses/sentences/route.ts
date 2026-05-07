import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getMockSentencesByLesson } from "@/lib/mock-data/sentences"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lessonId = searchParams.get("lessonId")

  if (!lessonId) {
    return NextResponse.json({ error: "缺少 lessonId 参数" }, { status: 400 })
  }

  // Try database first
  const supabase = await createClient()
  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: "请先登录" }, { status: 401 })
      }

      const { data, error } = await supabase
        .from("sentences")
        .select("*")
        .eq("lesson_id", lessonId)
        .order("id")

      if (!error && data && data.length > 0) {
        return NextResponse.json({ sentences: data })
      }
    } catch { /* fall through to mock */ }
  }

  // Fallback to mock data
  const sentences = getMockSentencesByLesson(lessonId)
  return NextResponse.json({ sentences })
}
