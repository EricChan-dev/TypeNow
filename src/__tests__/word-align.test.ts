/**
 * 练习页/复习页「空格 + 标点」的数据对齐（src/lib/word-align.ts）。
 *
 * 守的是线上真实数据问题：导入语料的 `words` 数组普遍**没带标点**，练习页那行
 * 完全按 `words` 渲染，于是标点与 `english` 对不上。线上实测 335,291 条有 words
 * 的句子里有 134,052 条（40%）不一致：
 *   今天是星期几？   / What day is today ?                      words 标点 = NULL
 *   "你们无数次…"    / " You saved me … ."                      words 标点 = NULL
 *   情态动词如'可能'… / Modal verbs such as 'may' or 'could' …    words 标点 = ''''.
 */
import { describe, it, expect } from "vitest"
import { alignWordsWithEnglish } from "@/lib/word-align"
import type { Word } from "@/types"

const w = (english: string, pos = "词"): Word => ({
  english,
  chinese: null,
  phonetic: null,
  pos,
})

/** 把对齐结果还原成「渲染出来的那一行」：有输入格的词加括号，标点原样。 */
function render(words: Word[]): string {
  return words
    .map((x) => (x.pos === "标点" ? x.english : `[${x.english}]`))
    .join(" ")
}

describe("alignWordsWithEnglish — 标点以 english 为准", () => {
  it("库里 words 缺标点时，标点从 english 补齐", () => {
    const stored = [w("What"), w("day"), w("is"), w("today")]
    const out = alignWordsWithEnglish("What day is today ?", stored)
    expect(out.map((x) => x.english)).toEqual(["What", "day", "is", "today", "?"])
    expect(out.filter((x) => x.pos === "标点").map((x) => x.english)).toEqual(["?",])
  })

  it("反问句：库里没标点，渲染行必须带上 ?", () => {
    const stored = [w("What"), w("day"), w("is"), w("today")]
    expect(render(alignWordsWithEnglish("What day is today ?", stored)))
      .toBe("[What] [day] [is] [today] ?")
  })

  it("句首/句尾的引号与句号都要出现", () => {
    const out = alignWordsWithEnglish(
      '" You saved me from demons countless times ."',
      [w("You"), w("saved"), w("me"), w("from"), w("demons"), w("countless"), w("times")],
    )
    // 每个 token 在练习页都是一个独立格子（flex 行内用间距排开），所以引号也是独立一格。
    expect(out.map((x) => x.english)).toEqual([
      '"', "You", "saved", "me", "from", "demons", "countless", "times", ".", '"',
    ])
    expect(render(out)).toBe('" [You] [saved] [me] [from] [demons] [countless] [times] . "')
  })

  it("库里带错标点（''''.）时以 english 为准重建，不再出现多余符号", () => {
    // 注意：判题用的分词器把引号贴着词一起切（'may' 是一个 token，不是 ' may '），
    // 所以库里的「孤立撇号」条目在 english 里根本没有对应位置，会被整批丢掉。
    const stored = [
      w("Modal"), w("verbs"), w("such"), w("as"),
      w("'", "标点"), w("'", "标点"), w("may", "词"), w("'", "标点"), w("'", "标点"),
      w("or"), w("'", "标点"), w("'", "标点"), w("could", "词"), w("'", "标点"), w("'", "标点"),
      w("indicate"), w("uncertainty"), w("in"), w("the"), w("writer"), w("'", "标点"), w("s"), w("claim"), w(".", "标点"),
    ]
    const out = alignWordsWithEnglish(
      "Modal verbs such as 'may' or 'could' indicate uncertainty in the writer's claim.",
      stored,
    )
    expect(out.map((x) => x.english)).toEqual([
      "Modal", "verbs", "such", "as", "'may'", "or", "'could'",
      "indicate", "uncertainty", "in", "the", "writer's", "claim", ".",
    ])
    // 唯一的标点就是句末句号；库里的 4 个「成对引号」（''''）不会出现在渲染行里
    const punct = out.filter((x) => x.pos === "标点").map((x) => x.english)
    expect(punct).toEqual(["."])
    expect(out.map((x) => x.english).join(" ")).not.toContain("''''")
  })
})

