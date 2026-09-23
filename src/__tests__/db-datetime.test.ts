/**
 * 全站时间口径回归测试（src/lib/db/index.ts）。
 *
 * 这一组守的是一个曾经真实发生在生产库上的事故：drizzle 的 MySqlDateTime 按
 * UTC 做 Date ↔ 字符串映射，而库里的 created_at 大量来自 MySQL 默认值
 * CURRENT_TIMESTAMP（在 SET time_zone='+08:00' 下是 +08 墙上时间）。两种口径
 * 混在同一列里，比较运算的两个操作数就不在同一时间系上，表现是「60 秒冷却」
 * 变成 8 小时、统计窗口整体偏移 8 小时。
 *
 * 只要有人"顺手"删掉 patchDatetimeMapping()，或有人升级 drizzle 后映射实现变化，
 * 这里必须立刻红。
 */
import { describe, it, expect } from "vitest"
import { MySqlDateTime } from "drizzle-orm/mysql-core"
import { DB_TIME_ZONE, fromDbDateTime, toDbDateTime } from "@/lib/db"

describe("toDbDateTime — 输出 +08 墙上时间", () => {
  it("UTC 时刻被换算成上海墙上时间", () => {
    expect(toDbDateTime(new Date("2026-09-23T00:30:45Z"))).toBe("2026-09-23 08:30:45")
  })

  it("跨日边界：UTC 16:00 已经是上海次日 00:00", () => {
    expect(toDbDateTime(new Date("2026-09-23T16:00:00Z"))).toBe("2026-09-24 00:00:00")
    expect(toDbDateTime(new Date("2026-09-23T15:59:59Z"))).toBe("2026-09-23 23:59:59")
  })

  it("跨年边界", () => {
    expect(toDbDateTime(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01 00:00:00")
  })

  it("格式是 MySQL DATETIME 字面量（不是 ISO，没有 T/Z/毫秒）", () => {
    const out = toDbDateTime(new Date("2026-09-23T00:30:45.999Z"))
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    // 毫秒被截断（DATETIME(0) 存不下）
    expect(out).toBe("2026-09-23 08:30:45")
  })
})

describe("fromDbDateTime — 按 +08 解释库里的值", () => {
  it("字符串按上海时区解析成绝对时刻", () => {
    expect(fromDbDateTime("2026-09-23 08:30:45").toISOString()).toBe("2026-09-23T00:30:45.000Z")
  })

  it("Date 原样返回（mysql2 已经解析过的值不再二次换算）", () => {
    const d = new Date("2026-09-23T00:30:45.000Z")
    expect(fromDbDateTime(d).getTime()).toBe(d.getTime())
  })

  it("往返只损失毫秒，不产生时区漂移", () => {
    const now = new Date()
    const roundTrip = fromDbDateTime(toDbDateTime(now))
    expect(Math.abs(roundTrip.getTime() - now.getTime())).toBeLessThan(1000)
  })

  it("往返不改变「上海日历日」（DATE(created_at) 必须恒等于上海日期）", () => {
    // 上海 00:10 与 23:50 分属两个日历日
    const early = new Date("2026-09-22T16:10:00Z") // 上海 09-23 00:10
    const late = new Date("2026-09-23T15:50:00Z") // 上海 09-23 23:50
    for (const d of [early, late]) {
      const stored = toDbDateTime(d)
      expect(stored.slice(0, 10)).toBe("2026-09-23")
      expect(fromDbDateTime(stored).getTime()).toBe(d.getTime() - (d.getTime() % 1000))
    }
  })
})

describe("drizzle MySqlDateTime 映射已被统一到 +08", () => {
  const proto = MySqlDateTime.prototype as unknown as {
    mapToDriverValue: (value: Date) => string
    mapFromDriverValue: (value: string) => Date
  }

  it("mapToDriverValue 写 +08 墙上时间，而不是 UTC", () => {
    // 补丁前这里会得到 "2026-09-23 00:30:45"（UTC），差 8 小时
    expect(proto.mapToDriverValue(new Date("2026-09-23T00:30:45Z"))).toBe("2026-09-23 08:30:45")
  })

  it("mapFromDriverValue 按 +08 读，而不是按 UTC 读", () => {
    // 补丁前这里会得到 2026-09-23T08:30:45Z，整体后移 8 小时
    expect(proto.mapFromDriverValue("2026-09-23 08:30:45").toISOString()).toBe(
      "2026-09-23T00:30:45.000Z"
    )
  })

  it("DB_TIME_ZONE 与实际偏移一致（三处口径不能各自为政）", () => {
    expect(DB_TIME_ZONE).toBe("+08:00")
    const d = new Date("2026-09-23T00:00:00Z")
    const sample = fromDbDateTime(toDbDateTime(d))
    expect(sample.getTime()).toBe(d.getTime())
  })
})
