import { describe, expect, it } from "vitest"

import {
  extractCoreWords,
  filterPersonNameOnlyFragments,
  fragmentsForSentence,
  linearizeChunks,
  personNameTokensFromWords,
} from "@/lib/fragment-practice"
import type { Sentence, Word } from "@/types"

/**
 * 库里真实的层级累积型 chunks（取真实样例，非构造）。
 *
 * 注意这一条**在 `are` 上有缺口** —— 数组里没有任何片段覆盖 `are`，
 * 所以它是「铺不满」的反例，见下面 `铺不满` 那个用例。它在真实库里
 * 正是 DP 覆盖率只有 83.7% 的那 16.3%。
 */
const CUMULATIVE_GAP = [
  { order: 1, text: "Our relationships", chinese: "我们的关系" },
  { order: 2, text: "with others", chinese: "与他人" },
  { order: 3, text: "Our relationships with others", chinese: "我们与他人的关系" },
  { order: 4, text: "the single most important factor", chinese: "最重要的因素" },
  { order: 5, text: "in our well-being", chinese: "在我们的幸福中" },
  {
    order: 6,
    text: "the single most important factor in our well-being",
    chinese: "我们幸福中最重要的因素",
  },
  {
    order: 7,
    text: "Our relationships with others are the single most important factor in our well-being.",
    chinese: "完整句",
  },
]

const GAP_SENTENCE =
  "Our relationships with others are the single most important factor in our well-being."

/**
 * 库里真实可精确铺满的样例（`scripts/tmp-db-tile4.mjs` 导出）。
 * chunks 是累积型且**顺序量乱**：`order` 3 的 `They stopped talking`
 * 排在 `order` 2 的从句之后 —— 只能用忽略顺序的 DP 铺满。
 */
const REAL_TILE = {
  english: "They stopped talking when the teacher entered the classroom suddenly.",
  chunks: [
    { order: 1, text: "when the teacher entered the classroom", chinese: "当老师走进教室时" },
    { order: 2, text: "when the teacher entered the classroom suddenly", chinese: "当老师突然走进教室时" },
    { order: 3, text: "They stopped talking", chinese: "他们停止了说话" },
  ],
}

/** 另一条真实样例，三段且 order 完全乱序。 */
const REAL_TILE_3 = {
  english: "I would like to request a quotation for your standard packaging service.",
  chunks: [
    { order: 3, text: "for your standard packaging service", chinese: "关于贵公司的标准包装服务" },
    { order: 1, text: "I would like to request", chinese: "我想请求" },
    { order: 2, text: "a quotation", chinese: "一份报价" },
  ],
}

