/**
 * 埋点查询的筛选条件解析与 WHERE 构造（服务端）。
 *
 * 为什么单独抽一个模块：埋点分析页同时要拿「明细表」和「图表」两组数据，
 * 如果两边各自解析一遍 query 参数，迟早会出现「表格筛了 event=click、
 * 图表忘了筛」这种对不上的情况 —— 而图表和表格数字对不上时，使用者
 * 第一反应是"埋点丢了"，排查成本极高。两边共用同一份 where，就不会有这个问题。
 */

import { sql, and, eq, gte, inArray, isNotNull, isNull, like, or, type SQL } from "drizzle-orm"
import { analyticsEvents } from "@/lib/db/schema"
import {
  ALLOWED_EVENTS,
  EVENT_CATEGORIES,
  EVENT_META,
  type EventCategory,
} from "@/lib/analytics-events"
import { parseRange, rangeStart, type StatsRange } from "@/lib/admin-range"

export interface EventFilter {
  /** 精确事件名。非白名单值一律丢弃。 */
  event: string | null
  /** 事件分类，展开成 event IN (...) 再与 event 求交。 */
  category: EventCategory | null
  /** 指定用户。 */
  userId: string | null
  /**
   * 身份维度。
   *   all        —— 不筛
   *   anonymous  —— user_id IS NULL。匿名流量是漏斗第一段，必须能单独看：
   *                 "有多少人来了连账号都没注册"这个问题只有它能回答
   *   registered —— user_id IS NOT NULL
   */
  identity: "all" | "anonymous" | "registered"
  /** 页面路径包含匹配。 */
  pageUrl: string | null
  /** 关键词：同时匹配事件名、页面路径与 properties 原文。 */
  q: string | null
  range: StatsRange
  /** 时间起点，range=all 时为 null。 */
  from: Date | null
}

export const IDENTITY_VALUES = ["all", "anonymous", "registered"] as const
export type EventIdentity = (typeof IDENTITY_VALUES)[number]

function clip(raw: string | null, max: number): string | null {
  const v = (raw ?? "").trim()
  return v ? v.slice(0, max) : null
}

export function parseEventFilter(searchParams: URLSearchParams): EventFilter {
  const rawEvent = clip(searchParams.get("event"), 100)
  const rawCategory = clip(searchParams.get("category"), 20)
  const range = parseRange(searchParams.get("range"))

  return {
    // 只接受白名单内的事件名。URL 是可控输入，drizzle 会参数化（没有注入风险），
    // 但放行任意字符串会让「筛一个不存在的事件」返回空表，
    // 使用者分不清是"这段时间真没数据"还是"参数写错了"
    event: rawEvent && (ALLOWED_EVENTS as readonly string[]).includes(rawEvent) ? rawEvent : null,
    category:
      rawCategory && (EVENT_CATEGORIES as readonly string[]).includes(rawCategory)
        ? (rawCategory as EventCategory)
        : null,
    userId: clip(searchParams.get("userId"), 36),
    identity: (IDENTITY_VALUES as readonly string[]).includes(searchParams.get("identity") ?? "")
      ? (searchParams.get("identity") as EventIdentity)
      : "all",
    pageUrl: clip(searchParams.get("pageUrl"), 200),
    q: clip(searchParams.get("q"), 100),
    range,
    from: rangeStart(range),
  }
}

/**
 * LIKE 通配符转义。
 *
 * 不转义的话，搜「100%」会变成"匹配 100 后面任意内容"，搜「a_b」里的下划线
 * 会匹配任意单字符 —— 结果比预期多，而且从界面上完全看不出原因。
 * 反斜杠必须第一个替换，否则会把后面刚加上的转义反斜杠再转义一次。
 */
export function escapeLike(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

function categoryEventList(category: EventCategory | null): string[] | null {
  if (!category) return null
  return ALLOWED_EVENTS.filter((e) => EVENT_META[e].category === category)
}

/**
 * 构造 WHERE。返回 undefined 表示无任何条件（range=all 且没筛任何东西），
 * drizzle 会把 undefined 当作"不加 WHERE"。
 */
export function buildEventWhere(filter: EventFilter): SQL | undefined {
  const parts: SQL[] = []

  if (filter.from) parts.push(gte(analyticsEvents.createdAt, filter.from))

  if (filter.event) {
    // 具体事件优先于分类：event=click&category=payment 会互相矛盾，
    // 一起拼只会得到恒空结果，使用者只会以为是没数据
    parts.push(eq(analyticsEvents.eventType, filter.event))
  } else {
    const list = categoryEventList(filter.category)
    if (list && list.length > 0) parts.push(inArray(analyticsEvents.eventType, list))
  }

  if (filter.userId) {
    // 指定了具体用户就不再套身份条件：两者互斥，一起拼会得到恒空结果，
    // 使用者只会以为是没数据
    parts.push(eq(analyticsEvents.userId, filter.userId))
  } else if (filter.identity === "anonymous") {
    parts.push(isNull(analyticsEvents.userId))
  } else if (filter.identity === "registered") {
    parts.push(isNotNull(analyticsEvents.userId))
  }

  if (filter.pageUrl) {
    parts.push(like(analyticsEvents.pageUrl, `%${escapeLike(filter.pageUrl)}%`))
  }

  if (filter.q) {
    const needle = `%${escapeLike(filter.q)}%`
    // CAST(... AS CHAR)：properties 是 JSON 列，直接 LIKE 在 MySQL 8 上
    // 按二进制比较，搜不到 JSON 里的内容；转成字符再匹配才行。
    //
    // visitor_id 也纳入搜索：埋点详情页的「访客」一栏就是用它跳到这里筛轨迹的，
    // 漏了它那个链接会落空（详情页有值、列表页筛不出，看起来像数据丢了）。
    //
    // 这里手写了列引用，是因为 JSON 列的 CAST 没有对应的 drizzle 构造器。
    // properties 是本表列，单表查询里本就该生成不带表限定的 `properties`，
    // 所以这里不会踩「drizzle 剥离表限定符导致相关子查询算错」的坑
    // （那个坑见 src/app/api/admin/users/route.ts 的注释）
    const matched = or(
      like(analyticsEvents.pageUrl, needle),
      like(analyticsEvents.eventType, needle),
      like(analyticsEvents.visitorId, needle),
      sql`CAST(${analyticsEvents.properties} AS CHAR) LIKE ${needle}`,
    )
    if (matched) parts.push(matched)
  }

  return parts.length > 0 ? and(...parts) : undefined
}
