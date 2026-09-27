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

import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { isAllowedEvent } from "@/lib/analytics-events"
import { truncateMeta } from "@/lib/request-meta"

/** analytics_events 的列宽（见 schema.ts） */
const MAX_EVENT = 100
const MAX_PAGE_URL = 512
const MAX_SESSION_ID = 64
/** properties 是 JSON 列，这里只做一个防呆上限 */
const MAX_PROPERTIES_JSON = 4096

export interface ServerEvent {
  event: string
  /** 归属用户；注册场景就是刚建出来的那个 id */
  userId?: string | null
  properties?: Record<string, unknown>
  pageUrl?: string | null
  sessionId?: string | null
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
    })
  } catch (err) {
    console.error("[analytics-server] 写埋点失败（已忽略，不影响业务结果）", err)
  }
}
