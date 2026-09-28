import { NextResponse } from "next/server"
import { createHash, randomUUID } from "crypto"
import { db } from "@/lib/db"
import { ttsCache } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"

/**
 * 有道 TTS 按调用计费，必须给「真正会产生费用的调用」封顶。
 *
 * 为什么限流只卡缓存未命中：tts_cache 命中时零成本、也不该限制用户重听，
 * 所以播放已缓存句子不计次；而随机文本必然穿透缓存，每次都打到有道 ——
 * 那正是要卡的关口。
 *
 * 取值的取舍：学生看完一句就播一次，一小时内遇到 120 条**全新**句子
 * （约 9 节课）已属重度使用，故用户级给到 120；IP 级 300 用来兜住
 * 「批量注册小号绕开用户级」的情况（同一出口 IP 的正常用户极少）。
 * 两个数都是初始值，上线后应按有道控制台的真实调用曲线回调。
 */
const MAX_TTS_PER_USER_HOUR = 120
const MAX_TTS_PER_IP_HOUR = 300

function truncateInput(q: string): string {
  if (q.length <= 20) return q
  return q.substring(0, 10) + q.length + q.substring(q.length - 10)
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  let body: { text?: string; voiceName?: string; speed?: number; volume?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const { text, voiceName, speed, volume } = body

  if (!text || text.length > 2048) {
    return NextResponse.json({ error: "文本不能为空且不超过2048字符" }, { status: 400 })
  }

  const voice = voiceName || "youxiaomei"
  const spd = speed?.toString() || "1"
  const vol = volume?.toString() || "1.00"

  const cacheKey = createHash("sha256")
    .update(text + voice + spd + vol)
    .digest("hex")

  // 1. Try cache
  if (db) {
    const [cached] = await db
      .select({ audioData: ttsCache.audioData })
      .from(ttsCache)
      .where(eq(ttsCache.cacheKey, cacheKey))
      .limit(1)

    if (cached) {
      const audioBuffer = Buffer.from(cached.audioData, "base64")
      return new NextResponse(audioBuffer, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400",
        },
      })
    }
  }

  // 2. Cache miss — call Youdao
  const appKey = process.env.YOUDAO_APP_KEY
  const appSecret = process.env.YOUDAO_APP_SECRET

  if (!appKey || !appSecret) {
    return NextResponse.json({ error: "有道API未配置" }, { status: 500 })
  }

  // 限流刻意放在**缓存命中之后、有道调用之前**（理由见顶部常量注释）。
  // 也刻意放在 key 检查之后：没配 key 时根本没产生调用，不该扣用户额度。
  const userLimit = checkRateLimit(
    "youdao-tts-user",
    session.userId,
    MAX_TTS_PER_USER_HOUR,
    3600_000,
  )
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: `语音合成次数已达上限，请${userLimit.retryAfter}秒后重试` },
      { status: 429 },
    )
  }

  const ipLimit = checkRateLimit(
    "youdao-tts-ip",
    getClientIP(request),
    MAX_TTS_PER_IP_HOUR,
    3600_000,
  )
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: `语音合成次数已达上限，请${ipLimit.retryAfter}秒后重试` },
      { status: 429 },
    )
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
    voiceName: voice,
    format: "mp3",
    speed: spd,
    volume: vol,
  })

  const res = await fetch("https://openapi.youdao.com/ttsapi", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  })

  const contentType = res.headers.get("content-type") || ""

  if (!contentType.includes("audio")) {
    const errorText = await res.text()
    console.error("Youdao TTS error:", res.status, errorText)
    let errorMsg = "语音合成失败"
    try {
      const err = JSON.parse(errorText)
      errorMsg = err.errorMsg || err.error || errorMsg
    } catch { /* raw text */ }
    return NextResponse.json({ error: errorMsg }, { status: 500 })
  }

  const audioBuffer = await res.arrayBuffer()
  const audioBase64 = Buffer.from(audioBuffer).toString("base64")

  // 3. Store in cache (fire-and-forget)
  if (db) {
    void db
      .insert(ttsCache)
      .values({ cacheKey, text, voiceName: voice, audioData: audioBase64 })
      .onDuplicateKeyUpdate({ set: { audioData: audioBase64 } })
      .catch((err) => console.error("TTS cache upsert failed:", err))
  }

  return new NextResponse(audioBuffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
    },
  })
}
