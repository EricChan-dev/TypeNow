import { describe, expect, it } from "vitest"

import {
  ASPECT_LABELS,
  ASPECT_ORDER,
  TENSES,
  TENSE_GROUPS,
  TIME_LABELS,
  TIME_ORDER,
  tenseById,
} from "@/lib/tenses"

describe("tenses — 16 时态知识库数据完整性", () => {
  it("恰好 16 个时态", () => {
    expect(TENSES).toHaveLength(16)
  })

  it("4 时间 × 4 体 每个组合恰好出现一次", () => {
    const seen = new Set(TENSES.map((t) => `${t.time}/${t.aspect}`))
    expect(seen.size).toBe(16)
    for (const time of TIME_ORDER) {
      for (const aspect of ASPECT_ORDER) {
        expect(seen.has(`${time}/${aspect}`)).toBe(true)
      }
    }
  })

  it("id 唯一且非空", () => {
    const ids = TENSES.map((t) => t.id)
    expect(new Set(ids).size).toBe(16)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })

  it("每个时态的字段都填好（名称/构成/用法/标志词/例句）", () => {
    for (const t of TENSES) {
      expect(t.name.length, t.id).toBeGreaterThan(0)
      expect(t.enName.length, t.id).toBeGreaterThan(0)
      expect(t.formula.length, t.id).toBeGreaterThan(0)
      expect(t.negative.length, t.id).toBeGreaterThan(0)
      expect(t.question.length, t.id).toBeGreaterThan(0)
      expect(t.usage.length, t.id).toBeGreaterThan(0)
      expect(t.markers.length, t.id).toBeGreaterThanOrEqual(2)
      expect(t.markers.every((m) => m.length > 0), t.id).toBe(true)
      expect(t.examples, t.id).toHaveLength(2)
      for (const ex of t.examples) {
        expect(ex.en.length, t.id).toBeGreaterThan(0)
        expect(ex.zh.length, t.id).toBeGreaterThan(0)
        // 模板插值必须已解析，不允许残留占位符
        expect(ex.en.includes("${"), t.id).toBe(false)
      }
    }
  })

  it("总览分组：4 组按时间顺序，组内按体顺序，成员与 TENSES 一致", () => {
    expect(TENSE_GROUPS.map((g) => g.time)).toEqual(TIME_ORDER)
    for (const group of TENSE_GROUPS) {
      expect(group.items).toHaveLength(4)
      expect(group.items.map((t) => t.aspect)).toEqual(ASPECT_ORDER)
      expect(group.items.every((t) => t.time === group.time)).toBe(true)
    }
    expect(TENSE_GROUPS.flatMap((g) => g.items)).toHaveLength(16)
  })

  it("时间与体的中文标签齐全", () => {
    for (const time of TIME_ORDER) expect(TIME_LABELS[time].length).toBeGreaterThan(0)
    for (const aspect of ASPECT_ORDER) expect(ASPECT_LABELS[aspect].length).toBeGreaterThan(0)
  })

  it("tenseById 命中与未命中", () => {
    expect(tenseById("present-perfect")?.name).toBe("现在完成时")
    expect(tenseById("no-such-tense")).toBeUndefined()
  })
})
