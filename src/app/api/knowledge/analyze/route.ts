import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { db } from "@/lib/db"
import { sentenceKnowledge, users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/rate-limit"
import { isProActive } from "@/lib/subscription"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import {
  DAY_MS,
  FREE_AI_ANALYZE_PER_DAY,
  PRO_AI_ANALYZE_PER_DAY,
} from "@/lib/membership-benefits"
import { KNOWLEDGE_UNCONFIGURED_CODE } from "@/lib/knowledge-failure"
import { DEEPSEEK_MODEL, DEEPSEEK_THINKING } from "@/lib/llm"

// 每次 LLM 调用都是真金白银，必须给单用户额度上限：
//   5 次/分钟  —— 防突发（连点、脚本）
//   每日额度    —— 真正的成本封顶，按会员区分，数值与价格页文案同源
//                 （见 lib/membership-benefits）
//
// 此前这里只有「20 次/小时」，折算下来一天最多 480 次、**没有任何每日封顶**；
// 而且限流提示写的是「今日分析额度已用完」—— 文案说"今日"，窗口却只有 1 小时，
// 用户等一小时就能继续，提示与事实不符。现在窗口与文案是一致的。
//
// 额度只在**真正要调用模型时**才消耗：缓存命中与未配置 key 都在这之前返回，
// 那两种情况下不该扣用户的量。
const MAX_ANALYZE_PER_MINUTE = 5

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
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not configured")

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: english },
      ],
      temperature: 0.5,
      thinking: DEEPSEEK_THINKING,
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
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  let body: { sentence?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const { sentence } = body
  const trimmed = typeof sentence === "string" ? sentence.trim() : ""
  if (!trimmed || trimmed.length > 2048) {
    return NextResponse.json({ error: "句子不能为空且不超过2048字符" }, { status: 400 })
  }

  const sentenceHash = createHash("sha256").update(trimmed).digest("hex")

  // 1. Try cache
  if (db) {
    const [cached] = await db
      .select({ data: sentenceKnowledge.data })
      .from(sentenceKnowledge)
      .where(eq(sentenceKnowledge.sentenceHash, sentenceHash))
      .limit(1)

    if (cached) return NextResponse.json({ data: cached.data, cached: true })
  }

  // 2. 未配置 AI key：直接说清是服务未配置，且不消耗用户额度。
  //    这次请求注定失败；若先扣额度，用户在服务真正可用时反而会被限流。
  //    缓存命中的分支已在上面返回，不需要 key，所以检查放在缓存之后。
  //    必须回 503 + code 而不是笼统的 500：客户端要据此区分
  //    「重试有用」和「重试永远不会成功」，避免诱导用户反复点重试。
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: "AI 解析服务暂未配置", code: KNOWLEDGE_UNCONFIGURED_CODE },
      { status: 503 },
    )
  }

  // 3. Cache miss — 只有真正要调用高价模型时才消耗额度（缓存命中不计费也不限流）
  const minuteLimit = checkRateLimit(
    "knowledge-analyze-minute",
    session.userId,
    MAX_ANALYZE_PER_MINUTE,
    60_000,
  )
  if (!minuteLimit.allowed) {
    return NextResponse.json(
      { error: `请求过于频繁，请${minuteLimit.retryAfter}秒后重试` },
      { status: 429 },
    )
  }

  // 每日额度按会员身份区分（数值与价格页文案同源，见 lib/membership-benefits）。
  // key 里带上海日历日 —— 跨天即换新桶，额度自然重置；窗口取一天，
  // 且必须配合 rate-limit 的「按桶窗口清理」才不会被截短成 1 小时。
  const [viewer] = db
    ? await db
        .select({ isPro: users.isPro, proExpires: users.proExpires })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1)
    : []
  const isPro = isProActive(viewer)
  const dailyQuota = isPro ? PRO_AI_ANALYZE_PER_DAY : FREE_AI_ANALYZE_PER_DAY

  const dailyLimit = checkRateLimit(
    "knowledge-analyze-daily",
    `${session.userId}:${toShanghaiDateStr()}`,
    dailyQuota,
    DAY_MS,
  )
  if (!dailyLimit.allowed) {
    return NextResponse.json(
      {
        error: isPro
          ? `今日讲解额度已用完（会员每天 ${PRO_AI_ANALYZE_PER_DAY} 次），请明天再来`
          : `今日讲解额度已用完（每天 ${FREE_AI_ANALYZE_PER_DAY} 次），开通会员可提升至每天 ${PRO_AI_ANALYZE_PER_DAY} 次`,
        code: "quota_exhausted",
      },
      { status: 429 },
    )
  }

  // 4. Call DeepSeek
  try {
    const knowledge = await callDeepSeek(trimmed)

    // 5. Store in cache (fire-and-forget)
    if (db) {
      void db
        .insert(sentenceKnowledge)
        .values({ sentenceHash, sentenceText: trimmed, data: knowledge })
        .onDuplicateKeyUpdate({ set: { data: knowledge } })
        .catch((err) => console.error("Cache upsert failed:", err))
    }

    return NextResponse.json({ data: knowledge, cached: false })
  } catch (e) {
    console.error("analyze error:", e)
    return NextResponse.json({ error: "句子分析失败，请稍后重试" }, { status: 500 })
  }
}
