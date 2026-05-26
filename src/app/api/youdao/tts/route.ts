import { NextResponse } from "next/server"
import { createHash, randomUUID } from "crypto"
import { db } from "@/lib/db"
import { ttsCache } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

function truncateInput(q: string): string {
  if (q.length <= 20) return q
  return q.substring(0, 10) + q.length + q.substring(q.length - 10)
}

export async function POST(request: Request) {
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
