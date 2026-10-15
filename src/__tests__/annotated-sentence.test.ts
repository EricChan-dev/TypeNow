import { describe, expect, it } from "vitest"
import {
  buildAnnotation,
  extractPhonetic,
  hexToRgba,
  inferPos,
  normalizePos,
  posColor,
  posLabel,
  wordLookupKey,
} from "@/lib/annotated-sentence"
import type { Sentence } from "@/types"

/** 造一个最小可用的句子。 */
function sentence(english: string, words: Sentence["words"]): Sentence {
  return {
    id: "s1",
    chinese: "译文",
    english,
    words_count: words?.length ?? 0,
    category: "c",
    difficulty: 1,
    tags: [],
    words,
  }
}

describe("normalizePos / posLabel", () => {
  it("把库里的大写缩写统一成标准词性", () => {
    // 线上 words[].pos 存的是 DET/NOUN/AUX/VERB 这种大写 Treebank 标签，
    // 而 POS_ALIAS_MAP 的键是小写，所以必须先 toLowerCase。
    expect(normalizePos("DET")).toBe("determiner")
    expect(normalizePos("NOUN")).toBe("noun")
    expect(normalizePos("AUX")).toBe("auxiliary verb")
    expect(normalizePos("VERB")).toBe("verb")
  })

  it("带点的缩写也能规范化", () => {
    expect(normalizePos("n.")).toBe("noun")
    expect(normalizePos("adj.")).toBe("adjective")
  })

  it("查不到时回退为小写原文，而不是空串", () => {
    expect(normalizePos("XYZ")).toBe("xyz")
  })

  it("空值返回空串", () => {
    expect(normalizePos(null)).toBe("")
    expect(normalizePos("  ")).toBe("")
  })

  it("词性翻译成中文全称", () => {
    expect(posLabel("DET")).toBe("限定词")
    expect(posLabel("NOUN")).toBe("名词")
    expect(posLabel("AUX")).toBe("助动词")
  })

  it("内部哨兵 `词`/`标点` 不能漏进界面", () => {
    // word-align.ts 用 `词` 表示「是词但词性未知」、`标点` 表示不可输入位。
    // 生产库里存过 `标点`，但 `词` 纯属我们的内部约定；两者都不是词性，
 // 基准实现在拿不到词性时输出空标签（ 的 `if (assignedPos)`）。
    expect(posLabel("词")).toBe("")
    expect(posLabel("标点")).toBe("")
  })

  it("生产库出现过的 UD 标签全部翻成中文，不漏英文", () => {
    // 这些是线上 words[].pos 的真实取值（spaCy 的 Universal Dependencies 标签）。
 // 基准实现的 POS_ALIAS_MAP 只登记词典体例缩写（n./adj./aux.v…），不认 UD，
    // 所以这一层映射是我们为自家语料补的 —— 漏一个，复习屏就会把
    // `ADP` 渲成 "adp"、`PROPN_PERSON` 渲成 "propn_person"。
    const ud: Array<[string, string]> = [
      ["NOUN", "名词"], ["VERB", "动词"], ["ADJ", "形容词"], ["ADV", "副词"],
      ["PRON", "代词"], ["DET", "限定词"], ["ADP", "介词"], ["AUX", "助动词"],
      ["PART", "小品词"], ["CCONJ", "并列连词"], ["SCONJ", "从属连词"],
      ["NUM", "数词"], ["INTJ", "感叹词"], ["PROPN", "专有名词"],
      ["PROPN_PERSON", "人名"], ["SYM", "符号"], ["PUNCT", "标点"], ["X", "其他"],
    ]
    const cjk = /[\u4e00-\u9fff]/
    for (const [tag, zh] of ud) {
      expect(posLabel(tag)).toBe(zh)
      expect(cjk.test(posLabel(tag))).toBe(true)
    }
  })
})

describe("inferPos（词性启发式兜底）", () => {
  it("情态动词与 be 归为动词", () => {
    expect(inferPos("must")).toBe("verb")
    expect(inferPos("be")).toBe("verb")
  })

  it("功能词各归其类", () => {
    expect(inferPos("they")).toBe("pronoun")
    expect(inferPos("the")).toBe("article")
    expect(inferPos("because")).toBe("conjunction")
    expect(inferPos("between")).toBe("preposition")
  })

  it("按后缀推断副词/动词，并忽略大小写与标点", () => {
    expect(inferPos("Quickly")).toBe("adverb")
    expect(inferPos("analyzed")).toBe("verb")
    expect(inferPos("running")).toBe("verb")
    expect(inferPos("  The, ")).toBe("article")
  })

  it("推断不出时返回空串（调用方据此落回调色板）", () => {
    expect(inferPos("analyze")).toBe("")
    expect(inferPos("")).toBe("")
    expect(inferPos(null)).toBe("")
  })
})

