import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { diamondLogs, users } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"

const COST = 5
const SYSTEM_PROMPT = `你是 TypeNow 英语学习助手"小码"，专注帮助用户学习英语。
你的特点：亲切、专业、善于用中英结合的方式解释语法和词汇，
回答简洁有重点，每次回复不超过 300 字。
只讨论英语学习、翻译、语法、写作等话题，
与英语学习无关的话题礼貌拒绝并引导回正题。`

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const [userRow] = await db
    .select({ diamonds: users.diamonds })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!userRow) return NextResponse.json({ error: "用户不存在" }, { status: 404 })
  if (userRow.diamonds < COST) {
    return NextResponse.json({ error: "diamond_insufficient", diamonds: userRow.diamonds }, { status: 402 })
  }

  let body: { message: string; history?: { role: "user" | "assistant"; content: string }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 })
  }

  const history = (body.history ?? []).slice(-10)
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: body.message.trim() },
  ]

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 })

  const aiRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "deepseek-chat", messages, temperature: 0.7 }),
  })

  if (!aiRes.ok) {
    return NextResponse.json({ error: "AI 服务暂时不可用" }, { status: 503 })
  }

  const aiData = await aiRes.json()
  const reply = aiData.choices?.[0]?.message?.content ?? ""

  await Promise.all([
    db.insert(diamondLogs).values({ userId: session.userId, amount: -COST, type: "chat" }),
    db.update(users)
      .set({ diamonds: sql`${users.diamonds} - ${COST}` })
      .where(eq(users.id, session.userId)),
  ])

  const diamondsLeft = userRow.diamonds - COST

  return NextResponse.json({ reply, diamondsLeft })
}
