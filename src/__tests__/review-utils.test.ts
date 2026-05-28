import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { masteryLabel, fmtDate, defaultName, randomSuffix } from "@/lib/review-utils"

// ── masteryLabel ───────────────────────────────────────────────────────────────

describe("masteryLabel", () => {
  it('returns "已掌握" when status is "done" regardless of intervalDays', () => {
    expect(masteryLabel({ status: "done", intervalDays: 1 }).label).toBe("已掌握")
    expect(masteryLabel({ status: "done", intervalDays: 30 }).label).toBe("已掌握")
  })

  it('returns "接近掌握" when status is pending and intervalDays >= 6', () => {
    expect(masteryLabel({ status: "pending", intervalDays: 6 }).label).toBe("接近掌握")
    expect(masteryLabel({ status: "pending", intervalDays: 13 }).label).toBe("接近掌握")
    expect(masteryLabel({ status: "pending", intervalDays: 30 }).label).toBe("接近掌握")
  })

  it('returns "复习中" when status is pending and 2 <= intervalDays < 6', () => {
    expect(masteryLabel({ status: "pending", intervalDays: 2 }).label).toBe("复习中")
    expect(masteryLabel({ status: "pending", intervalDays: 5 }).label).toBe("复习中")
  })

  it('returns "初学" when status is pending and intervalDays < 2', () => {
    expect(masteryLabel({ status: "pending", intervalDays: 1 }).label).toBe("初学")
    expect(masteryLabel({ status: "pending", intervalDays: 0 }).label).toBe("初学")
  })

  it('"done" overrides intervalDays — even intervalDays=30 with status done is 已掌握', () => {
    expect(masteryLabel({ status: "done", intervalDays: 30 }).label).toBe("已掌握")
  })

  it("returns correct color class for each tier", () => {
    expect(masteryLabel({ status: "done", intervalDays: 1 }).color).toContain("emerald")
    expect(masteryLabel({ status: "pending", intervalDays: 7 }).color).toContain("violet")
    expect(masteryLabel({ status: "pending", intervalDays: 3 }).color).toContain("blue")
    expect(masteryLabel({ status: "pending", intervalDays: 1 }).color).toContain("foreground")
  })
})

// ── fmtDate ───────────────────────────────────────────────────────────────────

describe("fmtDate", () => {
  const NOW = new Date("2026-05-28T12:00:00.000Z")

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "—" for null', () => {
    expect(fmtDate(null)).toBe("—")
  })

  it('returns "今日" for a past date', () => {
    expect(fmtDate("2026-05-27T12:00:00.000Z")).toBe("今日")
  })

  it('returns "今日" for the exact same moment', () => {
    expect(fmtDate("2026-05-28T12:00:00.000Z")).toBe("今日")
  })

  it('returns "今日" for a few hours earlier today', () => {
    expect(fmtDate("2026-05-28T06:00:00.000Z")).toBe("今日")
  })

  it('returns "明日" for exactly 1 day ahead', () => {
    expect(fmtDate("2026-05-29T12:00:00.000Z")).toBe("明日")
  })

  it('returns "N 天后" for dates further in the future', () => {
    expect(fmtDate("2026-05-31T12:00:00.000Z")).toBe("3 天后")
    expect(fmtDate("2026-06-07T12:00:00.000Z")).toBe("10 天后")
  })
})

// ── defaultName ───────────────────────────────────────────────────────────────

describe("defaultName", () => {
  it('returns a string matching "用户XXXX" for phone type', () => {
    const name = defaultName("phone")
    expect(name).toMatch(/^用户\d{4}$/)
  })

  it('returns a string matching "微信用户XXXX" for wechat type', () => {
    const name = defaultName("wechat")
    expect(name).toMatch(/^微信用户\d{4}$/)
  })

  it("suffix is always in range 1000–9999", () => {
    for (let i = 0; i < 50; i++) {
      const suffix = randomSuffix()
      expect(suffix).toBeGreaterThanOrEqual(1000)
      expect(suffix).toBeLessThanOrEqual(9999)
    }
  })

  it("generates different names across multiple calls (probabilistic)", () => {
    const names = new Set(Array.from({ length: 20 }, () => defaultName("phone")))
    expect(names.size).toBeGreaterThan(1)
  })
})
