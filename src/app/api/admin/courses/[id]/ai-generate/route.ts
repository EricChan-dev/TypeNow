import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { llmCall } from "@/lib/llm"
import { extractTextFromFile } from "@/lib/file-parser"

function buildPrompt(lessonCount: string, sentencesPerLesson: string): string {
  const nDesc = lessonCount === "auto" ? "自行判断 3~8 个" : `${lessonCount} 个`
  const mDesc = sentencesPerLesson === "auto" ? "每章 5~10 个" : `每章 ${sentencesPerLesson} 个`
  return `你是英语教学课程设计专家。根据下面的文本为英语打字练习课程设计完整结构。

要求：
1. 将内容分成 ${nDesc} 逻辑章节，每章围绕一个清晰主题
2. ${mDesc} 完整英文句子，适合打字练习
3. 句子完整、地道、难度适中
4. 每章提供：title（简洁，中英均可）、summary（1~2句中文概括）
5. 只返回 JSON，格式：
{"lessons":[{"title":"...","summary":"...","sentences":[{"english":"...","chinese":"..."}]}]}

不要任何其他内容。`
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  await params // ensure params resolved (unused but required pattern)

  let text: string
  let lessonCount = "auto"
  let sentencesPerLesson = "auto"

  const contentType = req.headers.get("content-type") ?? ""

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData()
    const file = form.get("file")
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 })
    }
    lessonCount = (form.get("lessonCount") as string) ?? "auto"
    sentencesPerLesson = (form.get("sentencesPerLesson") as string) ?? "auto"
    try {
      text = await extractTextFromFile(file)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "文件解析失败" }, { status: 400 })
    }
  } else {
    const body = await req.json().catch(() => ({}))
    text = body.text ?? ""
    lessonCount = body.lessonCount ?? "auto"
    sentencesPerLesson = body.sentencesPerLesson ?? "auto"
  }

  text = text.trim()
  if (!text) return NextResponse.json({ error: "文本内容为空" }, { status: 400 })
  if (text.length > 5000) text = text.slice(0, 5000)

  try {
    const raw = await llmCall({
      systemPrompt: buildPrompt(lessonCount, sentencesPerLesson),
      userMessage: text,
      temperature: 0.4,
    })

    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error("AI 返回格式错误")
    const result: { lessons: { title: string; summary: string; sentences: { english: string; chinese: string }[] }[] } =
      JSON.parse(match[0])

    if (!Array.isArray(result.lessons) || result.lessons.length === 0) {
      throw new Error("AI 未生成任何章节")
    }

    return NextResponse.json(result)
  } catch (e) {
    console.error("ai-generate error:", e)
    return NextResponse.json({ error: "AI 生成失败，请重试" }, { status: 500 })
  }
}
