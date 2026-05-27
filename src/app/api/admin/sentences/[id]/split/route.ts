import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"
import { llmCall } from "@/lib/llm"

function buildSplitPrompt(wordCount: number): string {
  let range: string
  if (wordCount <= 6) {
    range = "3~5"
  } else if (wordCount <= 12) {
    range = "5~7"
  } else if (wordCount <= 20) {
    range = "6~9"
  } else {
    range = "8~13"
  }

  return `你是英语教学专家。请将下面的英文句子拆解为 ${range} 个短语，帮助学习者从部分到整体地理解和练习。

拆解逻辑（重要）：
- 不是从左到右逐字递增，而是先提取句子的各个语义成分，再逐步组合成完整句
- 先出现句子的关键词或核心短语（名词短语、动词短语、插入语等）
- 再将各成分拼合，最终还原完整句子
- 每一步都是一个独立可读的短语，有完整意义

示例（仅供参考拆解思路，不要照抄）：
原句：Excuse me, do you have this shirt?
拆解：
1. Excuse me（插入语）
2. shirt（核心名词）
3. this shirt（名词短语）
4. do you have（核心疑问结构）
5. do you have this shirt（完整疑问句）
6. Excuse me, do you have this shirt?（完整句）

规则：
1. 短语数量尽量接近区间上限 ${range}，不要只给最少数量
2. 最后一个短语必须与原句完全一致（包括标点）
3. 每个短语附带准确的中文翻译

返回纯 JSON 数组，每项格式：{"order":1,"text":"短语原文","chinese":"对应中文"}
只输出 JSON 数组，不要任何解释。`
}

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

  const wordCount = (sentence.english ?? "").trim().split(/\s+/).length

  const raw = await llmCall({
    systemPrompt: buildSplitPrompt(wordCount),
    userMessage: `句子：${sentence.english}\n中文：${sentence.chinese}`,
    temperature: 0.3,
  })

  const chunks = JSON.parse(extractJsonArray(raw)) as Array<{ order: number; text: string; chinese: string }>

  await db.update(sentences).set({ chunks }).where(eq(sentences.id, id))

  return NextResponse.json({ data: { chunks } })
}
