import { NextResponse } from "next/server"
import { createHash, randomUUID } from "crypto"
import { getSession } from "@/lib/auth/session"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"

// 有道语音评测按调用计费，必须限制调用量与输入体积。
// 单用户 30 次/小时；同一 IP 再兜一层 60 次/小时，防止批量注册账号绕过。
const MAX_EVALUATE_PER_USER_HOUR = 30
const MAX_EVALUATE_PER_IP_HOUR = 60
// 评测对象是句子，500 字符足够；音频按 16kHz wav 30 秒估算 base64 体积上限。
const MAX_TEXT_LENGTH = 500
const MAX_AUDIO_LENGTH = 2_000_000

function truncateInput(q: string): string {
  if (q.length <= 20) return q
  return q.substring(0, 10) + q.length + q.substring(q.length - 10)
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  let body: { audio?: string; text?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const { audio, text } = body
  if (!audio || !text) {
    return NextResponse.json({ error: "audio 和 text 不能为空" }, { status: 400 })
  }
  if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text 不能超过${MAX_TEXT_LENGTH}字符` },
      { status: 400 },
    )
  }
  if (typeof audio !== "string" || audio.length > MAX_AUDIO_LENGTH) {
    return NextResponse.json({ error: "audio 数据过大" }, { status: 413 })
  }

  const userLimit = checkRateLimit(
    "youdao-evaluate-user",
    session.userId,
    MAX_EVALUATE_PER_USER_HOUR,
    3600_000,
  )
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: `评测次数已达上限，请${userLimit.retryAfter}秒后重试` },
      { status: 429 },
    )
  }

  const ipLimit = checkRateLimit(
    "youdao-evaluate-ip",
    getClientIP(request),
    MAX_EVALUATE_PER_IP_HOUR,
    3600_000,
  )
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: `评测次数已达上限，请${ipLimit.retryAfter}秒后重试` },
      { status: 429 },
    )
  }

  const appKey = process.env.YOUDAO_APP_KEY
  const appSecret = process.env.YOUDAO_APP_SECRET
  if (!appKey || !appSecret) {
    return NextResponse.json({ error: "有道API未配置" }, { status: 500 })
  }

  const salt = randomUUID()
  const curtime = Math.floor(Date.now() / 1000).toString()
  const input = truncateInput(text)
  const sign = createHash("sha256")
    .update(appKey + input + salt + curtime + appSecret)
    .digest("hex")

  const formData = new URLSearchParams({
    q: text,
    appKey,
    salt,
    sign,
    signType: "v3",
    curtime,
    langType: "en",
    type: "2",
    audioType: "1",
    audio,
    channel: "1",
    rate: "16000",
    format: "wav",
  })

  const res = await fetch("https://openapi.youdao.com/speechevaluateapi", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  })

  const data = await res.json()
  if (data.errorCode !== "0") {
    console.error("Youdao evaluate error:", data)
    return NextResponse.json({ error: `评分失败(${data.errorCode})` }, { status: 500 })
  }

  const result = data.result ?? {}
  return NextResponse.json({
    score: Math.round(result.integrity ?? result.accuracy ?? 0),
    accuracy: Math.round(result.accuracy ?? 0),
    fluency: Math.round(result.fluency ?? 0),
    words: (result.words ?? []).map((w: { content?: string; accuracy?: number }) => ({
      word: w.content ?? "",
      score: Math.round(w.accuracy ?? 0),
    })),
  })
}
