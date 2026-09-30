import { describe, it, expect } from "vitest"
import { buildComment, type CommentInput } from "@/lib/pronunciation-comment"

/** 固定 rand，让选择可预测：返回 0 表示「总取第一条」。 */
const first = () => 0
/** 固定 rand，返回 0.999 表示「总取最后一条」。 */
const last = () => 0.999

function input(over: Partial<CommentInput> = {}): CommentInput {
  return {
    score: 86,
    accuracy: 84,
    fluency: 76,
    integrity: 100,
    words: [
      { word: "You", score: 92 },
      { word: "volume", score: 61 },
      { word: "button", score: 96 },
    ],
    previousComment: null,
    ...over,
  }
}

describe("buildComment · 总评档位", () => {
  it("≥95 用最高档", () => {
    expect(buildComment(input({ score: 98 }), first)).toContain("几乎无可挑剔")
  })
  it("85–94 档", () => {
    expect(buildComment(input({ score: 86 }), first)).toContain("很棒")
  })
  it("70–84 档", () => {
    expect(buildComment(input({ score: 75 }), first)).toContain("不错")
  })
  it("55–69 档", () => {
    expect(buildComment(input({ score: 60, accuracy: 60, fluency: 60 }), first)).toContain("还差一口气")
  })
  it("<55 档", () => {
    expect(buildComment(input({ score: 40, accuracy: 40, fluency: 40 }), first)).toContain("有点吃力")
  })
  it("档位边界：95 / 94 / 85 / 84 / 70 / 69 / 55 / 54 都落在预期档", () => {
    expect(buildComment(input({ score: 95 }), first)).toContain("几乎无可挑剔")
    expect(buildComment(input({ score: 94 }), first)).toContain("很棒")
    expect(buildComment(input({ score: 85 }), first)).toContain("很棒")
    expect(buildComment(input({ score: 84 }), first)).toContain("不错")
    expect(buildComment(input({ score: 70 }), first)).toContain("不错")
    expect(buildComment(input({ score: 69 }), first)).toContain("还差一口气")
    expect(buildComment(input({ score: 55 }), first)).toContain("还差一口气")
    expect(buildComment(input({ score: 54 }), first)).toContain("有点吃力")
  })
})

describe("buildComment · 覆盖规则", () => {
  it("★ 总分 < 30 时只说录音问题，不给发音建议", () => {
    const c = buildComment(input({ score: 12, accuracy: 10, fluency: 10, integrity: 10 }), first)
    expect(c).toContain("没录到声音")
    // 极低分通常是录音问题，此时点名词汇是误导
    expect(c).not.toContain("volume")
    expect(c).not.toContain("准确度")
  })

  it("★ 总分 = 100 时用满分文案，且不点最低分", () => {
    const c = buildComment(
      input({ score: 100, accuracy: 100, fluency: 100, words: [{ word: "the", score: 70 }] }),
      first,
    )
    expect(c).toContain("满分")
    expect(c).not.toContain("the")
  })
})

describe("buildComment · 最低分词", () => {
  it("★ 触发：最低分 < 75 且比句均分低 ≥12", () => {
    // 均分 (92+61+96)/3 = 83 → 83-61 = 22 ≥ 12，且 61 < 75 → 触发
    expect(buildComment(input(), first)).toContain("volume")
  })

  it("★ 不触发：最低分不算低（全句都很好）", () => {
    const c = buildComment(
      input({
        score: 90,
        accuracy: 90,
        fluency: 90,
        words: [
          { word: "You", score: 90 },
          { word: "volume", score: 82 },
          { word: "button", score: 92 },
        ],
      }),
      first,
    )
    expect(c).not.toContain("volume")
  })

  it("★ 不触发：低于 75 但差距不够（12 分是硬边界）", () => {
    // 均分 (70+74+74)/3 = 72.67 → 72.67-70 = 2.67 < 12 → 不触发
    const c = buildComment(
      input({
        words: [
          { word: "alpha", score: 70 },
          { word: "beta", score: 74 },
          { word: "gamma", score: 74 },
        ],
      }),
      first,
    )
    expect(c).not.toContain("alpha")
  })

  it("忽略 score 为 null 的词（不能当成 0 分去选它）", () => {
    const c = buildComment(
      input({
        words: [
          { word: "You", score: 92 },
          { word: "unknown", score: null },
          { word: "button", score: 96 },
        ],
      }),
      first,
    )
    expect(c).not.toContain("unknown")
  })
})

describe("buildComment · 短板维度", () => {
  it("准确度 < 75 时出现", () => {
    expect(buildComment(input({ accuracy: 60, fluency: 90, integrity: 100 }), first)).toContain("准确度")
  })
  it("流利度 < 75 时出现", () => {
    expect(buildComment(input({ accuracy: 90, fluency: 60, integrity: 100 }), first)).toContain("流利度")
  })
  it("完整度 < 100 时出现（完整度的门槛是 100）", () => {
    // 完整度池里带「完整」二字的只有第 4 条，`first` 取的是第 1 条，
    // 所以断言第 1 条实际的措辞；同时另两个维度正常，不该顺带出它们的建议。
    const c = buildComment(input({ accuracy: 90, fluency: 90, integrity: 80 }), first)
    expect(c).toContain("没读全")
    expect(c).not.toContain("准确度")
    expect(c).not.toContain("流利度")
  })
  it("三维度都不低时不出现任何维度建议", () => {
    const c = buildComment(input({ accuracy: 90, fluency: 90, integrity: 100 }), first)
    expect(c).not.toContain("准确度")
    expect(c).not.toContain("流利度")
    expect(c).not.toContain("完整")
  })
  it("★ 维度为 null（有道没给）时不出现该维度建议", () => {
    // JS 里 `null < 75` 为 true，不显式判空就会给字段缺失的用户生成短板建议。
    const c = buildComment(
      input({ accuracy: null, fluency: null, integrity: null, words: [] }),
      first,
    )
    expect(c).not.toContain("准确度")
    expect(c).not.toContain("流利度")
    expect(c).not.toContain("完整")
  })
})

describe("buildComment · 边界与健壮性", () => {
  it("words 为空时不出现逐词段，也不提示「没有逐词数据」", () => {
    const c = buildComment(input({ words: [] }), first)
    expect(c).not.toContain("逐词")
    expect(c.length).toBeGreaterThan(0)
  })

  it("★ 不与上一句完全相同", () => {
    const prev = buildComment(input(), first)
    const next = buildComment(input({ previousComment: prev }), first)
    expect(next).not.toBe(prev)
  })

  it("上一句为空时正常生成", () => {
    expect(buildComment(input({ previousComment: null }), first).length).toBeGreaterThan(0)
  })

  it("rand 取到最后一条时也是池内文案（不越界）", () => {
    const c = buildComment(input(), last)
    expect(c.length).toBeGreaterThan(0)
    expect(c).not.toContain("undefined")
  })
})

describe("buildComment · 文案池", () => {
  it("★ 每档至少 6 条且互不相同（防复制粘贴漏改）", async () => {
    const mod = await import("@/lib/pronunciation-comment")
    const pool = mod.__COMMENT_POOL_FOR_TEST__
    for (const [band, list] of Object.entries(pool.overall)) {
      expect(list.length, `${band} 档条数不足`).toBeGreaterThanOrEqual(6)
      expect(new Set(list).size, `${band} 档有重复文案`).toBe(list.length)
    }
  })
})
