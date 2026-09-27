/**
 * 后台统计的时间范围。
 *
 * 纯模块、无服务端依赖：接口用它算起点，前端用它渲染选项，两边共用一份定义
 * 才不会出现"界面显示近一月、接口按近一周过滤"这种对不上的情况。
 */

export const RANGE_VALUES = ["week", "month", "quarter", "all"] as const
export type StatsRange = (typeof RANGE_VALUES)[number]

export const RANGE_OPTIONS: ReadonlyArray<{ value: StatsRange; label: string }> = [
  { value: "week", label: "近一周" },
  { value: "month", label: "近一月" },
  { value: "quarter", label: "近一季" },
  { value: "all", label: "不限" },
]

export const DEFAULT_RANGE: StatsRange = "week"

/** 解析 query 里的 range；非法值回落到默认，不抛错（这是展示层参数）。 */
export function parseRange(raw: string | null | undefined): StatsRange {
  if (!raw) return DEFAULT_RANGE
  return (RANGE_VALUES as readonly string[]).includes(raw) ? (raw as StatsRange) : DEFAULT_RANGE
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 范围起点。`all` 返回 null，表示不加时间条件。
 *
 * 用固定天数（7 / 30 / 90）而不是"自然周/自然月"：自然周期的边界会让
 * 「近一月」在月初突然只剩 1 天数据，看起来像数据丢了。滚动窗口对使用者更好理解。
 */
export function rangeStart(range: StatsRange, now: number = Date.now()): Date | null {
  switch (range) {
    case "week":
      return new Date(now - 7 * DAY_MS)
    case "month":
      return new Date(now - 30 * DAY_MS)
    case "quarter":
      return new Date(now - 90 * DAY_MS)
    case "all":
      return null
  }
}

export function rangeLabel(range: StatsRange): string {
  return RANGE_OPTIONS.find((o) => o.value === range)?.label ?? "不限"
}