describe("alignWordsWithEnglish — 保留库里的音标/词性/释义", () => {
  it("能按顺序匹配到库里的词条，并原样带上 phonetic", () => {
    const stored: Word[] = [
      { english: "I", chinese: "我", phonetic: "/aɪ/", pos: "代词" },
      { english: "am", chinese: "是", phonetic: "/æm/", pos: "动词" },
      { english: "at", chinese: "在", phonetic: "/æt/", pos: "介词" },
      { english: "the", chinese: "这/那", phonetic: "/ðə/", pos: "冠词" },
      { english: "park", chinese: "公园", phonetic: "/pɑːrk/", pos: "名词" },
    ]
    const out = alignWordsWithEnglish("I am at the park.", stored)
    expect(out.map((x) => x.english)).toEqual(["I", "am", "at", "the", "park", "."])
    expect(out[0].phonetic).toBe("/aɪ/")
    expect(out[4].chinese).toBe("公园")
    expect(out[5].pos).toBe("标点")
  })

  it("库里 words 为空时，直接用 english 分词", () => {
    const out = alignWordsWithEnglish("Hello ! I'm Li Ming", null)
    expect(render(out)).toBe("[Hello] ! [I'm] [Li] [Ming]")
  })

  it("库里 words 与 english 顺序不一致时，不把音标错配给别的词（按词取回，不重复占用）", () => {
    const stored: Word[] = [
      { english: "world", chinese: "世界", phonetic: "/w/", pos: "名词" },
      { english: "Hello", chinese: "你好", phonetic: "/h/", pos: "感叹词" },
    ]
    const out = alignWordsWithEnglish("Hello world", stored)
    expect(out.map((x) => x.english)).toEqual(["Hello", "world"])
    expect(out[0].phonetic).toBe("/h/")
    expect(out[1].phonetic).toBe("/w/")
    expect(out[0].chinese).toBe("你好")
    expect(out[1].chinese).toBe("世界")
  })

  it("同一个词出现两次时不会把同一个条目用两遍", () => {
    const stored: Word[] = [
      { english: "I", chinese: "我", phonetic: "/aɪ/", pos: "代词" },
      { english: "like", chinese: "喜欢", phonetic: "/laɪk/", pos: "动词" },
    ]
    const out = alignWordsWithEnglish("I like I", stored)
    expect(out.map((x) => x.english)).toEqual(["I", "like", "I"])
    expect(out[0].phonetic).toBe("/aɪ/")
    expect(out[1].phonetic).toBe("/laɪk/")
    expect(out[2].phonetic).toBeNull() // 库里只有一个 I，第二个不重复使用
  })
  it("库里标点被词性标注器打了别的 pos（SYM/PART）时，仍按标点渲染", () => {
    // 线上实测：757 条句子里标点被标成 SYM/PART 等（`'` 被标成 PART 有 67 处）。
    // pos 不是「标点」时练习页会把它当成输入格，用户得为一个撇号单敲一格。
    const stored: Word[] = [
      { english: "It", chinese: "它", phonetic: null, pos: "PRON" },
      { english: "'", chinese: null, phonetic: null, pos: "PART" },
      { english: "s", chinese: null, phonetic: null, pos: "AUX" },
      { english: "fine", chinese: "好的", phonetic: null, pos: "ADJ" },
      { english: ".", chinese: null, phonetic: null, pos: "PUNCT" },
    ]
    const out = alignWordsWithEnglish("It ' s fine .", stored)
    expect(out.map((x) => x.pos)).toEqual(["PRON", "标点", "AUX", "ADJ", "标点"])
    // 标点的 chinese/phonetic 仍可保留，只有 pos 被纠正
    expect(out[0].chinese).toBe("它")
  })
})

describe("alignWordsWithEnglish — 边界", () => {
  it("整句只有符号时保留库里的原样，避免产出没有输入格的句子", () => {
    const stored = [w("A"), w("B")]
    expect(alignWordsWithEnglish("...", stored)).toBe(stored)
  })

  it("english 为空时不炸", () => {
    expect(alignWordsWithEnglish("", null)).toEqual([])
    expect(alignWordsWithEnglish(null, [w("A")])).toEqual([w("A")])
  })

  it("孤立的撇号/连字符是标点，不会变成要用户敲的输入格", () => {
    // `5 - 3` 里的 `-` 与 `' Hello` 里的 `'` 都被切成独立 token；
    // 它们必须是标点，否则练习页会多出只用来敲一个符号的输入格。
    expect(alignWordsWithEnglish("5 - 3", null).map((x) => x.pos))
      .toEqual(["词", "标点", "词"])
    expect(alignWordsWithEnglish("' Hello '", null).map((x) => x.pos))
      .toEqual(["标点", "词", "标点"])
    // 但 don't / T-shirt 这种内部含撇号/连字符的仍是一个可输入的词
    expect(alignWordsWithEnglish("don't T-shirt", null).map((x) => x.pos))
      .toEqual(["词", "词"])
  })

  it("弯引号按判题口径归一化成键盘写法（don’t → don't）", () => {
    const out = alignWordsWithEnglish("I don’t know .", null)
    expect(render(out)).toBe("[I] [don't] [know] .")
  })

  it("数字与连字符当成一个可输入的词", () => {
    const out = alignWordsWithEnglish("It is 6 30 and T-shirt", null)
    expect(out.filter((x) => x.pos !== "标点").map((x) => x.english))
      .toEqual(["It", "is", "6", "30", "and", "T-shirt"])
  })
})
