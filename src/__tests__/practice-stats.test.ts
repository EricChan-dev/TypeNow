import { describe, it, expect } from "vitest"
import {
  buildDailySeries,
  computeStreak,
  shiftShanghaiDate,
  shanghaiDayStart,
  toShanghaiDateStr,
} from "@/lib/practice-stats"

// 服务于首页「本周练习」周视图与签到 streak：全站日期口径必须是 Asia/Shanghai。
// DATETIME 以 +08:00 墙上时间存储（见 lib/db），所以 SQL 侧直接用 DATE(created_at)，
// 这里负责把「今天」和连续日序列算对。

describe("toShanghaiDateStr", () => {
  it("把 UTC 深夜折算为上海的后一天", () => {
    // 2026-09-21T20:00Z = 2026-09-22 04:00 CST
    expect(toShanghaiDateStr(new Date("2026-09-21T20:00:00Z"))).toBe("2026-09-22")
  })

  it("UTC 日期与上海日期相同的情形不受影响", () => {
    // 2026-09-21T02:00Z = 2026-09-21 10:00 CST
    expect(toShanghaiDateStr(new Date("2026-09-21T02:00:00Z"))).toBe("2026-09-21")
  })

  it("CST 00:00-08:00 不会退回上一天（这正是 UTC 写法的错处）", () => {
    // 2026-09-21T00:30+08:00 = 2026-09-20T16:30Z，UTC 日期是 20 日
    const d = new Date("2026-09-21T00:30:00+08:00")
    expect(d.toISOString().slice(0, 10)).toBe("2026-09-20")
    expect(toShanghaiDateStr(d)).toBe("2026-09-21")
  })
})

describe("shanghaiDayStart", () => {
  it("返回上海当天 00:00 对应的 UTC 时刻", () => {
    expect(shanghaiDayStart("2026-09-21").toISOString()).toBe("2026-09-20T16:00:00.000Z")
  })
})

describe("shiftShanghaiDate", () => {
  it("前后偏移一天", () => {
    expect(shiftShanghaiDate("2026-09-21", 1)).toBe("2026-09-22")
    expect(shiftShanghaiDate("2026-09-21", -1)).toBe("2026-09-20")
    expect(shiftShanghaiDate("2026-09-21", 0)).toBe("2026-09-21")
  })

  it("跨月跨年正确", () => {
    expect(shiftShanghaiDate("2026-03-01", -1)).toBe("2026-02-28")
    expect(shiftShanghaiDate("2026-01-01", -1)).toBe("2025-12-31")
    expect(shiftShanghaiDate("2025-12-31", 1)).toBe("2026-01-01")
  })

  it("偏移 6 天给出周窗口起点", () => {
    expect(shiftShanghaiDate("2026-09-21", -6)).toBe("2026-09-15")
  })
})

describe("computeStreak", () => {
  it("空数据为 0", () => {
    expect(computeStreak([], "2026-09-21")).toBe(0)
  })

  it("今天起连续计数", () => {
    expect(computeStreak(["2026-09-21", "2026-09-20", "2026-09-19"], "2026-09-21")).toBe(3)
  })

  it("今天还没打卡时从昨天起算，不清零", () => {
    expect(computeStreak(["2026-09-20", "2026-09-19"], "2026-09-21")).toBe(2)
  })

  it("昨天也没打卡则为 0", () => {
    expect(computeStreak(["2026-09-19"], "2026-09-21")).toBe(0)
  })

  it("中间断档即停止", () => {
    expect(computeStreak(["2026-09-21", "2026-09-19", "2026-09-18"], "2026-09-21")).toBe(1)
  })

  it("跨月连续正确", () => {
    expect(computeStreak(["2026-03-01", "2026-02-28", "2026-02-27"], "2026-03-01")).toBe(3)
  })
})

describe("buildDailySeries", () => {
  const today = new Date("2026-09-21T10:00:00+08:00") // 上海 2026-09-21 10:00

  it("空数据时返回 7 天且全部补 0", () => {
    const series = buildDailySeries([], today)
    expect(series).toHaveLength(7)
    expect(series.every((d) => d.count === 0)).toBe(true)
    expect(series[0].date).toBe("2026-09-15")
    expect(series[6].date).toBe("2026-09-21")
  })

  it("最后一项始终是今天，前端无需自己算时区", () => {
    expect(buildDailySeries([], today).at(-1)!.date).toBe("2026-09-21")
    // 上海已是 22 日（UTC 还是 21 日）
    const lateNight = new Date("2026-09-21T20:00:00Z")
    expect(buildDailySeries([], lateNight).at(-1)!.date).toBe("2026-09-22")
  })

  it("把已有计数放到正确的日期上", () => {
    const series = buildDailySeries(
      [
        { date: "2026-09-21", count: 12 },
        { date: "2026-09-18", count: 3 },
      ],
      today,
    )
    expect(series.find((d) => d.date === "2026-09-21")!.count).toBe(12)
    expect(series.find((d) => d.date === "2026-09-18")!.count).toBe(3)
    expect(series.find((d) => d.date === "2026-09-19")!.count).toBe(0)
  })

  it("忽略窗口之外的数据，不影响补齐", () => {
    const series = buildDailySeries(
      [
        { date: "2026-09-14", count: 99 }, // 窗口前一天
        { date: "2026-10-01", count: 99 }, // 未来
      ],
      today,
    )
    expect(series).toHaveLength(7)
    expect(series.every((d) => d.count === 0)).toBe(true)
  })

  it("重复日期累加", () => {
    const series = buildDailySeries(
      [
        { date: "2026-09-20", count: 2 },
        { date: "2026-09-20", count: 5 },
      ],
      today,
    )
    expect(series.find((d) => d.date === "2026-09-20")!.count).toBe(7)
  })

  it("跨月回推正确", () => {
    const series = buildDailySeries([], new Date("2026-03-03T12:00:00+08:00"))
    expect(series.map((d) => d.date)).toEqual([
      "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28",
      "2026-03-01", "2026-03-02", "2026-03-03",
    ])
  })

  it("返回升序日期", () => {
    const dates = buildDailySeries([], today).map((d) => d.date)
    expect(dates).toEqual([...dates].sort())
  })

  it("非法 count 不产生 NaN", () => {
    const series = buildDailySeries([{ date: "2026-09-21", count: Number.NaN }], today)
    expect(series.every((d) => Number.isFinite(d.count))).toBe(true)
  })
})