describe("linearizeChunks — 层级累积型 chunks 的线性化", () => {
  it("把乱序的累积数组裁成不重叠、能铺满的片段", () => {
    const got = linearizeChunks(REAL_TILE.chunks, REAL_TILE.english)
    expect(got).not.toBeNull()
    expect(got!.length).toBe(2)
    // 按数组顺序贪心会是 1 段（从句排在主句前），DP 必须能跨顺序拼回来
    expect(got!.map((f) => f.text)).toEqual([
      "They stopped talking",
      "when the teacher entered the classroom suddenly",
    ])
  })

  it("三段乱序样例按 order 升序输出，拼回来等于原句", () => {
    const got = linearizeChunks(REAL_TILE_3.chunks, REAL_TILE_3.english)!
    expect(got.map((f) => f.text)).toEqual([
      "I would like to request",
      "a quotation",
      "for your standard packaging service",
    ])
    expect(got.map((f) => f.text).join(" ")).toBe(REAL_TILE_3.english.replace(/\.$/, ""))
  })

  it("带中文翻译逐段透传", () => {
    const got = linearizeChunks(REAL_TILE_3.chunks, REAL_TILE_3.english)!
    expect(got.map((f) => f.meaning)).toEqual([
      "我想请求",
      "一份报价",
      "关于贵公司的标准包装服务",
    ])
  })

  it("component 硬编码为 chunk（照抄参考站 practice.js:2589）", () => {
    const got = linearizeChunks(REAL_TILE_3.chunks, REAL_TILE_3.english)!
    for (const f of got) expect(f.component).toBe("chunk")
  })

  it("接受 JSON 字符串形式（列可能是 TEXT）", () => {
    const got = linearizeChunks(JSON.stringify(REAL_TILE_3.chunks), REAL_TILE_3.english)
    expect(got).not.toBeNull()
    expect(got!.length).toBe(3)
  })

  it("null / 空数组 / 非数组 / 坏 JSON 都返回 null", () => {
    expect(linearizeChunks(null, REAL_TILE.english)).toBeNull()
    expect(linearizeChunks([], REAL_TILE.english)).toBeNull()
    expect(linearizeChunks("not json", REAL_TILE.english)).toBeNull()
    expect(linearizeChunks({ a: 1 }, REAL_TILE.english)).toBeNull()
  })

  it("原句为空返回 null", () => {
    expect(linearizeChunks(REAL_TILE.chunks, "")).toBeNull()
  })

  it("铺不满（`are` 无片段覆盖）返回 null —— 该句退化成整句听写", () => {
    expect(linearizeChunks(CUMULATIVE_GAP, GAP_SENTENCE)).toBeNull()
  })

  it("铺不满（数据有缺口）返回 null —— 实测样例 `Daddy's number?`", () => {
    expect(
      linearizeChunks(
        [{ order: 1, text: "Daddy's number?", chinese: "爸爸的号码？" }],
        "Do you remember Daddy's number ?",
      ),
    ).toBeNull()
  })

  it("只有一个片段且等于整句 → null（参考站跳过条件）", () => {
    expect(linearizeChunks([{ order: 1, text: GAP_SENTENCE, chinese: "整句" }], GAP_SENTENCE)).toBeNull()
  })

  it("忽略数组顺序，只要能铺满就能线性化（DP 而非贪心）", () => {
    // 故意把原子片段放在长片段之后，且整体倒序
    const scrambled = [
      { order: 9, text: "and the second half", chinese: "后半" },
      { order: 8, text: "the first half and the second half", chinese: "整句" },
      { order: 7, text: "the first half", chinese: "前半" },
    ]
    const got = linearizeChunks(scrambled, "the first half and the second half")
    expect(got).not.toBeNull()
    expect(got!.map((f) => f.text)).toEqual(["the first half", "and the second half"])
  })

  it("优先取片段数最多的分解（练得最细）", () => {
    const chunks = [
      { order: 1, text: "a b c d", chinese: "整" },
      { order: 2, text: "a b", chinese: "前" },
      { order: 3, text: "c d", chinese: "后" },
    ]
    const got = linearizeChunks(chunks, "a b c d")!
    expect(got.map((f) => f.text)).toEqual(["a b", "c d"])
  })

  it("同长度候选里 order 小者胜出", () => {
    const chunks = [
      { order: 5, text: "a b", chinese: "后号" },
      { order: 2, text: "a b", chinese: "先号" },
      { order: 9, text: "c d", chinese: "尾" },
    ]
    const got = linearizeChunks(chunks, "a b c d")!
    expect(got[0].meaning).toBe("先号")
  })

  it("丢弃 text 为空的候选", () => {
    const chunks = [
      { order: 1, text: "a b", chinese: "前" },
      { order: 2, text: "", chinese: "空" },
      { order: 3, text: "c d", chinese: "后" },
    ]
    const got = linearizeChunks(chunks, "a b c d")!
    expect(got.map((f) => f.text)).toEqual(["a b", "c d"])
  })

  it("容错弯引号与标点差异", () => {
    const chunks = [
      { order: 1, text: "It\u2019s fine", chinese: "前" },
      { order: 2, text: "don't worry", chinese: "后" },
    ]
    const got = linearizeChunks(chunks, '" It\'s fine , don\'t worry !"')
    expect(got).not.toBeNull()
    expect(got!.length).toBe(2)
  })

  it("missing meaning 退化成空串，不产生 undefined 文案", () => {
    const chunks = [
      { order: 1, text: "a b", chinese: "前" },
      { order: 2, text: "c d", chinese: "" },
    ]
    const got = linearizeChunks(chunks, "a b c d")!
    expect(got[1].meaning).toBe("")
  })

  it("纯数字片段被剔除", () => {
    const chunks = [
      { order: 1, text: "a b", chinese: "前" },
      { order: 2, text: "123", chinese: "数字" },
      { order: 3, text: "c d", chinese: "后" },
    ]
    const got = linearizeChunks(chunks, "a b 123 c d")!
    expect(got.map((f) => f.text)).toEqual(["a b", "c d"])
  })

  it("全部被过滤时回退原始片段（参考站兜底）", () => {
    const chunks = [
      { order: 1, text: "12", chinese: "数一" },
      { order: 2, text: "34", chinese: "数二" },
    ]
    const got = linearizeChunks(chunks, "12 34")!
    expect(got.map((f) => f.text)).toEqual(["12", "34"])
  })
})

