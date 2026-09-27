/**
 * 后台页面之间的钻取链接构造。
 *
 * 为什么收敛成一个函数：仪表盘、漏斗报表、用户详情三处都要往「埋点分析」跳，
 * 每处手写一遍 query 拼接，参数名写错时**不会报错**——点过去只是筛不出东西，
 * 而"筛不出东西"在这个系统里恰好是最常见的正常状态（新站点数据少），
 * 于是错了也发现不了。集中一处 + 单测覆盖，改参数名时编译器会帮忙找全。
 */

import type { StatsRange } from "@/lib/admin-range"

export interface EventsQuery {
  /** 精确事件名（白名单内的）。 */
  event?: string | null
  /** 事件分类。 */
  category?: string | null
  /** 时间范围。 */
  range?: StatsRange | null
  /** 指定用户。 */
  userId?: string | null
  /** 身份维度。 */
  identity?: "all" | "anonymous" | "registered" | null
  /** 页面路径。 */
  pageUrl?: string | null
  /** 关键词。 */
  q?: string | null
}

/**
 * 生成 /admin/events 的链接。
 *
 * 空值一律不写进 query：undefined 会变成 `event=undefined` 这种字符串，
 * 接口侧会当成一个（非法、被丢弃的）筛选值，看链接的人却以为筛了。
 */
export function eventsUrl(query: EventsQuery = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue
    // identity=all 是默认值，写不写等价，省掉让链接短一点
    if (key === "identity" && value === "all") continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `/admin/events?${qs}` : "/admin/events"
}

/** 某个埋点记录的详情页链接。 */
export function eventDetailUrl(id: string | number): string {
  return `/admin/events/${id}`
}
