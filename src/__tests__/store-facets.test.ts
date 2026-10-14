import { describe, expect, it } from "vitest"
import { buildStoreFacets, type StoreFacetRow } from "@/lib/store-facets"
import { COURSE_CATEGORIES, type CourseCategory } from "@/types/course"

/**
 * 造一个更小的分类表。
 *
 * 刻意不用真实的 COURSE_CATEGORIES：那个表有 4 个分类 39 个子分类，
 * 用它写断言会让「某个数字从哪来」变得难查。结构（含 "all" 空壳）保持一致。
 */
const CATS: CourseCategory[] = [
  { key: "all", label: "全部课程", subCategories: [] },
  {
    key: "graded_reading",
    label: "分级阅读",
    subCategories: [
      { key: "raz", label: "RAZ" },
      { key: "lets_go", label: "Let's Go" },
    ],
  },
  {
    key: "exam_prep",
    label: "应试考试",
    subCategories: [{ key: "cet_4_6", label: "大学四六级" }],
  },
]

const row = (
  categoryKey: string | null,
  subCategoryKey: string | null,
  count: number,
): StoreFacetRow => ({ categoryKey, subCategoryKey, count })

describe("buildStoreFacets 装配", () => {
  it("总数 = 各分类之和，分类内子分类之和也等于分类数", () => {
    const f = buildStoreFacets(
      [row("graded_reading", "raz", 7), row("graded_reading", "lets_go", 7), row("exam_prep", "cet_4_6", 23)],
      CATS,
    )

    expect(f.total).toBe(37)
    expect(f.categorized).toBe(37)
    expect(f.uncategorized).toBe(0)
    // 「全部课程」在 total 里，不在 categories 里
    expect(f.categories.map((c) => c.key)).toEqual(["graded_reading", "exam_prep"])

    const graded = f.categories[0]
    expect(graded.count).toBe(14)
    expect(graded.subCategories.reduce((s, x) => s + x.count, 0)).toBe(graded.count)
  })

  it("未分类课程（category_key IS NULL）只计入 total，不摊派给任何分类", () => {
    const f = buildStoreFacets(
      [row("graded_reading", "raz", 7), row(null, null, 11)],
      CATS,
    )

    expect(f.total).toBe(18)
    expect(f.categorized).toBe(7)
    // 这个差额必须显式暴露：否则「总数比各分类之和多」会被当成算错
    expect(f.uncategorized).toBe(11)
    expect(f.categories.reduce((s, c) => s + c.count, 0)).toBe(7)
  })

  it("分类存在但子分类为 NULL 的课程计入该分类，不进任何子分类", () => {
    const f = buildStoreFacets([row("exam_prep", null, 3), row("exam_prep", "cet_4_6", 23)], CATS)

    const exam = f.categories.find((c) => c.key === "exam_prep")!
    expect(exam.count).toBe(26)
    expect(exam.subCategories).toEqual([{ key: "cet_4_6", label: "大学四六级", count: 23 }])
    // 26 与 23 的差额是「没归子类」的 3 门 —— 这是真实数据（生产库 exam_prep 有 3 门）
    expect(exam.count - exam.subCategories.reduce((s, x) => s + x.count, 0)).toBe(3)
  })

  it("没有课程的子分类仍返回 count=0（标签行位置保持稳定）", () => {
    const f = buildStoreFacets([row("graded_reading", "raz", 7)], CATS)

    expect(f.categories[0].subCategories).toEqual([
      { key: "raz", label: "RAZ", count: 7 },
      { key: "lets_go", label: "Let's Go", count: 0 },
    ])
  })

  it("分类表里没有的 category_key 不计入任何标签，但仍在 total 里（差额可见）", () => {
    const f = buildStoreFacets([row("graded_reading", "raz", 7), row("__legacy__", null, 5)], CATS)

    expect(f.total).toBe(12)
    expect(f.categorized).toBe(7)
    expect(f.uncategorized).toBe(5)
    expect(f.categories.every((c) => c.key !== "__legacy__")).toBe(true)
  })

  it("子分类 key 串到别的分类下不会互相污染", () => {
    // 假设两个分类都有一个叫 shared 的子分类（当前 COURSE_CATEGORIES 没有，
    // 但这是「用 category/sub 做复合键」这个决定的防线）
    const cats: CourseCategory[] = [
      { key: "all", label: "全部课程", subCategories: [] },
      { key: "a", label: "A", subCategories: [{ key: "shared", label: "共用" }] },
      { key: "b", label: "B", subCategories: [{ key: "shared", label: "共用" }] },
    ]
    const f = buildStoreFacets([row("a", "shared", 4), row("b", "shared", 6)], cats)

    expect(f.categories[0].subCategories[0].count).toBe(4)
    expect(f.categories[1].subCategories[0].count).toBe(6)
  })

  it("空结果返回全 0，且每个分类 / 子分类依旧存在", () => {
    const f = buildStoreFacets([], CATS)

    expect(f.total).toBe(0)
    expect(f.categories.map((c) => c.count)).toEqual([0, 0])
    expect(f.categories[0].subCategories.map((s) => s.count)).toEqual([0, 0])
  })

  it("count 是字符串或 0 行时不污染结果（MySQL count(*) 可能以字符串回来）", () => {
    const f = buildStoreFacets(
      [
        { categoryKey: "graded_reading", subCategoryKey: "raz", count: "7" as unknown as number },
        row("graded_reading", "lets_go", 0),
      ],
      CATS,
    )

    expect(f.total).toBe(7)
    expect(f.categories[0].subCategories[0].count).toBe(7)
    expect(f.categories[0].subCategories[1].count).toBe(0)
  })

  it("空串 category_key 按未分类处理（不是有效的分类标签）", () => {
    const f = buildStoreFacets([row("", "", 3)], CATS)

    expect(f.total).toBe(3)
    expect(f.categorized).toBe(0)
    expect(f.uncategorized).toBe(3)
  })
})

describe("buildStoreFacets 与真实分类表对齐", () => {
  it("真实 COURSE_CATEGORIES 的每个分类都有子分类，且都不与 all 重复", () => {
    const f = buildStoreFacets([], COURSE_CATEGORIES)

    expect(f.categories.every((c) => c.key !== "all")).toBe(true)
    expect(f.categories.map((c) => c.key)).toEqual(["graded_reading", "school_sync", "exam_prep", "practical"])
    // 标签必须原样来自 COURSE_CATEGORIES —— 前台显示的文案不能在这里被改写
    for (const cat of f.categories) {
      const src = COURSE_CATEGORIES.find((c) => c.key === cat.key)!
      expect(cat.label).toBe(src.label)
      expect(cat.subCategories.map((s) => s.key)).toEqual(src.subCategories.map((s) => s.key))
      expect(cat.subCategories.map((s) => s.label)).toEqual(src.subCategories.map((s) => s.label))
    }
  })
})