describe("filterPersonNameOnlyFragments — 参考站 practice.js:2626", () => {
  const frags = [
    { text: "Sophie Dupont", meaning: "人名", component: "chunk" },
    { text: "Miss Sophie", meaning: "称呼", component: "chunk" },
  ]

  it("token 全是人名 → 整段剔除", () => {
    const got = filterPersonNameOnlyFragments(frags, new Set(["sophie", "dupont"]))
    expect(got.map((f) => f.text)).toEqual(["Miss Sophie"])
  })

  it("所有格剥除后命中同样剔除", () => {
    const got = filterPersonNameOnlyFragments(
      [{ text: "Sophie's", meaning: "", component: "chunk" }],
      new Set(["sophie"]),
    )
    expect(got).toEqual([])
  })

  it("空人名集不做任何过滤（我们没有 NER，常态）", () => {
    expect(filterPersonNameOnlyFragments(frags, new Set())).toEqual(frags)
  })
})

describe("personNameTokensFromWords — 当前数据下为空集", () => {
  it("中文词性不命中 person_name/name", () => {
    const words: Word[] = [
      { english: "Sophie", chinese: "索菲", phonetic: null, pos: "名词" },
      { english: "Dupont", chinese: "杜邦", phonetic: null, pos: "代词" },
    ]
    expect(personNameTokensFromWords(words).size).toBe(0)
  })

  it("英文 NER 词性命中时建立 token（含所有格）", () => {
    const words: Word[] = [
      { english: "Jeremy Short's", chinese: "杰瑞米", phonetic: null, pos: "person_name" },
    ]
    const set = personNameTokensFromWords(words)
    expect(set.has("jeremy")).toBe(true)
  })

  it("null/undefined 安全", () => {
    expect(personNameTokensFromWords(null).size).toBe(0)
    expect(personNameTokensFromWords(undefined).size).toBe(0)
  })
})

describe("extractCoreWords — 逐字移植参考站 practice.js:2858", () => {
  it("单个词直接返回", () => {
    expect(extractCoreWords("plants")).toEqual(["plants"])
  })

  it("虚词被过滤，实义词倒序返回（名词在后优先配图）", () => {
    expect(extractCoreWords("water the plants")).toEqual(["plants", "water"])
  })

  it("实义词超过 4 个返回 null", () => {
    expect(extractCoreWords("alpha beta gamma delta epsilon")).toBeNull()
  })

  it("全是虚词返回 null", () => {
    expect(extractCoreWords("the a of to")).toBeNull()
  })

  it("空输入返回 null", () => {
    expect(extractCoreWords("")).toBeNull()
    expect(extractCoreWords("   ")).toBeNull()
    expect(extractCoreWords("...")).toBeNull()
  })

  it("去重后返回", () => {
    expect(extractCoreWords("plants plants")).toEqual(["plants"])
  })
})

describe("fragmentsForSentence — Sentence 封装", () => {
  const base: Sentence = {
    id: "s1",
    chinese: "中文",
    english: REAL_TILE.english,
    words_count: 11,
    category: "c",
    difficulty: 1,
    tags: [],
  }

  it("null 句子返回 null", () => {
    expect(fragmentsForSentence(null)).toBeNull()
  })

  it("无 chunks 返回 null", () => {
    expect(fragmentsForSentence(base)).toBeNull()
  })

  it("有 chunks 时走线性化", () => {
    const got = fragmentsForSentence({ ...base, chunks: REAL_TILE.chunks })
    expect(got).not.toBeNull()
    expect(got!.length).toBe(2)
    expect(got!.map((f) => f.text)).toEqual([
      "They stopped talking",
      "when the teacher entered the classroom suddenly",
    ])
  })

  it("chunks 铺不满时返回 null（走整句听写）", () => {
    const got = fragmentsForSentence({
      ...base,
      english: GAP_SENTENCE,
      chunks: CUMULATIVE_GAP,
    })
    expect(got).toBeNull()
  })
})
