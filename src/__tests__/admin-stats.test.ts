/**
 * 后台统计的两个纯逻辑模块：
 *   - src/lib/admin-range.ts   时间范围（近一周/一月/一季/不限）
 *   - src/lib/stats-cache.ts   带 TTL 的统计缓存（isCacheStale）
 *
 * 这两处的边界都容易写错且不易察觉，所以单独钉住：
 *   - 范围起点算错 → 报表数字看着正常但口径不对，几乎没人会发现；
 *   - 缓存判定写反 → 要么每次仍全表扫描（缓存形同不存在），要么永远不刷新（数字冻住）。
 */
import { describe, it, expect } from "vitest"
import {
  rangeQueryString,
  defaultCustomRange,
  todayShanghai,
  parseRange,
  parseRangeQuery,
  rangeStart,
  rangeEnd,
  rangeLabel,
  resolveRange,
  isValidDateStr,
  RANGE_OPTIONS,
  RANGE_VALUES,
  DEFAULT_RANGE,
} from "@/lib/admin-range"
import { shanghaiDayStart, toShanghaiDateStr } from "@/lib/practice-stats"
import { readRangeSelection } from "@/lib/admin-range-filters"
import { isCacheStale, DEFAULT_TTL_MS } from "@/lib/stats-cache"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0)

describe("parseRange", () => {
  it("识别四个合法值", () => {
    for (const v of RANGE_VALUES) expect(parseRange(v)).toBe(v)
  })

  it("空值与非法值回落到默认（展示层参数不该抛错）", () => {
    for (const bad of [null, undefined, "", "7d", "WEEK", "year", "随便"]) {
      expect(parseRange(bad as string | null | undefined)).toBe(DEFAULT_RANGE)
    }
  })

  it("大小写敏感（避免 'WEEK' 这类未定义语义被悄悄接受）", () => {
    expect(parseRange("Week")).toBe(DEFAULT_RANGE)
  })
})

describe("rangeStart", () => {
  it("近一周 = 7 天前", () => {
    expect(rangeStart("week", NOW)!.getTime()).toBe(NOW - 7 * DAY)
  })
  it("近一月 = 30 天前", () => {
    expect(rangeStart("month", NOW)!.getTime()).toBe(NOW - 30 * DAY)
  })
  it("近一季 = 90 天前", () => {
    expect(rangeStart("quarter", NOW)!.getTime()).toBe(NOW - 90 * DAY)
  })
  it("不限 返回 null（调用方据此不加时间条件）", () => {
    expect(rangeStart("all", NOW)).toBeNull()
  })
  it("是纯函数：同一入参结果稳定", () => {
    expect(rangeStart("month", NOW)!.getTime()).toBe(rangeStart("month", NOW)!.getTime())
  })
})

describe("RANGE_OPTIONS", () => {
  it("选项与取值一一对应，且都有中文标签", () => {
    expect(RANGE_OPTIONS.map((o) => o.value)).toEqual([...RANGE_VALUES])
    for (const o of RANGE_OPTIONS) expect(o.label.length).toBeGreaterThan(0)
  })
  it("rangeLabel 对每个取值都给出标签，且非法值不崩", () => {
    for (const v of RANGE_VALUES) expect(rangeLabel(v).length).toBeGreaterThan(0)
    expect(rangeLabel("nope" as never)).toBe("不限")
  })
})

