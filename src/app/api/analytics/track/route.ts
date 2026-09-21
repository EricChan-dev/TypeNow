import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"

// 埋点事件白名单：只接受 src/lib/analytics.ts 前端 helper 定义的事件名，
// 防止任何人向 analytics_events 灌入任意 event_type。
const ALLOWED_EVENTS = new Set([
  "page_view",
  "click",
  "practice_complete",
  "click_subscribe",
  "subscribe_pay_success",
  "login_success",
  "theme_toggle",
])

// 埋点载荷是极小的 JSON，超过任一上限即视为滥用。
const MAX_BODY_BYTES = 8 * 1024
const MAX_PROPERTIES_BYTES = 2048
const MAX_EVENT_LENGTH = 100
const MAX_PAGE_URL_LENGTH = 512
const MAX_SESSION_ID_LENGTH = 64

export async function POST(request: Request) {
  // 埋点保留匿名（未登录页面的 page_view 是转化漏斗的一部分，
  // 强制登录会丢失匿名数据），因此按 IP 限流以阻止灌库。
  const ip = getClientIP(request)
  const limit = checkRateLimit("analytics-track", ip, 60, 60_000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `事件上报过于频繁，请${limit.retryAfter}秒后重试` },
      { status: 429 },
    )
  }

  try {
    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "请求体过大" }, { status: 413 })
    }

    const { event, properties, pageUrl, sessionId } = JSON.parse(rawBody)

    if (!event || typeof event !== "string") {
      return NextResponse.json({ error: "Missing event" }, { status: 400 })
    }
    if (event.length > MAX_EVENT_LENGTH || !ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ error: "非法的事件名" }, { status: 400 })
    }

    const safeProperties =
      properties && typeof properties === "object" && !Array.isArray(properties)
        ? properties
        : {}
    if (Buffer.byteLength(JSON.stringify(safeProperties)) > MAX_PROPERTIES_BYTES) {
      return NextResponse.json({ error: "properties 过大" }, { status: 413 })
    }

    const safePageUrl =
      typeof pageUrl === "string" ? pageUrl.slice(0, MAX_PAGE_URL_LENGTH) : ""
    const safeSessionId =
      typeof sessionId === "string" ? sessionId.slice(0, MAX_SESSION_ID_LENGTH) : ""

    if (!db) return NextResponse.json({ ok: true })

    const session = await getSession().catch(() => null)

    await db.insert(analyticsEvents).values({
      eventType: event,
      userId: session?.userId || null,
      properties: safeProperties,
      pageUrl: safePageUrl,
      sessionId: safeSessionId,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
