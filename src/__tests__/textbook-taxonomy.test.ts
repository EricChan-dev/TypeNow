/**
 * 教材同步分类层（src/lib/textbook-taxonomy.ts）。
 *
 * 这里的用例**全部取自生产库真实课程标题**（2026-09-29 抽样），
 * 而不是我编的样例 —— 解析规则的价值完全取决于它在脏数据上的表现：
 * 括号写法不统一、有错别字（「1年纪」）、有缺半个括号的（「人教版】…」）。
 *
 * 最关键的一条约束：**认不出就归 other，不许猜**。
 * 猜错会让用户在错误的教材版本下练习，比"筛不出来"严重得多。
 */
import { describe, it, expect } from "vitest"
import {
  GRADE_LABELS,
  OTHER_VERSION,
  STAGES,
  TEXTBOOK_VERSIONS,
  VERSION_OPTIONS,
  gradesOfStage,
  looksNonTextbook,
  parseTextbookVersion,
  UNGRADED_STAGE_KEY,
  UNGRADED_STAGE_LABEL,
  isUngradedStage,
  stageOfGrade,
  versionLabel,
} from "@/lib/textbook-taxonomy"

describe("学段与年级", () => {
  it("学段：小学 1-6、初中 7-9、高中单桶、中职单桶", () => {
    // vocational 第一版被我漏掉了 —— 生产库有 7 门中职课，
    // 漏掉就等于它们在教材同步页完全不可见
    expect(STAGES.map((s) => s.key)).toEqual(["primary", "junior", "senior", "vocational"])
    expect(gradesOfStage("primary")).toEqual([
      "grade_1", "grade_2", "grade_3", "grade_4", "grade_5", "grade_6",
    ])
    expect(gradesOfStage("junior")).toEqual(["grade_7", "grade_8", "grade_9"])
    expect(gradesOfStage("senior")).toEqual(["high_school"])
    expect(gradesOfStage("vocational")).toEqual(["vocational"])
  })

  it("中职能反查回学段；「未分级」不是学段，而是单独的识别函数", () => {
    expect(stageOfGrade("vocational")).toBe("vocational")
    // 未分级不是一个真学段，不该混进 STAGES（否则会污染 stageOfGrade 的语义）。
    // key 显式放宽成 string 再比：直接比字面量时 TS 会报「StageKey 与 "ungraded"
    // 没有重叠」—— 那个报错本身就说明了这个设计意图，所以这里刻意绕过它。
    expect(STAGES.map((s) => s.key as string)).not.toContain(UNGRADED_STAGE_KEY)
    expect(isUngradedStage(UNGRADED_STAGE_KEY)).toBe(true)
    expect(isUngradedStage("primary")).toBe(false)
    expect(UNGRADED_STAGE_LABEL).toBe("未分级")
  })

  it("未知学段返回空数组而不是抛异常（URL 参数不可信）", () => {
    expect(gradesOfStage("university")).toEqual([])
    expect(gradesOfStage("")).toEqual([])
  })

  it("年级能反查回学段", () => {
    expect(stageOfGrade("grade_1")).toBe("primary")
    expect(stageOfGrade("grade_6")).toBe("primary")
    expect(stageOfGrade("grade_7")).toBe("junior")
    expect(stageOfGrade("grade_9")).toBe("junior")
    expect(stageOfGrade("high_school")).toBe("senior")
    // 中职是独立学段（它同时存在于 COURSE_CATEGORIES 的 school_sync 子分类里）
    expect(stageOfGrade("vocational")).toBe("vocational")
  })

  it("每个学段内的年级都有中文标签（UI 要靠它渲染，缺一个就是空白按钮）", () => {
    for (const stage of STAGES) {
      for (const g of stage.grades) {
        expect(GRADE_LABELS[g], `缺少 ${g} 的标签`).toBeTruthy()
      }
    }
  })
})

describe("parseTextbookVersion · 括号写法（最可靠的一类）", () => {
  const cases: [string, string][] = [
    ["【人教版】一年级上册【PEP课本同步】", "pep"],
    ["【人教版】一年级下册【新起点版课本同步】", "pep"],
    ["【译林版】一年级上册【课本同步】", "yilin"],
    ["【北师大版】三年级上册【课程同步】", "bnup"],
    ["【外研版 三起点】三年级上册【课本同步】", "fltrp"],
    ["【外研版Join in】三年级上册【课本同步】", "fltrp"],
    ["【粤人版】三年级下册【课本同步】", "yueren"],
    ["【重庆版】 三年级上册【课本同步】", "chongqing"],
    ["【陕旅版】三年级上册【课本同步】", "shanlv"],
    ["【鲁科五四版】三年级上册【课本同步】", "luke"],
    ["【北京版】一年级上册【课本同步】", "beijing"],
    // 「一起点」是人教版的起点版本，不是独立出版社
    ["【一起点 新交际】一年级上册【课本同步】", "pep"],
    // 生产库里真有这种缺了左括号的标题
    ["人教版】一年级上册【新起点版课本同步】", "pep"],
    // 回填 dry-run 时从生产数据里发现的、我第一版版本表漏掉的出版社
    ["【科普版】八年级下册【课本同步】2024年审定", "kepu"],
  ]

  for (const [title, expected] of cases) {
    it(`${title} → ${expected}`, () => {
      const r = parseTextbookVersion(title)
      expect(r.version).toBe(expected)
      expect(r.source).toBe("bracket")
      expect(r.evidence).toBeTruthy()
    })
  }
})

