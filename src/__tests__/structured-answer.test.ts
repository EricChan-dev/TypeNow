import { describe, expect, it } from "vitest"
import {
  buildFragmentsTextForComparison,
  buildStructuredAnswer,
  clickableTokens,
  extractSentenceTerminalPunctuation,
  hasSentenceTerminalPunctuation,
  normalizeSentenceForComparison,
} from "@/lib/structured-answer"
import type { Sentence, SentenceComponent } from "@/types"

function sentence(
  english: string,
  structure: SentenceComponent[] | null,
  words?: Sentence["words"],
): Sentence {
  return {
    id: "s1",
    chinese: "译文",
    english,
    words_count: 0,
    category: "c",
    difficulty: 1,
    tags: [],
    sentenceStructure: structure,
    words: words ?? null,
  }
}

function comp(
  start: number,
  end: number,
  type: string,
  role: string,
  text: string,
  explanation = "",
): SentenceComponent {
  return { start, end, type, role, text, explanation }
}

describe("normalizeSentenceForComparison", () => {
  it("抹平大小写、标点与弯直引号差异", () => {
    expect(normalizeSentenceForComparison("She said, “Hello!”")).toBe("she said hello")
    // 弯引号转直引号后仍保留撇号 —— don't / don't 要能对上
    expect(normalizeSentenceForComparison("Don’t go")).toBe("don't go")
    expect(normalizeSentenceForComparison("Don't go")).toBe("don't go")
  })

  it("空值安全", () => {
    expect(normalizeSentenceForComparison(null)).toBe("")
    expect(normalizeSentenceForComparison(undefined)).toBe("")
    expect(normalizeSentenceForComparison("")).toBe("")
  })
})

describe("buildFragmentsTextForComparison", () => {
  it("以撇号开头的片段与前词直接拼接，不插空格", () => {
    const text = buildFragmentsTextForComparison([
      { text: "It" },
      { text: "'s" },
      { text: "fine" },
    ])
    expect(text).toBe("It's fine")
  })

  it("忽略空片段，空数组返回空串", () => {
    expect(buildFragmentsTextForComparison([])).toBe("")
    expect(buildFragmentsTextForComparison(null)).toBe("")
    expect(buildFragmentsTextForComparison([{ text: "  " }, { text: "Hi" }])).toBe("Hi")
  })
})

describe("句末标点工具", () => {
  it("提取标点，含结尾引号/括号", () => {
    expect(extractSentenceTerminalPunctuation("Look!")).toBe("!")
    expect(extractSentenceTerminalPunctuation('He said "stop."')).toBe('."')
    expect(extractSentenceTerminalPunctuation("(really?)")).toBe("?)")
    expect(extractSentenceTerminalPunctuation("no punct here")).toBe("")
    expect(extractSentenceTerminalPunctuation("中文。")).toBe("。")
  })

  it("判断是否已自带句末标点", () => {
    expect(hasSentenceTerminalPunctuation("Stop.")).toBe(true)
    expect(hasSentenceTerminalPunctuation("Stop")).toBe(false)
  })
})

describe("clickableTokens", () => {
  it("单词分支：去掉首尾标点后整段可点，标点单独成段", () => {
    const tokens = clickableTokens('"Farmer!"')
    expect(tokens.map((t) => t.text).join("")).toBe('"Farmer!"')
    const clickable = tokens.filter((t) => t.query)
    expect(clickable).toHaveLength(1)
    expect(clickable[0].text).toBe("Farmer")
    expect(clickable[0].query).toBe("farmer")
  })

  it("don't 的查词键退化成 do", () => {
    const tokens = clickableTokens("Don't")
    expect(tokens.find((t) => t.query)?.query).toBe("do")
  })

  it("Farmer's 的查词键取撇号前缀", () => {
    const tokens = clickableTokens("Farmer's wife")
    expect(tokens.filter((t) => t.query).map((t) => t.query)).toEqual(["farmer", "wife"])
  })

  it("多词文本跳过单字母，但保留 a / i", () => {
    const tokens = clickableTokens("a cat and I")
    expect(tokens.filter((t) => t.query).map((t) => t.query)).toEqual(["a", "cat", "and", "i"])
  })

  it("拼接后与原文完全一致（不丢字符）", () => {
    const text = '"Wake up, Farmer!" yelled Farmer\'s wife'
    expect(clickableTokens(text).map((t) => t.text).join("")).toBe(text)
  })
})