describe("isCacheStale", () => {
  const ttl = DEFAULT_TTL_MS

  it("没有记录 → 过期（需要计算）", () => {
    expect(isCacheStale(null, ttl, NOW)).toBe(true)
    expect(isCacheStale(undefined, ttl, NOW)).toBe(true)
    expect(isCacheStale("", ttl, NOW)).toBe(true)
  })

  it("刚写入 → 未过期（命中缓存，不再全表扫描）", () => {
    expect(isCacheStale(new Date(NOW - 1000).toISOString(), ttl, NOW)).toBe(false)
  })

  it("边界：正好等于 TTL → 过期", () => {
    expect(isCacheStale(new Date(NOW - ttl).toISOString(), ttl, NOW)).toBe(true)
  })

  it("边界：TTL 差 1ms → 未过期", () => {
    expect(isCacheStale(new Date(NOW - ttl + 1).toISOString(), ttl, NOW)).toBe(false)
  })

  it("脏数据 / 未来时间一律视为过期（宁可多算一次）", () => {
    expect(isCacheStale("不是时间", ttl, NOW)).toBe(true)
    expect(isCacheStale(new Date(NOW + 60_000).toISOString(), ttl, NOW)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 今天 / 自定义：这两项是 2026-09-29 加的，边界比预设窗口更容易错
// ─────────────────────────────────────────────────────────────────────────────

describe("今天：必须是上海日历日，不能是滚动 24 小时", () => {
  // 上海上午 9:30 —— 这个时刻最能暴露 "now - 24h" 的写法：
  // 它会把 09-28 下午的数据算进"今天"
  const SH_MORNING = Date.parse("2026-09-29T09:30:00+08:00")

  it("起点等于上海当日 00:00", () => {
    const start = rangeStart("today", SH_MORNING)!
    expect(start.getTime()).toBe(shanghaiDayStart("2026-09-29").getTime())
  })

  it("**不是** now - 24 小时（写错就变成滚动窗口，与签到/额度的口径不一致）", () => {
    const start = rangeStart("today", SH_MORNING)!
    expect(start.getTime()).not.toBe(SH_MORNING - DAY)
  })

  it("UTC 与上海跨日时仍按上海算（UTC 15:00 = 上海次日 23:00）", () => {
    const utcLate = Date.parse("2026-09-28T16:30:00Z") // 上海 09-29 00:30
    expect(toShanghaiDateStr(new Date(utcLate))).toBe("2026-09-29")
    expect(rangeStart("today", utcLate)!.getTime()).toBe(shanghaiDayStart("2026-09-29").getTime())
  })

  it("终点是当天 23:59:59.999（闭区间，且不越过次日）", () => {
    const end = rangeEnd("today", SH_MORNING)!
    expect(end.getTime()).toBe(shanghaiDayStart("2026-09-29").getTime() + DAY - 1)
    expect(end.getTime()).toBeLessThan(shanghaiDayStart("2026-09-30").getTime())
  })

  it("预设窗口都没有上界（滚动窗口语义是「到现在」）", () => {
    for (const r of ["week", "month", "quarter"] as const) {
      expect(rangeEnd(r, NOW)).toBeNull()
    }
  })
})

describe("isValidDateStr", () => {
  it("只认严格的 YYYY-MM-DD", () => {
    expect(isValidDateStr("2026-09-01")).toBe(true)
    for (const bad of ["2026-9-1", "26-09-01", "2026/09/01", "", null, undefined, "2026-13-01x"]) {
      expect(isValidDateStr(bad)).toBe(false)
    }
  })
})

describe("parseRangeQuery", () => {
  it("没有 range 参数时返回 null（调用方据此区分「默认窗口」与「不按时间筛」）", () => {
    expect(parseRangeQuery(new URLSearchParams(""))).toBeNull()
    expect(parseRangeQuery(new URLSearchParams("page=1"))).toBeNull()
  })

  it("带上 from/to", () => {
    const q = parseRangeQuery(new URLSearchParams("range=custom&from=2026-09-01&to=2026-09-10"))
    expect(q).toEqual({ range: "custom", from: "2026-09-01", to: "2026-09-10" })
  })
})

describe("resolveRange · 自定义", () => {
  it("窗口含两端当天（end 取 to 的 23:59:59.999）", () => {
    const w = resolveRange({ range: "custom", from: "2026-09-01", to: "2026-09-10" })
    expect(w.start!.getTime()).toBe(shanghaiDayStart("2026-09-01").getTime())
    expect(w.end!.getTime()).toBe(shanghaiDayStart("2026-09-10").getTime() + DAY - 1)
    expect(w.label).toBe("2026-09-01 ~ 2026-09-10")
  })

  it("日期点反了自动交换（纠正比报错好用）", () => {
    const w = resolveRange({ range: "custom", from: "2026-09-10", to: "2026-09-01" })
    expect(w.label).toBe("2026-09-01 ~ 2026-09-10")
  })

  it("参数不完整时**回落到有界窗口**，绝不退化成无界查询", () => {
    for (const q of [
      { range: "custom" as const, from: "2026-09-01", to: null },
      { range: "custom" as const, from: null, to: "2026-09-10" },
      { range: "custom" as const, from: "乱写", to: "2026-09-10" },
    ]) {
      const w = resolveRange(q)
      expect(w.start, `${JSON.stringify(q)} 应有起点`).not.toBeNull()
      expect(w.label).toContain("自定义日期不完整")
    }
  })
})

describe("resolveRange · 预设", () => {
  it("标签与实际窗口一致", () => {
    for (const r of ["today", "week", "month", "quarter", "all"] as const) {
      const w = resolveRange({ range: r, from: null, to: null }, NOW)
      expect(w.range).toBe(r)
      expect(w.label).toBe(rangeLabel(r))
    }
  })

  it("不限 = 两端都不加条件", () => {
    const w = resolveRange({ range: "all", from: null, to: null }, NOW)
    expect(w.start).toBeNull()
    expect(w.end).toBeNull()
  })
})

describe("rangeQueryString（前端拼 query 用）", () => {
  it("预设只带 range 一个参数", () => {
    expect(rangeQueryString({ range: "week", from: null, to: null })).toBe("range=week")
    expect(rangeQueryString({ range: "today", from: null, to: null })).toBe("range=today")
  })

  it("自定义带上 from/to", () => {
    const qs = rangeQueryString({ range: "custom", from: "2026-09-01", to: "2026-09-10" })
    expect(qs).toContain("range=custom")
    expect(qs).toContain("from=2026-09-01")
    expect(qs).toContain("to=2026-09-10")
  })

  it("自定义但缺日期时不编造参数（后端会回落并在标签里说明）", () => {
    const qs = rangeQueryString({ range: "custom", from: null, to: null })
    expect(qs).toBe("range=custom")
  })
})

describe("todayShanghai / defaultCustomRange", () => {
  it("今天按上海算，是 YYYY-MM-DD", () => {
    expect(todayShanghai(Date.parse("2026-09-28T16:30:00Z"))).toBe("2026-09-29")
  })

  it("自定义默认区间是含今天的近 7 天", () => {
    const now = Date.parse("2026-09-29T09:30:00+08:00")
    expect(defaultCustomRange(now)).toEqual({ from: "2026-09-23", to: "2026-09-29" })
  })
})

describe("readRangeSelection（从 refine filters 读回）", () => {
  it("缺 range 时回落到默认窗口", () => {
    expect(readRangeSelection([])).toEqual({ range: DEFAULT_RANGE, from: null, to: null })
    expect(readRangeSelection(undefined)).toEqual({ range: DEFAULT_RANGE, from: null, to: null })
  })

  it("预设窗口丢弃 from/to（避免切换后残留旧区间）", () => {
    const sel = readRangeSelection([
      { field: "range", value: "week" },
      { field: "from", value: "2026-01-01" },
      { field: "to", value: "2026-01-31" },
    ])
    expect(sel).toEqual({ range: "week", from: null, to: null })
  })

  it("自定义时读回两端，且只认严格的日期串", () => {
    expect(
      readRangeSelection([
        { field: "range", value: "custom" },
        { field: "from", value: "2026-09-01" },
        { field: "to", value: "2026-09-10" },
      ]),
    ).toEqual({ range: "custom", from: "2026-09-01", to: "2026-09-10" })

    expect(
      readRangeSelection([
        { field: "range", value: "custom" },
        { field: "from", value: "不是日期" },
      ]),
    ).toEqual({ range: "custom", from: null, to: null })
  })

  it("非法 range 值回落到默认", () => {
    expect(readRangeSelection([{ field: "range", value: "去年" }]).range).toBe(DEFAULT_RANGE)
  })
})
