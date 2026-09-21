import { describe, it, expect } from "vitest"
import { scoreForMistakes } from "@/lib/practice-score"

// 判分规则来自 docs/pages/04-practice.md：
//   Perfect     全部正确      → 10 分
//   Good        1-2 处小错误  →  6 分
//   Keep trying 超过 2 次错误 →  2 分
// 这三档是 practice_records.score 的唯一来源，首页与学习档案的
// bestScore / avgScore 直接聚合它。

describe("scoreForMistakes", () => {
  it("0 次错误 → Perfect / 10", () => {
    expect(scoreForMistakes(0)).toEqual({ score: 10, grade: "perfect" })
  })

  it("1-2 次错误 → Good / 6", () => {
    expect(scoreForMistakes(1)).toEqual({ score: 6, grade: "good" })
    expect(scoreForMistakes(2)).toEqual({ score: 6, grade: "good" })
  })

  it("超过 2 次错误 → Keep trying / 2", () => {
    expect(scoreForMistakes(3)).toEqual({ score: 2, grade: "keep_trying" })
    expect(scoreForMistakes(99)).toEqual({ score: 2, grade: "keep_trying" })
  })

  it("负数或非法输入按 0 次错误处理，不产生负分", () => {
    expect(scoreForMistakes(-5)).toEqual({ score: 10, grade: "perfect" })
    expect(scoreForMistakes(Number.NaN)).toEqual({ score: 10, grade: "perfect" })
  })

  it("小数会被截断为整数", () => {
    expect(scoreForMistakes(2.9)).toEqual({ score: 6, grade: "good" })
  })
})
