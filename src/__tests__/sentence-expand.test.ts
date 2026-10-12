/**
 * 分块句的两条处理路径 + 会话下标的坐标系换算。
 *
 * 存在的理由：这是「分段练习永远进不去」那个 bug 的护栏。听写模式曾无条件调用
 * `expandSentences()`，把每句带 chunks 的句子摊成「每块一条练习项」并把 `chunks`
 * 置为 null。后果不是报错，而是**静默失效**：`fragmentsForSentence()` 读不到
 * chunks → 分段练习恒为关闭，界面看起来完全正常。
 *
 * 所以这里锁住两件事：
 *   1. `normalizeSentences()` 保留 chunks（听写模式用它）；
 *      `expandSentences()` 仍是旧口径（旧版三种模式用），两者不能混。
 *   2. 摊平空间 ↔ 原句空间的下标换算，方向不能反（必须先折算再钳制）。
 *      换算错了表现为「进度莫名跑到最后一句」，查起来同样费劲。
 */
import { describe, it, expect } from "vitest"
import {
  normalizeSentences,
  expandSentences,
  isExpandedIndexSpace,
  mapExpandedIndexToRawIndex,
} from "@/lib/sentence-expand"
import type { Chunk, Sentence } from "@/types"

/** 造一条最小可用原句。`chunkTexts` 省略即无分块。 */
function sent(id: string, english: string, chunkTexts?: string[]): Sentence {
  const chunks: Chunk[] | null = chunkTexts
    ? chunkTexts.map((text, i) => ({ order: i + 1, text, chinese: `中${i + 1}` }))
    : null
  return {
    id,
    english,
    chinese: "整句中译",
    words_count: english.trim().split(/\s+/).length,
    category: "daily",
    difficulty: 1,
    tags: [],
    lesson_id: "lesson-1",
    words: null,
    chunks,
  }
}

/** 真实形态：层级累积的 chunks（含整句那一条），取自 Let's Go > Transportation Fun。 */
const RED_BUS = sent(
  "a60b019d-f9b5-4d74-ad3c-194dee0aee52",
  "The red bus that goes down the street is full of happy children.",
  [
    "The red bus",
    "that goes down the street",
    "happy children",
    "is full of",
    "The red bus that goes down the street",
    "is full of happy children",
    "The red bus that goes down the street is full of happy children.",
  ],
)

const PLAIN = sent("plain-1", "I see a big airplane.")

describe("normalizeSentences", () => {
  it("一句一条练习项：不摊平分块", () => {
    const out = normalizeSentences([RED_BUS, PLAIN])
    expect(out.map((s) => s.id)).toEqual([RED_BUS.id, PLAIN.id])
  })

  it("保留 chunks 字段本身（分段练习的数据源）", () => {
    const [out] = normalizeSentences([RED_BUS])
    expect(out.chunks).toHaveLength(7)
    expect(out.chunks?.[0].text).toBe("The red bus")
    expect(out.chunks?.[0].chinese).toBe("中1")
  })

  it("id 不带 _c 后缀（下游进度接口认原句 id）", () => {
    const [out] = normalizeSentences([RED_BUS])
    expect(out.id).toBe(RED_BUS.id)
    expect(out.id).not.toContain("_c")
  })

  it("english / chinese 保持整句，不被某一分块顶替", () => {
    const [out] = normalizeSentences([RED_BUS])
    expect(out.english).toBe(RED_BUS.english)
    expect(out.chinese).toBe("整句中译")
  })

  it("重建 words 以 english 为骨架（导入的 words 普遍缺标点）", () => {
    const [out] = normalizeSentences([RED_BUS])
    // words 归一后应覆盖整句的词，而不是分块的词
    expect(out.words?.length ?? 0).toBeGreaterThan(3)
    expect(out.words?.some((w) => w.english.includes("children"))).toBe(true)
  })

  it("无分块的句子同样保留，且不新增字段", () => {
    const out = normalizeSentences([PLAIN])
    expect(out).toHaveLength(1)
    expect(out[0].chunks).toBeNull()
    expect(out[0].english).toBe("I see a big airplane.")
  })

  it("不改动入参（纯函数）", () => {
    const input = [{ ...RED_BUS }]
    const before = JSON.stringify(input[0].chunks)
    normalizeSentences(input)
    expect(JSON.stringify(input[0].chunks)).toBe(before)
    expect(input[0].words).toBeNull()
  })
})

