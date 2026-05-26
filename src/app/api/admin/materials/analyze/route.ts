import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { materialImports } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"
import { llmCall } from "@/lib/llm"

const SYSTEM_PROMPT = `你是英语教材解析助手。从教材文本中提取10-20个适合中国学习者练习的英文句子。
返回纯JSON数组，每条格式如下：
{
  "english": "完整英文句子",
  "chinese": "准确中文翻译",
  "difficulty": 1,
  "words": [
    { "english": "单词", "chinese": "中文", "phonetic": "/音标/", "pos": "词性" }
  ],
  "chunks": [
    { "order": 1, "text": "主谓核心短语", "chinese": "对应中文" },
    { "order": 2, "text": "完整句子（必须与english字段完全相同）", "chinese": "完整翻译" }
  ]
}
词性取值：动词/名词/代词/形容词/副词/介词/连词/助动词/冠词/标点
difficulty取值：1（简单）2（中等）3（较难）
chunks规则：2-5个，从主谓核心出发渐进扩展，最后一个必须是完整句子且text与english字段完全相同
只输出JSON数组，不要任何解释或markdown标记。`

interface SentenceItem {
  english: string
  chinese: string
  difficulty: number
  words: Array<{ english: string; chinese: string; phonetic: string; pos: string }>
  chunks: Array<{ order: number; text: string; chinese: string }>
}

function chunkText(text: string, maxLen = 3000): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = start + maxLen
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end)
      if (lastNewline > start) end = lastNewline
    }
    chunks.push(text.slice(start, end).trim())
    start = end
  }
  return chunks.filter(Boolean)
}

function extractJsonArray(raw: string): SentenceItem[] {
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = block ? block[1].trim() : raw.trim()
  const firstBracket = jsonStr.indexOf("[")
  const lastBracket = jsonStr.lastIndexOf("]")
  if (firstBracket === -1 || lastBracket <= firstBracket) return []
  return JSON.parse(jsonStr.slice(firstBracket, lastBracket + 1))
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { importId } = await request.json()
  if (!importId) return NextResponse.json({ error: "importId required" }, { status: 400 })

  const [record] = await db.select().from(materialImports).where(eq(materialImports.id, importId)).limit(1)
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!record.rawText) return NextResponse.json({ error: "No raw text to analyze" }, { status: 400 })

  await db.update(materialImports).set({ status: "processing" }).where(eq(materialImports.id, importId))

  try {
    const textChunks = chunkText(record.rawText)
    const allSentences: SentenceItem[] = []

    for (const chunk of textChunks) {
      const raw = await llmCall({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: chunk,
        temperature: 0.3,
      })
      const parsed = extractJsonArray(raw)
      allSentences.push(...parsed)
    }

    await db
      .update(materialImports)
      .set({ status: "done", sentenceCount: allSentences.length })
      .where(eq(materialImports.id, importId))

    return NextResponse.json({ data: allSentences })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    await db
      .update(materialImports)
      .set({ status: "error", errorMsg: msg })
      .where(eq(materialImports.id, importId))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