describe("buildStructuredAnswer — 降级", () => {
  it("没有结构数据时给纯文本", () => {
    const r = buildStructuredAnswer(sentence("Hello there", null))
    expect(r.structured).toBe(false)
    expect(r.plainText).toBe("Hello there")
    expect(r.parts).toEqual([])
  })

  it("空数组同样降级", () => {
    expect(buildStructuredAnswer(sentence("Hello", [])).structured).toBe(false)
  })
})

describe("buildStructuredAnswer — 渲染", () => {
  it("逐个成分产出标签、释义、下标与可点词", () => {
    const r = buildStructuredAnswer(
      sentence("She said hello.", [
        comp(0, 0, "subject", "主语", "She", "代词，动作发出者"),
        comp(1, 1, "predicate", "谓语", "said"),
        comp(2, 2, "object", "宾语", "hello."),
      ]),
    )
    expect(r.structured).toBe(true)
    expect(r.parts.map((p) => p.componentType)).toEqual(["subject", "predicate", "object"])
    expect(r.parts.map((p) => p.label)).toEqual(["主语", "谓语", "宾语"])
    expect(r.parts[0].meaning).toBe("代词，动作发出者")
    expect(r.parts.map((p) => [p.wordStart, p.wordEnd])).toEqual([[0, 0], [1, 1], [2, 2]])
  })

  it("type 为空时退化成 role 作标签", () => {
    const r = buildStructuredAnswer(sentence("Hello", [comp(0, 0, "", "感叹词", "Hello")]))
    expect(r.parts[0].componentType).toBe("")
    expect(r.parts[0].label).toBe("感叹词")
  })

  it("句末标点只补在最后一个非空成分上", () => {
    // 结构的 text 都没带句末标点 → 要把原句的 "." 补回来
    const r = buildStructuredAnswer(
      sentence("I am here.", [
        comp(0, 0, "subject", "主语", "I"),
        comp(1, 2, "predicate", "谓语", "am here"),
      ]),
    )
    expect(r.parts[0].trailingPunctuation).toBe("")
    expect(r.parts[1].trailingPunctuation).toBe(".")
  })

  it("结构已自带句末标点时不重复补", () => {
    const r = buildStructuredAnswer(
      sentence("I am here.", [comp(0, 2, "subject", "主语", "I am here.")]),
    )
    expect(r.parts[0].trailingPunctuation).toBe("")
  })

  it("中文句末标点（。）也能补", () => {
    const r = buildStructuredAnswer(
      sentence("I am here。", [comp(0, 2, "subject", "主语", "I am here")]),
    )
    expect(r.parts[0].trailingPunctuation).toBe("。")
  })

  it("下标有缺口时直接用库里的 start/end（不顺序累加）", () => {
    // 真实数据：are(1) / used(3) 没有任何成分覆盖。顺序累加会把 often 算成 1。
    const r = buildStructuredAnswer(
      sentence("They are often used to decorate windows", [
        comp(0, 0, "subject", "主语", "They"),
        comp(2, 2, "adverbial", "状语", "often"),
        comp(4, 5, "predicative", "表语", "to decorate windows"),
      ]),
    )
    // 关键断言：often 的第 3 个元素下标必须是 2（库里真值），不是 1（累加值）
    expect(r.parts[1].wordStart).toBe(2)
    expect(r.parts[1].wordEnd).toBe(2)
    expect(r.parts[2].wordStart).toBe(4)
  })

  it("存在于撇号开头的成分时整句禁用高亮属性", () => {
    const r = buildStructuredAnswer(
      sentence("It's fine.", [
        comp(0, 0, "subject", "主语", "It"),
        comp(1, 1, "subject", "主语", "'s"),
        comp(2, 2, "predicative", "表语", "fine."),
      ]),
    )
    expect(r.parts.every((p) => p.wordStart === null && p.wordEnd === null)).toBe(true)
    expect(r.parts[1].contractionSuffix).toBe(true)
  })

  it("缩写后缀没音标时要求渲染占位 span", () => {
    const r = buildStructuredAnswer(
      sentence("It's fine.", [
        comp(0, 0, "subject", "主语", "It"),
        comp(1, 1, "subject", "主语", "'s"),
      ]),
    )
    expect(r.parts[1].phoneticsPlaceholder).toBe(true)
    expect(r.parts[0].phoneticsPlaceholder).toBe(false)
  })

  it("空 text 的成分被丢弃", () => {
    const r = buildStructuredAnswer(
      sentence("Hi", [comp(0, 0, "subject", "主语", "  "), comp(0, 0, "object", "宾语", "Hi")]),
    )
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0].text).toBe("Hi")
  })
})

