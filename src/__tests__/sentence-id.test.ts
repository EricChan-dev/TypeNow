/**
 * 句 id 的基础化（去掉分块后缀）。
 *
 * 存在的理由：练习页会把「有 chunks 的句子」展开成若干条练习项，各自带
 * `${原句 id}_c${order}` 的后缀。但下游所有接口（review/complete、
 * wordbook、practice/record）认的都是**原句 id**，库里根本没有 `xxx_c0`
 * 这一行。这个后缀在 LearnClient 里被就地手写了 4 遍，任何一处漏掉，
 * 用户看到的就是「Review item not found」这种莫名其妙的失败 —— 而且
 * 因为只在特定内容上触发，很难复现。抽出来用一个函数兜住。
 */
import { describe, it, expect } from "vitest"
import { baseSentenceId } from "@/lib/sentence-id"

describe("baseSentenceId", () => {
  it("带分块后缀时剥掉后缀", () => {
    expect(baseSentenceId("14da28fe-01ba-4fa6-a932-8cc30762d916_c0")).toBe(
      "14da28fe-01ba-4fa6-a932-8cc30762d916"
    )
    expect(baseSentenceId("14da28fe-01ba-4fa6-a932-8cc30762d916_c12")).toBe(
      "14da28fe-01ba-4fa6-a932-8cc30762d916"
    )
  })

  it("不带后缀时原样返回", () => {
    expect(baseSentenceId("14da28fe-01ba-4fa6-a932-8cc30762d916")).toBe(
      "14da28fe-01ba-4fa6-a932-8cc30762d916"
    )
    expect(baseSentenceId("plain")).toBe("plain")
  })

  it("只剥最后一次出现的后缀，不误伤 id 里本来就有的 _c", () => {
    // 原句 id 自身含 "_c" 是完全可能的（UUID 之外还有 slug 形态的 id）
    expect(baseSentenceId("my_course_c0")).toBe("my_course")
    expect(baseSentenceId("a_c_b_c3")).toBe("a_c_b")
  })

  it("要求后缀是 _c + 纯数字，避免把普通下划线结尾的 id 削掉", () => {
    expect(baseSentenceId("prefix_c")).toBe("prefix_c")
    expect(baseSentenceId("prefix_cx")).toBe("prefix_cx")
    expect(baseSentenceId("prefix_c1x")).toBe("prefix_c1x")
    expect(baseSentenceId("prefix_c-1")).toBe("prefix_c-1")
  })

  it("id 本身就是后缀时不返回空串（宁可原样返回，也不给下游一个空 id）", () => {
    expect(baseSentenceId("_c0")).toBe("_c0")
  })

  it("空值安全降级", () => {
    expect(baseSentenceId("")).toBe("")
    expect(baseSentenceId(null)).toBe("")
    expect(baseSentenceId(undefined)).toBe("")
  })
})
