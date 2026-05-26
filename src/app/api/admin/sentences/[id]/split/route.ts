import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"
import { llmCall } from "@/lib/llm"

const SPLIT_PROMPT = `你是英语教学专家。将下面的英文句子拆分为 2~5 个渐进式短语，从主谓核心出发逐步扩展至完整句子。
规则：
1. 第一个短语是最核心的主谓结构
2. 每个后续短语在前一个基础上增加成分
3. 最后一个短语必须与原句完全一致
4. 每个短语附带准确的中文翻译

返回纯 JSON 数组，每项格式：{"order":1,"text":"短语原文","chinese":"对应中文"}
只输出 JSON 数组，不要任何解释。`

function extractJsonArray(raw: string): string {
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (block) return block[1].trim()
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [sentence] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  if (!sentence) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const raw = await llmCall({
    systemPrompt: SPLIT_PROMPT,
    userMessage: `句子：${sentence.english}\n中文：${sentence.chinese}`,
    temperature: 0.3,
  })

  const chunks = JSON.parse(extractJsonArray(raw)) as Array<{ order: number; text: string; chinese: string }>

  return NextResponse.json({ data: { chunks } })
}
