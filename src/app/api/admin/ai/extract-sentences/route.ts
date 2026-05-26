import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { llmCall } from "@/lib/llm"
import { extractTextFromFile } from "@/lib/file-parser"

const SYSTEM_PROMPT = `你是英语教学内容处理专家。请从下面的文本中提取完整的英文句子，用于英语打字练习。

要求：
1. 只提取完整的英文句子（需有主谓结构）
2. 去除重复或高度相似的句子
3. 忽略纯中文内容、标题、页码等非句子内容
4. 为每个句子提供准确、自然的中文翻译
5. 优先选择难度适中、适合英语学习的句子
6. 最多返回 50 个句子
7. 只返回 JSON 数组，不要任何其他内容，格式：[{"english":"...","chinese":"..."}]`

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  let text: string

  const contentType = req.headers.get("content-type") ?? ""

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData()
    const file = form.get("file")
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 })
    }
    try {
      text = await extractTextFromFile(file)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "文件解析失败" }, { status: 400 })
    }
  } else {
    const body = await req.json().catch(() => ({}))
    text = body.text ?? ""
  }

  text = text.trim()
  if (!text) return NextResponse.json({ error: "文本内容为空" }, { status: 400 })
  if (text.length > 10000) text = text.slice(0, 10000)

  try {
    const raw = await llmCall({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: text,
      temperature: 0.3,
    })

    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error("AI 返回格式错误")
    const sentences: { english: string; chinese: string }[] = JSON.parse(match[0])

    return NextResponse.json({ sentences })
  } catch (e) {
    console.error("extract-sentences error:", e)
    return NextResponse.json({ error: "AI 生成失败，请重试" }, { status: 500 })
  }
}