describe("posColor", () => {
  it("情态动词优先于普通动词匹配", () => {
    // 'modal verb' 同时包含 'verb'，判断顺序写反就会变成珊瑚红。
    expect(posColor("modal verb")).toBe("#fb923c")
    expect(posColor("verb")).toBe("#f43f5e")
  })

  it("名词与代词分别取蓝/天蓝", () => {
    expect(posColor("noun")).toBe("#3b82f6")
    expect(posColor("pronoun")).toBe("#0ea5e9")
  })

  it("限定词取灰、人名取紫", () => {
    expect(posColor("determiner")).toBe("#64748b")
    expect(posColor("person name")).toBe("#a855f7")
  })

  it("空值取默认灰", () => {
    expect(posColor(null)).toBe("#94a3b8")
    expect(posColor("weird-unknown")).toBe("#94a3b8")
  })
})

describe("hexToRgba", () => {
  it("展开三位缩写并按 alpha 输出", () => {
    expect(hexToRgba("#abc", 0.5)).toBe("rgba(170, 187, 204, 0.5)")
  })

  it("直接透传 rgb()/rgba()", () => {
    expect(hexToRgba("rgb(1, 2, 3)", 0.25)).toBe("rgba(1, 2, 3, 0.25)")
  })

  it("非法输入回退蓝色而不是抛错", () => {
    expect(hexToRgba("not-a-color")).toBe("rgba(59, 130, 246, 1)")
    expect(hexToRgba(null)).toBe("rgba(59, 130, 246, 1)")
  })
})

describe("extractPhonetic", () => {
  it("默认取美音，缺失时回退英音", () => {
    expect(extractPhonetic({ uk: "ðə", us: "ði" })).toBe("ði")
    expect(extractPhonetic({ uk: "ðə", us: "" })).toBe("ðə")
  })

  it("uk 口音反过来优先英音", () => {
    expect(extractPhonetic({ uk: "ðə", us: "ði" }, "uk")).toBe("ðə")
  })

  it("兼容旧的纯字符串格式", () => {
    // 线上有 7.5 万行 phonetic 是字符串，schema 注释明确禁止窄化成 string。
    expect(extractPhonetic("ˈænəlaɪz")).toBe("ˈænəlaɪz")
  })

  it("null / 空对象返回空串", () => {
    expect(extractPhonetic(null)).toBe("")
    expect(extractPhonetic({ uk: "", us: "" })).toBe("")
  })
})

describe("wordLookupKey", () => {
  it("缩写映射到原形", () => {
    expect(wordLookupKey("don't")).toBe("do")
    expect(wordLookupKey("can't")).toBe("can")
  })

  it("未收录的缩写去掉撇号后缀", () => {
    expect(wordLookupKey("what're")).toBe("what")
  })

  it("单字母只在 a / i 时保留", () => {
    expect(wordLookupKey("a")).toBe("a")
    expect(wordLookupKey("I")).toBe("i")
    expect(wordLookupKey("s")).toBeNull()
  })

  it("弯引号先归一成直引号再查表", () => {
    // 库里存的可能是 U+2019，直接比较会失配。
    expect(wordLookupKey("don\u2019t")).toBe("do")
  })
})

