import { NextResponse } from "next/server"
import { createHash, randomUUID } from "crypto"

function truncateInput(q: string): string {
  if (q.length <= 20) return q
  return q.substring(0, 10) + q.length + q.substring(q.length - 10)
}

export async function POST(request: Request) {
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
