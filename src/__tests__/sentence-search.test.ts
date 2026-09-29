/**
 * 全库句子搜索的查询构造逻辑（src/lib/sentence-search.ts）。
 *
 * 这里每条规则都对应一个**在生产库逐词量出来的**事实，不是凭空设的限制。
 * 最容易写错的是"为什么英文不能全库搜"—— 那条有反直觉的实测证据，
 * 所以用例里把数字也写进去，避免以后有人"顺手放开"又踩回去。
 */
import { describe, it, expect } from "vitest"
import {
  MAX_TERM_LENGTH,
  MIN_TERM_LENGTH,
  NGRAM_TOKEN_SIZE,
  analyzeSearchTerm,
  hasCjk,
  isPureCjk,
  normalizeSearchTerm,
  rejectMessage,
  toBooleanPhrase,
} from "@/lib/sentence-search"

describe("normalizeSearchTerm · 清洗", () => {
  it("去掉会破坏引号短语语法的双引号与反斜杠", () => {
    expect(normalizeSearchTerm('天"气')).toBe("天气")
    expect(normalizeSearchTerm("天\\气")).toBe("天气")
    expect(normalizeSearchTerm('a"b\\c"d')).toBe("abcd")
  })

  it("保留 + - * @ ~ ( ) 等运算符（引号短语内按字面处理，实测不报错）", () => {
    expect(normalizeSearchTerm("天气*")).toBe("天气*")
    expect(normalizeSearchTerm("+天气-good")).toBe("+天气-good")
  })

  it("折叠连续空白（多空格会让短语匹配失败）", () => {
    expect(normalizeSearchTerm("  study   habits  ")).toBe("study habits")
    expect(normalizeSearchTerm("天气   很好")).toBe("天气 很好")
  })
})

describe("CJK 判定", () => {
  it("hasCjk 识别人日韩统一表意文字", () => {
    expect(hasCjk("天气")).toBe(true)
    expect(hasCjk("Robbie")).toBe(false)
    expect(hasCjk("来吧Robbie")).toBe(true)
  })

  it("isPureCjk 要求全部是中文（允许中文标点与空格）", () => {
    expect(isPureCjk("天气")).toBe(true)
    expect(isPureCjk("天气，很好。")).toBe(true)
    expect(isPureCjk("天气 很好")).toBe(true)
    // 中文夹英文不算纯中文 —— 实测这种组合的搜索结果是错的
    expect(isPureCjk("来吧Robbie")).toBe(false)
    expect(isPureCjk("第4单元")).toBe(false)
    expect(isPureCjk("Robbie")).toBe(false)
    expect(isPureCjk("")).toBe(false)
  })

  it("ASCII 标点也算非纯中文（det. 那种词典式关键词不能全库搜）", () => {
    // 生产实测 det.：MATCH 44621 条 vs LIKE 217 条，多 205 倍
    expect(isPureCjk("det.")).toBe(false)
  })
})

describe("analyzeSearchTerm · 什么能全库搜", () => {
  it("纯中文 ≥2 字：可以（实测 7/7 与 LIKE 完全一致）", () => {
    for (const term of ["天气", "学习英语", "中华人民共和国", "动物保护"]) {
      const r = analyzeSearchTerm(term)
      expect(r.globalSearchable, term).toBe(true)
      expect(r.kind).toBe("cjk")
      expect(r.reason).toBeUndefined()
    }
  })

  it("单字：不可以，且原因是 too_short（ngram 分词长度是 2，必然 0 条）", () => {
    const r = analyzeSearchTerm("天")
    expect(r.globalSearchable).toBe(false)
    expect(r.reason).toBe("too_short")
  })

  it("空串 / 纯空白：不可以，原因是 empty", () => {
    for (const raw of ["", "   ", "\t\n"]) {
      const r = analyzeSearchTerm(raw)
      expect(r.globalSearchable).toBe(false)
      expect(r.reason).toBe("empty")
    }
  })

  it("纯英文：**不可以** —— 这是最反直觉的一条，有实测证据", () => {
    // 生产库实测（MATCH 带引号短语 vs LIKE 全表）：
    //   James   4414 vs 94     （多 47 倍；抽样命中的句子只含 am/me/es）
    //   jame   68640 vs 94     （多 730 倍）
    //   jam        0 vs 4      （明明有包含关系却一条不返回）
    // 返回不含关键词的句子比拒绝更糟 —— 管理员会据此误判库里有什么。
    for (const term of ["James", "weather", "jam", "det."]) {
      const r = analyzeSearchTerm(term)
      expect(r.globalSearchable, term).toBe(false)
      expect(r.reason).toBe("not_cjk")
    }
  })

  it("中英混合：**不可以**，原因是 mixed（单独一档，便于给出更准的提示）", () => {
    // 生产实测：与Allen → MATCH 1331 条，而 LIKE 是 0 条（凭空造出 1331 条假结果）
    const r = analyzeSearchTerm("与Allen")
    expect(r.globalSearchable).toBe(false)
    expect(r.reason).toBe("mixed")
    expect(r.kind).toBe("mixed")
  })

  it("两字母英文：不可以（不是「给提示」，而是直接拒绝）", () => {
    // AI / US 这类词在英文索引里能工作，但那是**默认解析器**的行为；
    // 本项目用的是 ngram，实测不可靠，所以统一拒绝。
    const r = analyzeSearchTerm("AI")
    expect(r.globalSearchable).toBe(false)
    expect(r.reason).toBe("not_cjk")
  })

  it("超长关键词：不可以，原因是 too_long", () => {
    const r = analyzeSearchTerm("天".repeat(MAX_TERM_LENGTH + 1))
    expect(r.globalSearchable).toBe(false)
    expect(r.reason).toBe("too_long")
  })

  it("正好到上限：可以", () => {
    const r = analyzeSearchTerm("天".repeat(MAX_TERM_LENGTH))
    expect(r.globalSearchable).toBe(true)
  })

  it("emoji 按码点计数（单个 emoji 长度为 1，不会被误判成可搜）", () => {
    const r = analyzeSearchTerm("🌤")
    expect(r.length).toBe(1)
    expect(r.globalSearchable).toBe(false)
  })

  it("中文里的空格不影响判定", () => {
    expect(analyzeSearchTerm("天气 很好").globalSearchable).toBe(true)
  })
})