describe("buildAnnotation", () => {
  it("按 words 骨架切出单词段与标点/空格段", () => {
    const s = sentence("The scientist works.", [
      { english: "The", chinese: "定冠词", phonetic: { uk: "ðə", us: "ðə" }, pos: "DET" },
      { english: "scientist", chinese: "科学家", phonetic: { uk: "x", us: "ˈsaɪəntɪst" }, pos: "NOUN" },
      { english: "works", chinese: "工作", phonetic: null, pos: "VERB" },
    ])
    const a = buildAnnotation(s)
    const wordSegs = a.segments.filter((x) => x.kind === "word")
    expect(wordSegs.map((x) => (x.kind === "word" ? x.word.text : ""))).toEqual([
      "The",
      "scientist",
      "works",
    ])
    // 结尾的句点必须落在 plain 段里，而不是被吞掉。
    const tail = a.segments[a.segments.length - 1]
    expect(tail.kind).toBe("plain")
    if (tail.kind === "plain") {
      const text = tail.pieces.map((p) => p.text).join("")
      expect(text).toBe(".")
    }
  })

  it("词性哨兵 `词` 既不进标签、也不进词性色，而是走启发式/调色板", () => {
    // 线上 `analyze` 这类句子 `words` 为空，API 用 alignWordsWithEnglish 补出
    // pos:"词" 的骨架。它必须在展示层被消化掉：
 // · 标签为空（基准实现 只在有词性时输出 .word-pos-label）
    //   · 颜色落回 MODERN_COLOR_PALETTE 首位 #3b82f6，而不是 #94a3b8 默认灰
    const s = sentence("analyze", [
      { english: "analyze", chinese: null, phonetic: null, pos: "词" },
    ])
    const a = buildAnnotation(s)
    const w = a.segments.find((x) => x.kind === "word")
    expect(w?.kind).toBe("word")
    if (w?.kind === "word") {
      expect(w.word.posLabel).toBe("")
      expect(w.word.color).toBe("#3b82f6")
    }
  })

  it("哨兵位置能吃到启发式词性", () => {
    // `The` 没有真实词性时，`inferPos` 的冠词规则要补上中文标签与灰色。
    const s = sentence("The", [
      { english: "The", chinese: null, phonetic: null, pos: "词" },
    ])
    const a = buildAnnotation(s)
    const w = a.segments.find((x) => x.kind === "word")
    if (w?.kind === "word") {
      expect(w.word.posLabel).toBe("冠词")
      expect(w.word.color).toBe("#64748b")
    }
  })

  it("整句有音标时，缺音标的词也带占位标记", () => {
    const s = sentence("The scientist works.", [
      { english: "The", chinese: "", phonetic: { uk: "ðə", us: "ðə" }, pos: "DET" },
      { english: "scientist", chinese: "", phonetic: null, pos: "NOUN" },
      { english: "works", chinese: "", phonetic: null, pos: "VERB" },
    ])
    const a = buildAnnotation(s)
    expect(a.hasPhonetics).toBe(true)
    // 没音标的词 phonetic 为空 —— 由渲染层决定要不要补 placeholder。
    expect(a.words.find((w) => w.text === "scientist")?.phonetic).toBe("")
  })

  it("全句无音标时 hasPhonetics 为 false", () => {
    const s = sentence("Hi there", [
      { english: "Hi", chinese: "", phonetic: null, pos: "INTJ" },
      { english: "there", chinese: "", phonetic: null, pos: "ADV" },
    ])
    expect(buildAnnotation(s).hasPhonetics).toBe(false)
  })

 it("把配色写成内联 CSS 变量（基准实现不写 class）", () => {
    const s = sentence("Cats sleep", [
      { english: "Cats", chinese: "猫", phonetic: null, pos: "NOUN" },
      { english: "sleep", chinese: "睡觉", phonetic: null, pos: "VERB" },
    ])
    const a = buildAnnotation(s)
    const cat = a.words.find((w) => w.text === "Cats")
    expect(cat?.styleVars["--word-color"]).toBe("#3b82f6")
    expect(cat?.styleVars["--word-chip-bg"]).toBe("rgba(59, 130, 246, 0.35)")
    expect(cat?.styleVars["--word-line-color"]).toBe("rgba(59, 130, 246, 0.55)")
  })

  it("空句与无 words 时不抛错", () => {
    expect(buildAnnotation(null).segments).toEqual([])
    expect(buildAnnotation(sentence("", [])).segments).toEqual([])
    // 没有 words 时不能整句丢掉：降级成一段纯文本，由渲染层回退到
 // `.answer-text-plain`（基准实现在 generateAnnotatedSentence 里也是这个兜底）。
    const noWords = buildAnnotation(sentence("Hello", null))
    expect(noWords.words).toEqual([])
    expect(
      noWords.segments
        .flatMap((seg) => (seg.kind === "plain" ? seg.pieces.map((p) => p.text) : []))
        .join(""),
    ).toBe("Hello")
  })

  it("words 里的 pos 为「标点」时被过滤掉", () => {
    // alignWordsWithEnglish 给非字母 token 打 pos="标点"，它们不该注音/着色。
    const s = sentence("Hi, Bob", [
      { english: "Hi", chinese: "嗨", phonetic: null, pos: "INTJ" },
      { english: ",", chinese: null, phonetic: null, pos: "标点" },
      { english: "Bob", chinese: "鲍勃", phonetic: null, pos: "PROPN" },
    ])
    const a = buildAnnotation(s)
    expect(a.words.map((w) => w.text)).toEqual(["Hi", "Bob"])
    // 逗号仍然出现在 plain 段里，没有丢。
    const joined = a.segments
      .map((seg) =>
        seg.kind === "plain" ? seg.pieces.map((p) => p.text).join("") : seg.word.text,
      )
      .join("")
    expect(joined).toBe("Hi, Bob")
  })

  it("词序错乱时不会把音标戴到别的词上", () => {
    // 库里存在 words 顺序与 english 不一致的脏数据。顺序推进下 Bob 只能匹配
    // 它自己在句中的那一次出现，先出现的 Hi 找不到就留在 plain 段里 ——
    // 关键是**绝不**把 Bob 的音标戴到 Hi 头上。
    const s = sentence("Hi Bob", [
      { english: "Bob", chinese: "鲍勃", phonetic: { uk: "", us: "bɒb" }, pos: "PROPN" },
      { english: "Hi", chinese: "嗨", phonetic: { uk: "", us: "haɪ" }, pos: "INTJ" },
    ])
    const a = buildAnnotation(s)
    expect(a.words.map((w) => w.text)).toEqual(["Bob"])
    expect(a.words[0].phonetic).toBe("bɒb")
    // 原文一个字都没丢。
    const joined = a.segments
      .map((seg) =>
        seg.kind === "plain" ? seg.pieces.map((p) => p.text).join("") : seg.word.text,
      )
      .join("")
    expect(joined).toBe("Hi Bob")
  })

  it("缩写后缀被标记出来，便于贴合前一个词", () => {
    const s = sentence("It's fine", [
      { english: "It's", chinese: "它是", phonetic: { uk: "", us: "ɪts" }, pos: "PRON" },
      { english: "fine", chinese: "好", phonetic: null, pos: "ADJ" },
    ])
    const a = buildAnnotation(s)
    expect(a.words[0].contractionSuffix).toBe(false)
  })
})
