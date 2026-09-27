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
  parseRange,
  rangeStart,
  rangeLabel,
  RANGE_OPTIONS,
  RANGE_VALUES,
  DEFAULT_RANGE,
} from "@/lib/admin-range"
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
