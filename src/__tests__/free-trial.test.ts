/**
 * 非会员试学切片（src/lib/free-trial.ts）。
 *
 * 存在的理由：课程正文就是付费内容，此前非会员拿不到任何句子（直接 403），
 * 用户没机会体验就先撞墙；改成放行前 N 句之后，「非会员最多只能拿到 limit 句」
 * 就从一句口头承诺变成了必须守住的内容泄露边界 —— 这条边界由本文件的测试看住。
 */
import { describe, it, expect } from "vitest"
import { sliceForTrial, FREE_TRIAL_SENTENCES } from "@/lib/free-trial"

const many = ["s1", "s2", "s3", "s4", "s5", "s6"]

describe("sliceForTrial · 会员", () => {
  it("会员拿到全部句子，且 trial 为 null（不能被判成试学态）", () => {
    const r = sliceForTrial(many, true)
    expect(r.visible).toEqual(many)
    expect(r.trial).toBeNull()
  })

  it("会员即使句子很少也不带 truncated", () => {
    const r = sliceForTrial(["s1"], true)
    expect(r.visible).toEqual(["s1"])
    expect(r.trial).toBeNull()
  })
})

describe("sliceForTrial · 非会员", () => {
  it("默认只放行前 3 句，并标记还有更多", () => {
    const r = sliceForTrial(many, false)
    expect(r.visible).toEqual(["s1", "s2", "s3"])
    expect(r.trial).toEqual({ limit: FREE_TRIAL_SENTENCES, truncated: true })
  })

  it("句子数正好等于上限 → truncated 为 false（没有更多可藏）", () => {
    const r = sliceForTrial(["s1", "s2", "s3"], false)
    expect(r.visible).toEqual(["s1", "s2", "s3"])
    expect(r.trial).toEqual({ limit: 3, truncated: false })
  })

  it("句子数少于上限 → 全部放行且不标记截断", () => {
    const r = sliceForTrial(["s1", "s2"], false)
    expect(r.visible).toEqual(["s1", "s2"])
    expect(r.trial).toEqual({ limit: 3, truncated: false })
  })

  it("空课时 → 空数组，不抛异常", () => {
    const r = sliceForTrial([], false)
    expect(r.visible).toEqual([])
    expect(r.trial).toEqual({ limit: 3, truncated: false })
  })

  it("核心不变量：非会员拿到的句数永远不超过 limit", () => {
    for (const total of [0, 1, 3, 10, 500]) {
      const all = Array.from({ length: total }, (_, i) => `s${i}`)
      for (const limit of [1, 3, 5]) {
        const r = sliceForTrial(all, false, limit)
        expect(r.visible.length).toBeLessThanOrEqual(limit)
        expect(r.visible).toEqual(all.slice(0, limit))
      }
    }
  })

  it("自定义 limit 生效", () => {
    const r = sliceForTrial(many, false, 1)
    expect(r.visible).toEqual(["s1"])
    expect(r.trial).toEqual({ limit: 1, truncated: true })
  })

  it("异常 limit 被夹到合法区间（0 / 负数 / 小数）", () => {
    expect(sliceForTrial(many, false, 0).visible).toEqual([])
    expect(sliceForTrial(many, false, -5).visible).toEqual([])
    expect(sliceForTrial(many, false, -5).trial).toEqual({ limit: 0, truncated: true })
    expect(sliceForTrial(many, false, 2.9).visible).toEqual(["s1", "s2"])
  })
})

describe("sliceForTrial · 不改动入参", () => {
  it("返回的是副本，调用方后续 push 不会污染原数组（会员分支尤其重要）", () => {
    const input = ["s1", "s2", "s3", "s4"]
    const r = sliceForTrial(input, true)
    r.visible.push("injected")
    expect(input).toEqual(["s1", "s2", "s3", "s4"])
  })
})
