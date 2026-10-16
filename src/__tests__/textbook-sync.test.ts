import { describe, expect, it } from "vitest"
import {
  flattenGradeTabs,
  hasActiveFilters,
  MAX_SEARCH_LENGTH,
  normalizePage,
  normalizeSearchValue,
  pageWindowNumbers,
  pageWindowStart,
  parseLastFilter,
  parseTextbookSyncQuery,
  QUERY_GRADE,
  QUERY_PAGE,
  QUERY_SEARCH,
  QUERY_VERSION,
  restoreSummaryText,
  searchTermError,
  unionVersionTabs,
  type FacetStage,
} from "@/lib/textbook-sync"

/** 造一段 facets 响应形状的测试数据（与 /api/courses/textbook-facets 对齐）。 */
function stage(
  key: string,
  label: string,
  grades: { key: string; label: string; total: number }[],
  versions: { key: string; label: string; count: number }[] = [],
): FacetStage {
  return {
    key,
    label,
    total: grades.reduce((s, g) => s + g.total, 0),
    versionUnclassified: 0,
    versions,
    grades: grades.map((g) => ({ ...g, versions: [] })),
  }
}

describe("textbook-sync 搜索校验（搜索语义）", () => {
  it("单字符提示、空串与多字符通过", () => {
    expect(searchTermError("a")).toBe("请输入至少2个字符进行搜索")
    expect(searchTermError("")).toBeNull()
    expect(searchTermError("人教版")).toBeNull()
  })

  it("normalizeSearchValue trim + 截断到 100", () => {
    expect(normalizeSearchValue("  人教  ")).toBe("人教")
    const long = "字".repeat(MAX_SEARCH_LENGTH + 30)
    expect(normalizeSearchValue(long)).toHaveLength(MAX_SEARCH_LENGTH)
  })
})

describe("textbook-sync 分页窗口（pager.js 语义）", () => {
  it("窗口起点按 5 推进", () => {
    expect(pageWindowStart(1)).toBe(1)
    expect(pageWindowStart(5)).toBe(1)
    expect(pageWindowStart(6)).toBe(6)
    expect(pageWindowStart(11)).toBe(11)
  })

  it("窗口页码列表尊重总页数", () => {
    expect(pageWindowNumbers(20, 1)).toEqual([1, 2, 3, 4, 5])
    expect(pageWindowNumbers(7, 6)).toEqual([6, 7])
    expect(pageWindowNumbers(0, 1)).toEqual([])
  })

  it("normalizePage 越界与非法回退 1", () => {
    expect(normalizePage("3")).toBe(3)
    expect(normalizePage("0")).toBe(1)
    expect(normalizePage("10001")).toBe(1)
    expect(normalizePage("abc")).toBe(1)
    expect(normalizePage("3.5")).toBe(1)
    expect(normalizePage(null)).toBe(1)
  })
})

describe("textbook-sync facets 拍平", () => {
  const stages: FacetStage[] = [
    stage("primary", "小学", [
      { key: "grade_1", label: "一年级", total: 30 },
      { key: "grade_2", label: "二年级", total: 12 },
    ], [
      { key: "pep", label: "人教版", count: 35 },
      { key: "yilin", label: "译林版", count: 5 },
    ]),
    stage("junior", "初中", [{ key: "grade_7", label: "七年级", total: 9 }], [
      { key: "pep", label: "人教版", count: 4 },
      { key: "fltrp", label: "外研版", count: 5 },
    ]),
    stage("ungraded", "未分级", [], [{ key: "pep", label: "人教版", count: 2 }]),
  ]

  it("flattenGradeTabs 拍平年级并把未分级放最后", () => {
    expect(flattenGradeTabs(stages)).toEqual([
      { key: "grade_1", label: "一年级" },
      { key: "grade_2", label: "二年级" },
      { key: "grade_7", label: "七年级" },
      { key: "ungraded", label: "未分级" },
    ])
  })

  it("unionVersionTabs 跨学段累加并按 count 倒序", () => {
    const versions = unionVersionTabs(stages)
    expect(versions[0]).toMatchObject({ key: "pep", count: 41 })
    expect(versions.map((v) => v.key)).toEqual(["pep", "fltrp", "yilin"])
  })

  it("没有未分级时不追加未分级 tab", () => {
    expect(flattenGradeTabs([stages[0]])).toEqual([
      { key: "grade_1", label: "一年级" },
      { key: "grade_2", label: "二年级" },
    ])
  })
})

describe("textbook-sync 「上次选择」", () => {
  it("restoreSummaryText 按维度拼接", () => {
    expect(restoreSummaryText({ gradeName: "一年级", publisherName: "人教版" })).toBe(
      "上次选择: 一年级 · 人教版",
    )
    expect(restoreSummaryText({ gradeName: "一年级", publisherName: "" })).toBe("上次选择: 一年级")
    expect(restoreSummaryText(null)).toBe("")
  })

  it("parseLastFilter 坏数据当不存在", () => {
    expect(parseLastFilter(null)).toBeNull()
    expect(parseLastFilter("not json")).toBeNull()
    expect(parseLastFilter(JSON.stringify({ gradeCode: "", publisherId: "" }))).toBeNull()
    expect(parseLastFilter(JSON.stringify({ gradeCode: "grade_1", gradeName: "一年级" }))).toMatchObject({
      gradeCode: "grade_1",
      gradeName: "一年级",
      publisherId: "",
    })
  })
})

describe("textbook-sync URL 参数解析", () => {
  it("白名单外的年级/版本回退空，页码归一", () => {
    const q = parseTextbookSyncQuery(
      new URLSearchParams(
        `?${QUERY_GRADE}=grade_9&${QUERY_VERSION}=pep&${QUERY_SEARCH}=人教&${QUERY_PAGE}=2`,
      ),
      ["grade_1", "grade_9"],
      ["pep", "yilin"],
    )
    expect(q).toEqual({ gradeCode: "grade_9", publisherId: "pep", courseName: "人教", page: 2 })
  })

  it("非法值回退", () => {
    const q = parseTextbookSyncQuery(
      new URLSearchParams(`?${QUERY_GRADE}=hacked&${QUERY_PAGE}=99999&${QUERY_SEARCH}=${"x".repeat(120)}`),
      ["grade_1"],
      ["pep"],
    )
    expect(q.gradeCode).toBe("")
    expect(q.publisherId).toBe("")
    expect(q.page).toBe(1)
    expect(q.courseName).toHaveLength(100)
  })
})

describe("textbook-sync hasActiveFilters", () => {
  it("任一维度生效即 true", () => {
    expect(hasActiveFilters("", "", "")).toBe(false)
    expect(hasActiveFilters("grade_1", "", "")).toBe(true)
    expect(hasActiveFilters("", "pep", "")).toBe(true)
    expect(hasActiveFilters("", "", "人教")).toBe(true)
  })
})