describe("expandSentences（旧版三种模式口径，未改动）", () => {
  it("有分块的句子摊成每块一条，id 带 _c<order>", () => {
    const out = expandSentences([PLAIN, RED_BUS])
    expect(out[0].id).toBe("plain-1")
    expect(out.slice(1).map((s) => s.id)).toEqual([
      `${RED_BUS.id}_c1`,
      `${RED_BUS.id}_c2`,
      `${RED_BUS.id}_c3`,
      `${RED_BUS.id}_c4`,
      `${RED_BUS.id}_c5`,
      `${RED_BUS.id}_c6`,
      `${RED_BUS.id}_c7`,
    ])
  })

  it("摊平后 chunks 被置 null —— 这正是听写模式不能复用它、必须走 normalizeSentences 的原因", () => {
    const out = expandSentences([RED_BUS])
    expect(out.every((s) => s.chunks === null)).toBe(true)
  })

  it("按 order 升序摊平，即使数组顺序是乱的", () => {
    const scrambled = sent("scrambled", "They stopped talking when the teacher entered.", [
      "when the teacher entered",
      "They stopped talking",
      "when the teacher entered the classroom suddenly",
    ])
    scrambled.chunks = [
      { order: 3, text: "They stopped talking", chinese: "c" },
      { order: 1, text: "when the teacher entered", chinese: "a" },
      { order: 2, text: "when the teacher entered the classroom suddenly", chinese: "b" },
    ]
    const out = expandSentences([scrambled])
    expect(out.map((s) => s.english)).toEqual([
      "when the teacher entered",
      "when the teacher entered the classroom suddenly",
      "They stopped talking",
    ])
  })

  it("无分块的句子只做 words 归一，保持 1 条", () => {
    const out = expandSentences([PLAIN])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("plain-1")
  })
})

describe("isExpandedIndexSpace", () => {
  it("存量条数大于原句数 → 摊平空间", () => {
    expect(isExpandedIndexSpace(32, [PLAIN, RED_BUS])).toBe(true)
  })

  it("相等 → 按原句空间处理（两个空间此时无法区分）", () => {
    expect(isExpandedIndexSpace(2, [PLAIN, RED_BUS])).toBe(false)
  })

  it("小于 → 原句空间（课里题目被删过）", () => {
    expect(isExpandedIndexSpace(1, [PLAIN, RED_BUS])).toBe(false)
  })

  it("非法值一律按原句空间", () => {
    expect(isExpandedIndexSpace(Number.NaN, [PLAIN, RED_BUS])).toBe(false)
    expect(isExpandedIndexSpace(0, [PLAIN, RED_BUS])).toBe(false)
    expect(isExpandedIndexSpace(-5, [PLAIN, RED_BUS])).toBe(false)
  })
})

describe("mapExpandedIndexToRawIndex", () => {
  // 原句 0 无分块（占摊平下标 0），原句 1 有 7 块（占 1..7），原句 2 无分块（占 8）
  const raw = [PLAIN, RED_BUS, sent("tail", "Goodbye now.")]

  it("落进分块句的任意一块，都恢复成该原句", () => {
    for (const expanded of [1, 2, 3, 4, 5, 6, 7]) {
      expect(mapExpandedIndexToRawIndex(expanded, raw)).toBe(1)
    }
  })

  it("分块句之前的原句", () => {
    expect(mapExpandedIndexToRawIndex(0, raw)).toBe(0)
  })

  it("分块句之后的原句（下标 8 是第三句）", () => {
    expect(mapExpandedIndexToRawIndex(8, raw)).toBe(2)
  })

  it("越界夹到最后一句，而不是送回开头", () => {
    expect(mapExpandedIndexToRawIndex(999, raw)).toBe(2)
  })

  it("负数 / 非法值回退到 0", () => {
    expect(mapExpandedIndexToRawIndex(-1, raw)).toBe(0)
    expect(mapExpandedIndexToRawIndex(Number.NaN, raw)).toBe(0)
  })

  it("空句表回退到 0（不 -1 越界）", () => {
    expect(mapExpandedIndexToRawIndex(5, [])).toBe(0)
  })

  it("全是无分块句时退化成恒等映射", () => {
    const flat = [sent("a", "A a."), sent("b", "B b."), sent("c", "C c.")]
    expect([0, 1, 2].map((i) => mapExpandedIndexToRawIndex(i, flat))).toEqual([0, 1, 2])
  })

  it("真实场景：10 句带分块共 75 项，摊平下标 74 落在最后一句", () => {
    // 模拟该课：每句 7 块、共 10 句；但 7 块里含整句，故实际练习项远少于 75。
    // 这里只锁「大下标不会回到开头」这条性质。
    const ten = Array.from({ length: 10 }, (_, i) =>
      sent(`s${i}`, `Sentence number ${i}.`, ["a", "b", "c"]),
    )
    expect(mapExpandedIndexToRawIndex(29, ten)).toBe(9)
    expect(mapExpandedIndexToRawIndex(0, ten)).toBe(0)
  })
})

describe("折算与钳制的先后顺序（回归护栏）", () => {
  it("先折算再钳制 ≠ 先钳制再折算 —— 后者会毁掉换算", () => {
    const raw = [PLAIN, RED_BUS, sent("tail", "Goodbye now.")] // 3 原句 / 9 摊平项
    const expandedIndex = 8
    // 正确：先折算 → 原句 2，落回合法区间
    expect(mapExpandedIndexToRawIndex(expandedIndex, raw)).toBe(2)
    // 错误顺序：先按原句数 3 钳制 → min(8, 2) = 2 → 再折算还是 2，
    // 看似也对；但摊平下标一旦 > 2×原句数就暴露了。取 7（仍属分块句 1）
    // 先钳制会得到 2，正确答案是 1。
    expect(mapExpandedIndexToRawIndex(7, raw)).toBe(1)
    expect(Math.min(7, raw.length - 1)).toBe(2) // 先钳制的错误路径
  })
})
