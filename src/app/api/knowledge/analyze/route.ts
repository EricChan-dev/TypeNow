import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { createServiceClient } from "@/lib/supabase/service"

const SYSTEM_PROMPT = `你是一个专业的英语教学助手，精通英语语法、词汇和文化背景知识。请分析给定的英语句子，只返回纯JSON，不要包含任何markdown标记或其他文字。

JSON 格式如下：
{
  "chineseExplanation": "用中文准确翻译并解释这句话的完整含义",
  "englishExplanation": "用简单英文解释这句话的含义和语境，帮助学习者理解",
  "wordAnnotations": "逐词详细注解。按以下格式输出每个单词：\\n[单词]\\n发音：/音标/\\n中文含义\\n词性\\n基本含义：...\\n上下文含义：在句中的具体意思\\n同义词：...\\n反义词：...\\n常用短语：...\\n例句：...\\n记忆技巧：...\\n\\n注意：介词、连词、冠词等虚词也应详细解释其语法功能",
  "grammarAnalysis": "语法分析。包含以下内容：\\n句子成分拆解：逐词标注主语/谓语/宾语/表语/定语/状语等\\n句型：简单句/复合句/并列句\\n时态语气：...\\n重点语法：2-3个关键语法点详解\\n常见错误：学习者容易犯的2-3个错误\\n词序：句子词序规则分析\\n语法规则应用：...",
  "cultureNotes": "文化与实用知识。包含：\\n文化元素：句子反映的文化背景或价值观\\n实际应用：在什么具体情境下使用\\n背景信息：相关的英语国家文化知识",
  "usageScenarios": "功能和使用场景。详细说明这句话的交际功能和典型使用场景",
  "relatedExamples": "相关例句。提供3个结构或功能相似的英语句子，每个例句附带简短解释说明它与原句的异同"
}
所有字段不能为空。内容必须像专业英语教材一样详细、深入、实用。只返回JSON，不要任何其他内容。`

function extractJson(raw: string): string {
  const jsonBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonBlock) return jsonBlock[1].trim()
  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1)
  }
  return raw
}

async function callDeepSeek(english: string) {
  const apiKey = process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not configured")

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: english },
      ],
      temperature: 0.5,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    console.error("DeepSeek API error:", res.status, errText)
    throw new Error(`DeepSeek API error: ${res.status}`)
  }

  const data = await res.json()
  return JSON.parse(extractJson(data.choices[0].message.content))
}

export async function POST(request: Request) {
  let body: { sentence?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const { sentence } = body
  if (!sentence || sentence.length > 2048) {
    return NextResponse.json({ error: "句子不能为空且不超过2048字符" }, { status: 400 })
  }

  const sentenceHash = createHash("sha256").update(sentence.trim()).digest("hex")

  // 1. Try cache
  let tableExists = true
  const supabase = createServiceClient()
  if (supabase) {
    const { data: cached, error: cacheError } = await supabase
      .from("sentence_knowledge")
      .select("data")
      .eq("sentence_hash", sentenceHash)
      .maybeSingle()

    if (!cacheError && cached) {
      return NextResponse.json({ data: cached.data, cached: true })
    }

    if (cacheError?.code === "PGRST205") {
      tableExists = false
      console.warn("sentence_knowledge table not found — skipping cache")
    }
  }

  // 2. Cache miss — call DeepSeek
  try {
    const knowledge = await callDeepSeek(sentence.trim())

    // 3. Store in cache (fire-and-forget)
    if (supabase && tableExists) {
      void (async () => {
        try {
          const { error } = await supabase
            .from("sentence_knowledge")
            .upsert({
              sentence_hash: sentenceHash,
              sentence_text: sentence.trim(),
              data: knowledge,
            }, { onConflict: "sentence_hash" })
          if (error) console.error("Cache upsert error:", error)
        } catch (err) {
          console.error("Cache upsert failed:", err)
        }
      })()
    }

    return NextResponse.json({ data: knowledge, cached: false })
  } catch (e) {
    console.error("analyze error:", e)
    return NextResponse.json({ error: "句子分析失败，请稍后重试" }, { status: 500 })
  }
}