describe("buildStructuredAnswer — 一致性校验", () => {
  it("不一致时 enableFallback=true 降级为纯文本（练习中看答案）", () => {
    const r = buildStructuredAnswer(
      sentence("Completely different sentence here", [comp(0, 0, "subject", "主语", "Nope")]),
      "us",
      true,
    )
    expect(r.structured).toBe(false)
    expect(r.plainText).toBe("Completely different sentence here")
  })

  it("不一致时 enableFallback=false 仍渲染结构（复习界面）", () => {
    const r = buildStructuredAnswer(
      sentence("Completely different sentence here", [comp(0, 0, "subject", "主语", "Nope")]),
      "us",
      false,
    )
    expect(r.structured).toBe(true)
    expect(r.parts).toHaveLength(1)
  })

  it("句首多补的隐含主语 You 会被去掉后匹配成功", () => {
    // 祈使句：原句没有 You，结构补了一个 You
    const r = buildStructuredAnswer(
      sentence("Close the door.", [
        comp(0, 0, "subject", "主语", "You"),
        comp(1, 3, "predicate", "谓语", "Close the door."),
      ]),
      "us",
      true,
    )
    expect(r.structured).toBe(true)
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0].text).toBe("Close the door.")
  })

  it("原句本身以 You 开头时不触发隐含主语容错", () => {
    const r = buildStructuredAnswer(
      sentence("You are here.", [
        comp(0, 0, "subject", "主语", "You"),
        comp(1, 2, "predicate", "谓语", "are here."),
      ]),
      "us",
      true,
    )
    expect(r.structured).toBe(true)
    expect(r.parts).toHaveLength(2)
  })
})

describe("buildStructuredAnswer — 音标", () => {
  it("按 words 查音标，重复词按顺序消费", () => {
    const r = buildStructuredAnswer(
      sentence(
        "The cat and the dog",
        [
          comp(0, 0, "subject", "主语", "The cat"),
          comp(1, 2, "predicate", "谓语", "and the dog"),
        ],
        [
          { english: "The", chinese: null, phonetic: { uk: "uk1", us: "us1" }, pos: "DET" },
          { english: "cat", chinese: null, phonetic: "kæt", pos: "NOUN" },
          { english: "and", chinese: null, phonetic: "ænd", pos: "CONJ" },
          { english: "the", chinese: null, phonetic: { uk: "uk2", us: "us2" }, pos: "DET" },
          { english: "dog", chinese: null, phonetic: "dɒɡ", pos: "NOUN" },
        ],
      ),
      "us",
    )
    // 默认美音
    expect(r.parts[0].phonetics).toEqual(["us1", "kæt"])
    // 第二个 the 消费队列里第二条，不是复用第一条
    expect(r.parts[1].phonetics).toEqual(["ænd", "us2", "dɒɡ"])
  })

  it("口音切到英音", () => {
    const r = buildStructuredAnswer(
      sentence("the cat", [comp(0, 1, "subject", "主语", "the cat")], [
        { english: "the", chinese: null, phonetic: { uk: "uk1", us: "us1" }, pos: "DET" },
        { english: "cat", chinese: null, phonetic: { uk: "kæt-uk", us: "kæt-us" }, pos: "NOUN" },
      ]),
      "uk",
    )
    expect(r.parts[0].phonetics).toEqual(["uk1", "kæt-uk"])
  })

  it("没有音标数据时不产生任何音标", () => {
    const r = buildStructuredAnswer(
      sentence("Hello there", [comp(0, 1, "subject", "主语", "Hello there")]),
    )
    expect(r.parts[0].phonetics).toEqual([])
  })

  it("缩写后缀不消耗音标队列", () => {
    const r = buildStructuredAnswer(
      sentence("It's fine", [comp(0, 0, "subject", "主语", "It"), comp(1, 1, "subject", "主语", "'s")], [
        { english: "It", chinese: null, phonetic: "ɪt", pos: "PRON" },
        { english: "fine", chinese: null, phonetic: "faɪn", pos: "ADJ" },
      ]),
    )
    expect(r.parts[0].phonetics).toEqual(["ɪt"])
    expect(r.parts[1].phonetics).toEqual([])
  })
})
