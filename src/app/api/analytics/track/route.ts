import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"
import { isAllowedEvent } from "@/lib/analytics-events"
import { parseVisitorId } from "@/lib/visitor"

// 埋点事件白名单来自 src/lib/analytics-events（与前端 helper、后台漏斗报表共用
// 同一份清单），防止任何人向 analytics_events 灌入任意 event_type。
// 曾经这里是手抄的一份副本，新增事件时要改三处，漏一处就静默丢数据。

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

    const { event, properties, pageUrl, sessionId, visitorId } = JSON.parse(rawBody)

    if (!event || typeof event !== "string") {
      return NextResponse.json({ error: "Missing event" }, { status: 400 })
    }
    if (event.length > MAX_EVENT_LENGTH || !isAllowedEvent(event)) {
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
    // 只接受我们自己生成的 UUID（见 lib/visitor.ts）：放行任意字符串等于让人
    // 随手造出无数个假"访客"，独立访客数直接失真。不合格就存 NULL，
    // 报表按 session_id 降级统计 —— 丢身份可以，丢事件不行。
    const safeVisitorId = parseVisitorId(visitorId)

    if (!db) return NextResponse.json({ ok: true })

    const session = await getSession().catch(() => null)

    await db.insert(analyticsEvents).values({
      eventType: event,
      userId: session?.userId || null,
      properties: safeProperties,
      pageUrl: safePageUrl,
      sessionId: safeSessionId,
      visitorId: safeVisitorId,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    // **必须打日志**，不能像以前那样空 catch。
    //
    // 这个接口对客户端永远返回 200（埋点是旁路，绝不能因为埋点失败而让页面报错），
    // 于是"写不进去"在外部完全不可见。2026-09-28 就踩过一次：`visitor_id` 列还没在
    // 生产库执行 DDL，INSERT 直接抛错，而前端一切正常 —— 事件全丢了却毫无痕迹，
    // 只有真去查库才会发现。写入失败必须留在服务端日志里，否则这类故障
    // （列不存在、类型不符、连接池耗尽）会一直静默。
    console.error("[analytics/track] 埋点写入失败（已对客户端吞掉，事件已丢失）", err)
    return NextResponse.json({ ok: true })
  }
}
