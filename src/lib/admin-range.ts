/**
 * 后台统计的时间范围。
 *
 * 纯模块、无服务端依赖（只依赖同样是纯模块的 practice-stats）：
 * 接口用它算窗口，前端用它渲染选项，两边共用一份定义才不会出现
 * "界面显示近一月、接口按近一周过滤"这种对不上的情况。
 *
 * ── 两种范围，语义不同，不要混 ──────────────────────────────────────────────
 *
 *   · **滚动窗口**（今天 / 近一周 / 近一月 / 近一季）：从"此刻"往回数。
 *     用固定天数（7 / 30 / 90）而不是"自然周/自然月"：自然周期的边界会让
 *     「近一月」在月初突然只剩 1 天数据，看起来像数据丢了。
 *   · **今天**是唯一的例外，它必须是**上海日历日**的 00:00 起，不能写成
 *     "now - 24 小时" —— 后者在 09-29 早上会包含 09-28 下午的数据，
 *     与用户在别处看到的"今天"（签到、额度、打卡）不是同一个口径。
 *     所以这里复用 practice-stats 的 shanghaiDayStart，而不是自己算。
 *   · **自定义**：显式 from/to（YYYY-MM-DD，上海日历日，含当天）。
 *
 * ── 为什么自定义缺参数时要回落到默认而不是"不限" ────────────────────────────
 *
 * `custom` 但 from/to 不合法时，如果当成"不限"，就会变成一次无界查询
 * （sentences 单表 3GB，全表扫的代价很实在）。所以回落到默认的「近一周」，
 * 并在 label 上如实体现 —— 界面上看到的就是实际生效的。
 */

import { shanghaiDayStart, shiftShanghaiDate, toShanghaiDateStr } from "@/lib/practice-stats"

export const RANGE_VALUES = ["today", "week", "month", "quarter", "all", "custom"] as const
export type StatsRange = (typeof RANGE_VALUES)[number]

export const RANGE_OPTIONS: ReadonlyArray<{ value: StatsRange; label: string }> = [
  { value: "today", label: "今天" },
  { value: "week", label: "近一周" },
  { value: "month", label: "近一月" },
  { value: "quarter", label: "近一季" },
  { value: "all", label: "不限" },
  { value: "custom", label: "自定义" },
]

export const DEFAULT_RANGE: StatsRange = "week"

/** 解析 query 里的 range；非法值回落到默认，不抛错（这是展示层参数）。 */
export function parseRange(raw: string | null | undefined): StatsRange {
  if (!raw) return DEFAULT_RANGE
  return (RANGE_VALUES as readonly string[]).includes(raw) ? (raw as StatsRange) : DEFAULT_RANGE
}

const DAY_MS = 24 * 60 * 60 * 1000

/** YYYY-MM-DD（严格）—— 避免 "2026-9-1" 这种被 Date 宽松解析出意外结果。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 是否是合法的上海日历日字符串，且不是 NaN 日期。 */
export function isValidDateStr(raw: string | null | undefined): raw is string {
  if (!raw || !DATE_RE.test(raw)) return false
  return !Number.isNaN(shanghaiDayStart(raw).getTime())
}

export interface RangeQuery {
  range: StatsRange
  from: string | null
  to: string | null
}

/**
 * 从 URL 查询参数解析范围。
 *
 * 返回 null 表示"压根没给 range 参数"—— 调用方据此区分
 * "按默认窗口过滤" 与 "不做时间过滤"（例如用户列表默认不按时间筛，
 * 套用 DEFAULT_RANGE 会让刚打开页面就少掉历史用户）。
 */
export function parseRangeQuery(searchParams: URLSearchParams): RangeQuery | null {
  const rawRange = searchParams.get("range")
  if (!rawRange) return null
  return {
    range: parseRange(rawRange),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  }
}

/**
 * 滚动窗口的起点。`all` 与 `custom` 返回 null：
 * 前者表示不加时间条件，后者的边界由 from/to 提供（见 resolveRange）。
 */
export function rangeStart(range: StatsRange, now: number = Date.now()): Date | null {
  switch (range) {
    case "today":
      // 上海日历日的 00:00。**不能**写成 now - DAY_MS（见文件头说明）
      return shanghaiDayStart(toShanghaiDateStr(new Date(now)))
    case "week":
      return new Date(now - 7 * DAY_MS)
    case "month":
      return new Date(now - 30 * DAY_MS)
    case "quarter":
      return new Date(now - 90 * DAY_MS)
    case "all":
    case "custom":
      return null
  }
}

