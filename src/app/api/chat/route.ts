import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { diamondLogs, users } from "@/lib/db/schema"
import { eq, and, gte, sql } from "drizzle-orm"

const COST = 5
/** 单条消息（含历史）字符上限，防止超大提示词造成成本失控。 */
const MAX_MESSAGE_LEN = 2000
/** 历史消息条数上限。 */
const MAX_HISTORY_ITEMS = 20

const SYSTEM_PROMPT = `你是 TypeNow 英语学习助手"小码"，专注帮助用户学习英语。
你的特点：亲切、专业、善于用中英结合的方式解释语法和词汇，
回答简洁有重点，每次回复不超过 300 字。
只讨论英语学习、翻译、语法、写作等话题，
与英语学习无关的话题礼貌拒绝并引导回正题。`

type ChatMessage = { role: "user" | "assistant"; content: string }

/** drizzle 的 mysql2 update 返回 [ResultSetHeader, ...] */
function affectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number } | undefined
    return Number(header?.affectedRows ?? 0)
  }
  return 0
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })
  const database = db
  const userId = session.userId

  let body: { message?: unknown; history?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!message) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 })
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: `消息长度不能超过 ${MAX_MESSAGE_LEN} 字` }, { status: 400 })
  }

  const rawHistory = Array.isArray(body.history) ? body.history : []
  if (rawHistory.length > MAX_HISTORY_ITEMS) {
    return NextResponse.json({ error: `历史消息不能超过 ${MAX_HISTORY_ITEMS} 条` }, { status: 400 })
  }

  // role 白名单：只接受 user / assistant，客户端传来的 system 等非法项直接丢弃，
  // 否则可以借 history 注入系统提示。
  const history: ChatMessage[] = []
  for (const item of rawHistory) {
    if (!item || typeof item !== "object") continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if (role !== "user" && role !== "assistant") continue
    if (typeof content !== "string") continue
    if (content.length > MAX_MESSAGE_LEN) {
      return NextResponse.json({ error: `历史消息长度不能超过 ${MAX_MESSAGE_LEN} 字` }, { status: 400 })
    }
    if (!content.trim()) continue
    history.push({ role, content })
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 })

  // 先原子扣费：余额判断与扣减在同一条 UPDATE 里完成，杜绝并发请求超额消费
  // （原实现先读余额、LLM 返回后才扣减，中间隔着网络调用，可被并发绕过）。
  const deducted = await database.transaction(async (tx) => {
    const result = await tx
      .update(users)
      .set({ diamonds: sql`${users.diamonds} - ${COST}` })
      .where(and(eq(users.id, userId), gte(users.diamonds, COST)))

    if (affectedRows(result) === 0) return false

    await tx.insert(diamondLogs).values({ userId, amount: -COST, type: "chat" })
    return true
  })

  if (!deducted) {
    const [row] = await database
      .select({ diamonds: users.diamonds })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return NextResponse.json(
      { error: "diamond_insufficient", diamonds: row?.diamonds ?? 0 },
      { status: 402 },
    )
  }

  // 扣费成功后再调用 LLM；任何失败都要把 5 钻石退还，避免用户白扣。
  let reply: string
  try {
    const aiRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: message },
        ],
        temperature: 0.7,
      }),
    })

    if (!aiRes.ok) throw new Error(`AI 服务返回 ${aiRes.status}`)

    const aiData = await aiRes.json()
    reply = aiData.choices?.[0]?.message?.content ?? ""
  } catch (err) {
    console.error("[chat] LLM 调用失败，退还钻石:", err)
    try {
      await database.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ diamonds: sql`${users.diamonds} + ${COST}` })
          .where(eq(users.id, userId))
        await tx.insert(diamondLogs).values({ userId, amount: COST, type: "chat" })
      })
    } catch (refundErr) {
      console.error("[chat] 退还钻石失败，需人工核对:", refundErr)
    }
    return NextResponse.json({ error: "AI 服务暂时不可用" }, { status: 503 })
  }

  const [after] = await database
    .select({ diamonds: users.diamonds })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return NextResponse.json({ reply, diamondsLeft: after?.diamonds ?? 0 })
}