describe("parseTextbookVersion · 无括号，只能靠关键词", () => {
  const cases: [string, string][] = [
    ["外研版三年级起点三年级下册", "fltrp"],
    ["人教版PEP一年级单词（新课标）", "pep"],
    ["三年级PEP人教老版本", "pep"],
    ["外研社新版三年级上册", "fltrp"],
    ["外研社（三年级起点）五年级下", "fltrp"],
    // 鲁教版（山东教育社）≠ 鲁科版（山东科技社），两种在生产库里都存在
    ["2026鲁教版五四制7年级下册单词表", "lujiao"],
    // 无括号、靠关键词命中的出版社（回填 dry-run 时从生产数据里发现漏掉的）
    ["仁爱新版七年级上册", "renai"],
    ["仁爱七年级短语、单词表（下册）", "renai"],
  ]

  for (const [title, expected] of cases) {
    it(`${title} → ${expected}`, () => {
      const r = parseTextbookVersion(title)
      expect(r.version).toBe(expected)
      expect(r.source).toBe("keyword")
    })
  }
})

describe("parseTextbookVersion · 认不出必须归 other，不许猜", () => {
  const unknown = [
    "1年纪英语基础学习",
    "幼儿启蒙英语",
    "英语启蒙",
    "儿童英语启蒙·生活主题系列",
    "小学一年级：我的家人",
    "小学一年级：颜色、数字与形状",
    "初中英语1674单词",
    "太原市万柏林三中默写",
    "Unit 4 The art of having fun",
    "小学英语短语大满贯",
    // 「只写牛津、没写地区」是**歧义**的：江苏用译林牛津、上海用牛津上海版，
    // 二者是不同教材。规则选择不猜 —— 猜错会让用户在错误的版本下练习。
    "五下单词（牛津版）",
    // 语文出版社的课程不是英语教材版本（它是中职语文，被归在了 school_sync 下）
    "语文出版，基础模块1",
  ]

  for (const title of unknown) {
    it(`${title} → other`, () => {
      const r = parseTextbookVersion(title)
      expect(r.version).toBe(OTHER_VERSION)
      expect(r.source).toBe("none")
      expect(r.evidence).toBe("")
    })
  }

  it("空标题也不抛异常", () => {
    expect(parseTextbookVersion("").version).toBe(OTHER_VERSION)
  })
})

describe("looksNonTextbook · 只识别、不自动改库", () => {
  it("认不出且含启蒙/基础学习之类词 → 疑似非教材同步", () => {
    expect(looksNonTextbook("幼儿启蒙英语", "none")).toBe(true)
    expect(looksNonTextbook("儿童英语启蒙·生活主题系列", "none")).toBe(true)
    expect(looksNonTextbook("1年纪英语基础学习", "none")).toBe(true)
  })

  it("能认出教材版本的一律不打扰（哪怕标题里带'基础'）", () => {
    expect(looksNonTextbook("人教版基础教程", "bracket")).toBe(false)
    expect(looksNonTextbook("人教版基础教程", "keyword")).toBe(false)
  })

  it("认不出但没有可疑词的，也不打扰（可能只是标题没写版本）", () => {
    expect(looksNonTextbook("小学三年级：天气与自然", "none")).toBe(false)
  })
})

describe("版本清单本身", () => {
  it("版本 key 唯一", () => {
    const keys = TEXTBOOK_VERSIONS.map((v) => v.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("筛选选项包含「其他版本」——认不出的课必须有一个归属，否则用户永远看不到它们", () => {
    expect(VERSION_OPTIONS.map((v) => v.key)).toContain(OTHER_VERSION)
    expect(versionLabel(OTHER_VERSION)).toBe("其他版本")
  })

  it("versionLabel 对未知 key 回退到「其他版本」而不是抛异常", () => {
    expect(versionLabel("nonexistent")).toBe("其他版本")
  })

  it("同一版本内不出现重复 pattern（重复没有意义，还会掩盖笔误）", () => {
    for (const v of TEXTBOOK_VERSIONS) {
      expect(new Set(v.patterns).size, `${v.key} 有重复 pattern`).toBe(v.patterns.length)
    }
  })
})