/** 窗口的终点。只有自定义范围需要上界（预设窗口都是"到现在"）。 */
export function rangeEnd(range: StatsRange, now: number = Date.now()): Date | null {
  if (range === "today") {
    // 今天 23:59:59.999（上海）。虽然库里不会有未来数据，但显式给上界
    // 能让"今天"在任何调用方眼里都是闭区间，不会因为别处写错而串数据。
    return new Date(shanghaiDayStart(toShanghaiDateStr(new Date(now))).getTime() + DAY_MS - 1)
  }
  return null
}

export interface RangeWindow {
  range: StatsRange
  /** 起始时刻；null = 不加下界 */
  start: Date | null
  /** 结束时刻；null = 不加上界（即"到现在"） */
  end: Date | null
  /** 展示用标签。自定义范围会带上具体日期，且与**实际生效**的范围一致。 */
  label: string
}

/**
 * 把一次查询解析成实际生效的时间窗口。
 *
 * 自定义范围的两条兜底（都为了让"界面显示的"与"实际查的"一致）：
 *   · from/to 任一不合法 → 回落到默认窗口（绝不退化成无界查询）；
 *   · from > to → 交换两端（用户把日期点反了，纠正比报错好用）。
 */
export function resolveRange(query: RangeQuery, now: number = Date.now()): RangeWindow {
  if (query.range === "custom") {
    // 先取到局部变量再做类型收窄：直接对 query.from 判断，收窄不会带到
    // 后面重新赋值的局部变量上（TS 会认为它仍是 string | null）
    const fromRaw = query.from
    const toRaw = query.to
    if (isValidDateStr(fromRaw) && isValidDateStr(toRaw)) {
      let from: string = fromRaw
      let to: string = toRaw
      if (from > to) [from, to] = [to, from]
      return {
        range: "custom",
        start: shanghaiDayStart(from),
        // 含当天：end 取该日 23:59:59.999
        end: new Date(shanghaiDayStart(to).getTime() + DAY_MS - 1),
        label: `${from} ~ ${to}`,
      }
    }
    // 参数不全 → 回落，并在 label 里说明（不是静默当成"不限"）
    const fallback = DEFAULT_RANGE
    return {
      range: fallback,
      start: rangeStart(fallback, now),
      end: rangeEnd(fallback, now),
      label: `${rangeLabel(fallback)}（自定义日期不完整）`,
    }
  }

  return {
    range: query.range,
    start: rangeStart(query.range, now),
    end: rangeEnd(query.range, now),
    label: rangeLabel(query.range),
  }
}

export function rangeLabel(range: StatsRange): string {
  return RANGE_OPTIONS.find((o) => o.value === range)?.label ?? "不限"
}

/** 上海日历日的"今天"。前端默认日期用它 —— 不能拿 toISOString（那是 UTC 日期）。 */
export function todayShanghai(now: number = Date.now()): string {
  return toShanghaiDateStr(new Date(now))
}

/**
 * 切到「自定义」时的默认区间：近 7 天（含今天）。
 *
 * 必须给默认值而不能留空：`range=custom` 但缺 from/to 时后端会回落到近一周
 * 并在标签里注明"自定义日期不完整" —— 那是给手改 URL 兜底的，
 * 不该让正常操作也撞上。
 */
export function defaultCustomRange(now: number = Date.now()): { from: string; to: string } {
  const today = todayShanghai(now)
  return { from: shiftShanghaiDate(today, -6), to: today }
}

/** 一次时间选择（预设或自定义区间）。前端控件与 query 生成共用这一种形状。 */
export interface RangeSelection {
  range: StatsRange
  from: string | null
  to: string | null
}

/**
 * 把一次选择拼成 query 串（不含 `?`）。
 *
 * 只有自定义范围才带 from/to：预设窗口是"从现在往回数"，多带两个参数
 * 会让 URL 变长，也容易让人以为预设也能被日期覆盖。
 */
export function rangeQueryString(sel: RangeSelection): string {
  const params = new URLSearchParams({ range: sel.range })
  if (sel.range === "custom") {
    if (sel.from) params.set("from", sel.from)
    if (sel.to) params.set("to", sel.to)
  }
  return params.toString()
}
