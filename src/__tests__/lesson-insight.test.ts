import { describe, expect, it } from "vitest"
import {
  isUsablePhrase,
  normalizePhrase,
  normalizeSentenceForCompare,
  phrasesFromChunks,
  selectPhrases,
  selectVocab,
  type VocabRow,
} from "@/lib/lesson-insight"

/**
 * 课程详情页「学习要点」派生规则的单测。
 *
 * 这些规则直接决定用户展开课节后看到什么：过滤写松了，屏幕上就是
 * `jelly +`、整句、`the / and / to` 这类垃圾标签（都是生产库实测出现过的
 * 脏形态）；写紧了，合法短语（`a lot`）会被误杀。两边都要钉住。
 */
describe("selectVocab", () => {
  it("过滤虚词、短词、纯数字/符号，保留实词", () => {
    const rows: VocabRow[] = [
      { word: "the", pos: "DET", count: 10, docs: 5 },
      { word: "and", pos: "CCONJ", count: 8, docs: 4 },
      { word: "to", pos: "PART", count: 6, docs: 3 },
      { word: "is", pos: "AUX", count: 5, docs: 3 },
      { word: "it", pos: "PRON", count: 4, docs: 3 },
      { word: "42", pos: "NUM", count: 2, docs: 2 },
      { word: "!!", pos: "PUNCT", count: 3, docs: 3 },
      { word: "ab", pos: "NOUN", count: 9, docs: 9 }, // ≤2 字母
      { word: "toy", pos: "NOUN", count: 5, docs: 4 },
      { word: "favourite", pos: "ADJ", count: 3, docs: 2 },
    ]
    expect(selectVocab(rows).map((r) => r.word)).toEqual(["toy", "favourite"])
  })

  it("大小写归并：Toy 与 toy 是同一个词，取首次出现的大小写", () => {
    const rows: VocabRow[] = [
      { word: "Toy", pos: "NOUN", count: 2, docs: 1 },
      { word: "toy", pos: "NOUN", count: 3, docs: 2 },
    ]
    const out = selectVocab(rows)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ word: "Toy", count: 5, docs: 3 })
  })

  it("排序：先 docs（分布在几个句子）再 count（总频次）", () => {
    const rows: VocabRow[] = [
      { word: "repeat", pos: "VERB", count: 8, docs: 1 }, // 单句里刷 8 次
      { word: "spread", pos: "VERB", count: 2, docs: 5 }, // 分布在 5 句
    ]
    expect(selectVocab(rows).map((r) => r.word)).toEqual(["spread", "repeat"])
  })

  it("docs/count 都相同时按字母序兜底，同输入永远同输出", () => {
    const rows: VocabRow[] = [
      { word: "banana", pos: "NOUN", count: 2, docs: 2 },
      { word: "apple", pos: "NOUN", count: 2, docs: 2 },
    ]
    expect(selectVocab(rows).map((r) => r.word)).toEqual(["apple", "banana"])
  })

  it("limit 截断，空输入返回空数组", () => {
    const rows: VocabRow[] = [
      { word: "apple", pos: "NOUN", count: 1, docs: 1 },
      { word: "banana", pos: "NOUN", count: 1, docs: 1 },
      { word: "cherry", pos: "NOUN", count: 1, docs: 1 },
    ]
    expect(selectVocab(rows, 2)).toHaveLength(2)
    expect(selectVocab([], 5)).toEqual([])
  })
})

