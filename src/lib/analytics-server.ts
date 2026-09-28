/**
 * 服务端埋点写入。
 *
 * 为什么需要它：lib/analytics.ts 是 `"use client"`，只能在浏览器里用，
 * 而**注册这件事只有服务端知道**（建号那一步在 API 路由里，客户端拿不到
 * 渠道、scene、IP）。此前 register_success 虽然一直在事件白名单里，
 * 却从未被上报过 —— 于是「用户从哪来」在埋点侧也是空白。
 *
 * 与 analytics_events.properties 的关系：注册**数量**仍以 users 表为权威
 * （见 lib/analytics-events.ts 的 FUNNEL_STEPS，registered 那一步 source 是 db）。
 * 这里写的事件只补两件 users 表答不了的事：**什么时候**注册的、
 * 以及**和渠道一起看**的时序（例如"某天某渠道涌入 10 个人"）。
 * 两条数据源互不替代，报表会把差异显式暴露出来。
 *
 * 三条约束与 lib/admin-audit 一致：
 * 1. **绝不抛错** —— 埋点是旁路，注册不能因为它失败而失败。
 * 2. 只写白名单内的事件名（复用 lib/analytics-events 的判定，防止灌库）。
 * 3. 截断到列宽，超长会让 INSERT 抛错。
 */

import type { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { isAllowedEvent } from "@/lib/analytics-events"
import { truncateMeta } from "@/lib/request-meta"
import { VISITOR_COOKIE, parseVisitorId } from "@/lib/visitor"

/** analytics_events 的列宽（见 schema.ts） */
const MAX_EVENT = 100
const MAX_PAGE_URL = 512
const MAX_SESSION_ID = 64
/** properties 是 JSON 列，这里只做一个防呆上限 */
const MAX_PROPERTIES_JSON = 4096

/**
 * 从请求的 typ_vid cookie 里取匿名访客身份（见 lib/visitor.ts）。
 *
 * 放在这里而不是让四个注册调用点各写一遍 `request.cookies.get(...)`：
 * cookie 名与解析规则只有一处，改的时候不会漏掉某条注册链路
 * （漏掉的表现是"某个渠道的注册永远没有 visitor_id"，几个月内都不会有人发现）。
 *
 * 注意：**只有浏览器发起的注册请求才读得到**。微信公众号关注事件那条链路
 * （api/wechat/oa/event）的请求来自微信服务器，没有 cookie，那个调用点
 * 不传这个值 —— 那条链路的 visitor 绑定由"登录后浏览器继续上报的埋点事件"
 * 自动完成（事件同时带 userId 与 visitorId），不需要在注册那一刻拿到。
 */
export function visitorIdFromRequest(request: NextRequest): string | null {
  return parseVisitorId(request.cookies.get(VISITOR_COOKIE)?.value)
}

export interface ServerEvent {
  event: string
  /** 归属用户；注册场景就是刚建出来的那个 id */
  userId?: string | null
  properties?: Record<string, unknown>
  pageUrl?: string | null
  sessionId?: string | null
  /**
   * 匿名访客身份（见 lib/visitor.ts）。
   *
   * 注册事件带上它，是为了**在注册那一刻**就把这次匿名访问与刚建出的账号绑上，
   * 不必等下一次埋点上报。客户端注册前必定浏览过 /login（PageViewTracker
   * 在那里写过 typ_vid cookie），所以这一刻读得到同一个 visitor_id。
   *
   * 它不是唯一的绑定途径：登录之后浏览器继续上报的事件本来就同时带
   * userId 与 visitorId（见 api/analytics/track），那些事件同样构成绑定。
   * 微信关注事件那条链路（请求来自微信服务器、没有 cookie）就只能靠后者，
   * 所以报表侧的绑定判定必须两者都认。
   */
  visitorId?: string | null
}

/**
 * 写一条服务端事件。**永不抛错**（见文件头约束 1）。
 *
 * 不 await 它也不会丢：进程内直接 await 一次 INSERT 的代价可以忽略，
 * 而 fire-and-forget 在进程重启/Serverless 冻结时会静默丢掉事件。
 */
export async function recordServerEvent(entry: ServerEvent): Promise<void> {
  try {
    if (!db) return
    if (!isAllowedEvent(entry.event)) {
      console.error("[analytics-server] 非法事件名，已丢弃:", entry.event)
      return
    }

    const properties = entry.properties && typeof entry.properties === "object" ? entry.properties : {}
    let json: string
    try {
      json = JSON.stringify(properties)
    } catch {
      // 循环引用之类的：宁可不带 properties，也不要丢整条事件
      json = "{}"
    }
    if (json.length > MAX_PROPERTIES_JSON) {
      json = "{}"
    }

    await db.insert(analyticsEvents).values({
      eventType: truncateMeta(entry.event, MAX_EVENT) ?? entry.event,
      userId: entry.userId ?? null,
      properties: JSON.parse(json),
      pageUrl: truncateMeta(entry.pageUrl, MAX_PAGE_URL) ?? "",
      sessionId: truncateMeta(entry.sessionId, MAX_SESSION_ID) ?? "",
      // 服务端的 visitor 一定是客户端 cookie 里的原值，这里仍走一次校验：
      // 调用点可能来自任何请求，格式不对就存 NULL，而不是把垃圾写进列里
      visitorId: parseVisitorId(entry.visitorId),
    })
  } catch (err) {
    console.error("[analytics-server] 写埋点失败（已忽略，不影响业务结果）", err)
  }
}
