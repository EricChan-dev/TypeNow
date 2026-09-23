/**
 * 复习接口的业务规则单元测试。
 *
 * 这里覆盖的是从路由里抽出来的纯函数 `parseReviewCompletion` / `coerceGrade`
 * （src/lib/review-rules.ts）。HTTP 层的完整闭环在 tests/e2e/50-review.test.ts，
 * 两者互补：单元测试锁定「什么入参合法」，e2e 锁定「合法入参产生什么副作用」。
 *
 * 注意：本文件历史上是一组同义反复的断言（`const x = 1; expect(x).toBe(1)`、
 * 把路由逻辑在本文件里重抄一遍再断言自己抄的值），既不覆盖真实代码，会计进
 * 用例总数制造虚假信心。已整体重写为对真实模块的测试。
 */
import { describe, it, expect } from "vitest"
import { coerceGrade, parseReviewCompletion } from "@/lib/review-rules"
import { sm2 } from "@/lib/spaced-repetition"

describe("coerceGrade — grade 的类型陷阱", () => {
  it("接受 0-5 的整数与可完整解析的数字字符串", () => {
    expect(coerceGrade(0)).toBe(0)
    expect(coerceGrade(5)).toBe(5)
    expect(coerceGrade("4")).toBe(4)
    expect(coerceGrade(" 4 ")).toBe(4)
  })

  it("拒绝小数、非数字、空串、null 与布尔值", () => {
    for (const bad of [4.5, "4.5", "abc", "", "  ", null, undefined, true, false, {}, []]) {
      expect(coerceGrade(bad)).toBeUndefined()
    }
  })

  it("绝不返回 NaN（NaN 会让所有比较为 false，悄悄落进 grade 5 分支）", () => {
    const r = coerceGrade("abc")
    expect(r).toBeUndefined()
    expect(Number.isNaN(r as number)).toBe(false)
  })
})

describe("parseReviewCompletion — 入参合法性", () => {
  it("缺少 sentenceId → 报错", () => {
    expect(parseReviewCompletion({ grade: 4 })).toEqual({
      ok: false,
      error: "sentenceId required",
    })
    expect(parseReviewCompletion({ sentenceId: "   ", grade: 4 }).ok).toBe(false)
  })

  it("sentenceId 首尾空格被裁掉", () => {
    expect(parseReviewCompletion({ sentenceId: " s1 ", grade: 4 })).toEqual({
      ok: true,
      sentenceId: "s1",
      mastered: false,
      grade: 4,
    })
  })

  it("mastered=true 时忽略 grade，且只认真正的布尔 true", () => {
    expect(parseReviewCompletion({ sentenceId: "s1", mastered: true, grade: 2 })).toEqual({
      ok: true,
      sentenceId: "s1",
      mastered: true,
      grade: null,
    })
    // 字符串 "false" / "true" / 数字 1 都不是 true
    for (const bad of ["false", "true", 1, 0, "1"]) {
      expect(parseReviewCompletion({ sentenceId: "s1", mastered: bad, grade: 4 })).toEqual({
        ok: true,
        sentenceId: "s1",
        mastered: false,
        grade: 4,
      })
    }
  })

  it("既没有 grade 也没有 mastered → 报错", () => {
    expect(parseReviewCompletion({ sentenceId: "s1" })).toEqual({
      ok: false,
      error: "grade or mastered required",
    })
    expect(parseReviewCompletion({ sentenceId: "s1", grade: null, mastered: false }).ok).toBe(false)
    expect(
      parseReviewCompletion({ sentenceId: "s1", grade: undefined, mastered: false }).ok
    ).toBe(false)
  })

  it("grade 越界或非整数 → 报错", () => {
    for (const bad of [6, -1, 4.5, "abc", "", "4.5"]) {
      expect(parseReviewCompletion({ sentenceId: "s1", grade: bad })).toEqual({
        ok: false,
        error: "grade must be an integer 0-5",
      })
    }
  })

  it('合法 grade 原样返回（字符串 "4" 归一化成数字 4，不能落到 grade 5 分支）', () => {
    expect(parseReviewCompletion({ sentenceId: "s1", grade: "4" })).toEqual({
      ok: true,
      sentenceId: "s1",
      mastered: false,
      grade: 4,
    })
    expect(parseReviewCompletion({ sentenceId: "s1", grade: 0 })).toEqual({
      ok: true,
      sentenceId: "s1",
      mastered: false,
      grade: 0,
    })
  })
})

describe("grade 归一化后的调度结果（与 sm2 联动的回归断言）", () => {
  it('grade 传 "4" 与传 4 的间隔完全一致，且不等于 grade 5 的结果', () => {
    const parsed = parseReviewCompletion({ sentenceId: "s", grade: "4" })
    expect(parsed.ok).toBe(true)
    const grade = parsed.ok ? parsed.grade! : 5

    expect(sm2(2, 2.5, 0, grade)).toEqual(sm2(2, 2.5, 0, 4))
    expect(sm2(2, 2.5, 0, grade).intervalDays).toBe(5)
    // grade 5 会多乘 1.15 → 6，两者必须可区分
    expect(sm2(2, 2.5, 0, 5).intervalDays).toBe(6)
  })

  it("mastered 与 grade 同时出现时以 mastered 为准，不参与 sm2", () => {
    const r = parseReviewCompletion({ sentenceId: "s", mastered: true, grade: 1 })
    expect(r.ok).toBe(true)
    expect(r.ok && r.mastered).toBe(true)
    expect(r.ok && r.grade).toBeNull()
  })
})