describe("isUsablePhrase", () => {
  it("挡掉构词法算式（+ = →）", () => {
    expect(isUsablePhrase("jelly +")).toBe(false)
    expect(isUsablePhrase("bird + house = birdhouse")).toBe(false)
    expect(isUsablePhrase("a → b")).toBe(false)
  })

  it("首字符是标点的引语碎片/括号残留挡掉（生产实测）", () => {
    expect(isUsablePhrase('" Oh, " said Pig.')).toBe(false)
    expect(isUsablePhrase("( said Pig.")).toBe(false)
    expect(isUsablePhrase("farmer said")).toBe(true)
  })

  it("单词不是短语（必须含空白）", () => {
    expect(isUsablePhrase("box")).toBe(false)
    expect(isUsablePhrase("very good")).toBe(true)
  })

  it("整句被当成节点时挡掉（忽略末尾标点/大小写差异）", () => {
    expect(isUsablePhrase("See you next week .", "See you next week.")).toBe(false)
    expect(isUsablePhrase("See you next week", "See you next week.")).toBe(false)
    // 只是与句子部分重叠不算整句
    expect(isUsablePhrase("see you next", "See you next week.")).toBe(true)
  })

  it("长度边界与「至少两个字母开头的词」", () => {
    expect(isUsablePhrase("ab")).toBe(false) // 太短
    expect(isUsablePhrase("1 2")).toBe(false) // 没有字母开头的词
    expect(isUsablePhrase("a lot")).toBe(true) // 合法搭配不能误杀
    expect(isUsablePhrase(`${"x".repeat(61)} y`)).toBe(false) // 太长
  })
})

describe("normalizePhrase", () => {
  it("收拢空白并去掉标点前的空格（分词遗留）", () => {
    expect(normalizePhrase("I ’ve got to go .")).toBe("I’ve got to go.")
    expect(normalizePhrase("See   you  next week .")).toBe("See you next week.")
    expect(normalizePhrase("  hello   world  ")).toBe("hello world")
  })
})

describe("normalizeSentenceForCompare", () => {
  it("大小写、空白、末尾标点不参与整句判定", () => {
    expect(normalizeSentenceForCompare("See you next week .")).toBe(
      normalizeSentenceForCompare("see you next week"),
    )
  })
})

describe("selectPhrases", () => {
  it("清洗 → 大小写去重合并频次 → 频次排序；脏数据频次再高也不进", () => {
    const out = selectPhrases([
      { phrase: "favourite toy", count: 3 },
      { phrase: "Favourite Toy", count: 2 },
      { phrase: "next to", count: 4 },
      { phrase: "jelly +", count: 99 }, // 算式，不能因为频次高就上屏
      { phrase: "box", count: 7 }, // 单词
    ])
    expect(out).toEqual([
      { phrase: "favourite toy", count: 5 },
      { phrase: "next to", count: 4 },
    ])
  })

  it("整句候选（带 sentence 对照）被挡掉", () => {
    const out = selectPhrases([
      { phrase: "See you next week .", count: 2, sentence: "See you next week." },
      { phrase: "next week", count: 2, sentence: "See you next week." },
    ])
    expect(out).toEqual([{ phrase: "next week", count: 2 }])
  })

  it("limit 截断，空输入返回空数组", () => {
    const rows = [
      { phrase: "a lot", count: 1 },
      { phrase: "next to", count: 2 },
      { phrase: "very good", count: 3 },
    ]
    expect(selectPhrases(rows, 2)).toHaveLength(2)
    expect(selectPhrases([], 8)).toEqual([])
  })
})

describe("phrasesFromChunks", () => {
  it("按 order 升序取意群，去重、挡整句与单词", () => {
    const sentence = "My favourite toy is the red car ."
    const chunks = [
      { text: "My favourite toy is the red car .", order: 3 }, // 整句
      { text: "favourite toy", order: 1 },
      { text: "the red car", order: 2 },
      { text: "favourite toy", order: 0 }, // 重复（order 更小，先出现）
      { text: "red", order: 4 }, // 单词
    ]
    expect(phrasesFromChunks(chunks, sentence)).toEqual(["favourite toy", "the red car"])
  })

  it("limit 截断", () => {
    const chunks = [
      { text: "a lot", order: 0 },
      { text: "next to", order: 1 },
      { text: "very good", order: 2 },
    ]
    expect(phrasesFromChunks(chunks, "I have a lot of books next to very good ones .", 2)).toHaveLength(2)
  })
})