describe("toBooleanPhrase · 构造绑定参数", () => {
  it("包成引号短语（对中文，这是与 LIKE 语义一致的必要条件）", () => {
    // 裸词在 BOOLEAN MODE 下是各 bigram 取或：搜「天气很好」会命中只含「天气」
    // 的 1176 条；加引号后实测 18 条，与 LIKE 一致。
    expect(toBooleanPhrase("天气")).toBe('"天气"')
    expect(toBooleanPhrase("天气很好")).toBe('"天气很好"')
  })

  it("构造前先清洗，避免用户输入把短语提前闭合", () => {
    expect(toBooleanPhrase('天"气')).toBe('"天气"')
  })

  it("空输入得到空短语（MySQL 返回 0 条而不是报错，实测过）", () => {
    expect(toBooleanPhrase("   ")).toBe('""')
  })
})

describe("rejectMessage · 给用户的说明", () => {
  it("单字：说明长度下限，并指向「先选课时」", () => {
    const msg = rejectMessage(analyzeSearchTerm("天"))
    expect(msg).toContain(String(MIN_TERM_LENGTH))
    expect(msg).toContain("课时")
  })

  it("纯英文：说清「只支持纯中文」并给出替代路径，不能只说失败", () => {
    const msg = rejectMessage(analyzeSearchTerm("James"))
    expect(msg).toContain("纯中文")
    expect(msg).toContain("课时")
  })

  it("中英混合：给出与纯英文不同的说明（指向只写中文）", () => {
    const mixed = rejectMessage(analyzeSearchTerm("与Allen"))
    const ascii = rejectMessage(analyzeSearchTerm("James"))
    expect(mixed).not.toBe(ascii)
    expect(mixed).toContain("中文")
  })

  it("为空 / 超长各有对应说明", () => {
    expect(rejectMessage(analyzeSearchTerm(""))).toContain("请输入")
    expect(
      rejectMessage(analyzeSearchTerm("天".repeat(MAX_TERM_LENGTH + 1))),
    ).toContain("过长")
  })

  it("每种 reason 都有专门文案，不会漏到默认分支", () => {
    const raws = ["", " ", "天", "天".repeat(MAX_TERM_LENGTH + 1), "James", "与Allen"]
    for (const raw of raws) {
      const msg = rejectMessage(analyzeSearchTerm(raw))
      expect(msg, raw).not.toBe("关键词不可用于全库搜索，请先选择题库中的课时。")
      expect(msg.length).toBeGreaterThanOrEqual(8)
    }
  })
})

describe("常量与生产库参数一致", () => {
  it("分词长度是 2（生产库 ngram_token_size=2）", () => {
    // 这个值必须与数据库一致，否则"可搜"的判定会与实际行为脱节。
    // 改数据库参数就必须改这里并重建索引。
    expect(NGRAM_TOKEN_SIZE).toBe(2)
    expect(MIN_TERM_LENGTH).toBe(2)
  })
})
