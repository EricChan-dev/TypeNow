/**
 * 封面解析是三个列表页与课程详情页共用的唯一入口，所以这里守三层降级的**优先级**
 * 与**稳定性**：
 *   1. cover_url 必须压过主题表 —— 否则管理员上传的封面会被主题图覆盖；
 *   2. 未命中槽位必须落到渐变，而不是拼出一个不存在的图片路径
 *      （拼错路径的表现是「图片 404 但页面不报错」，最难发现）；
 *   3. 变体选择必须只由 courseId 决定 —— 若掺入列表下标，
 *      用户每换一次排序方式，同一门课的封面就会跳变。
 */
import { describe, it, expect } from "vitest"
import {
  DEFAULT_THEME,
  getCategoryLabel,
  getTheme,
  resolveCourseCover,
  themeVariantIndex,
} from "@/lib/course-cover"
import { COVER_VARIANTS_PER_THEME } from "@/lib/course-cover-themes"

const base = { id: "course-1", categoryKey: "practical", subCategoryKey: "movies_stories" }

describe("resolveCourseCover · 第 1 层 cover_url 优先", () => {
  it("cover_url 非空时直接用，且不走主题表", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "/images/courses/custom.webp" })
    expect(r.kind).toBe("image")
    if (r.kind === "image") expect(r.src).toBe("/images/courses/custom.webp")
  })

  it("cover_url 是外部 URL 时也直接用（管理员可能填外链）", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "https://cdn.example.com/a.webp" })
    expect(r.kind).toBe("image")
    if (r.kind === "image") expect(r.src).toBe("https://cdn.example.com/a.webp")
  })

  it("cover_url 只有空白字符时视为空，落到下一层", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "   " })
    expect(r.kind).toBe("image")
    if (r.kind === "image") expect(r.src).toMatch(/^\/images\/courses\//)
  })
})

describe("resolveCourseCover · 第 2 层主题表", () => {
  it("命中槽位时指向已生成的变体文件", () => {
    const r = resolveCourseCover({ ...base, coverUrl: null })
    expect(r.kind).toBe("image")
    if (r.kind === "image") {
      expect(r.src).toMatch(/^\/images\/courses\/practical__movies_stories__v[1-4]\.webp$/)
    }
  })

  it("子类为 null 时指向 general 变体", () => {
    const r = resolveCourseCover({ ...base, subCategoryKey: null, coverUrl: null })
    expect(r.kind).toBe("image")
    if (r.kind === "image") {
      expect(r.src).toMatch(/^\/images\/courses\/practical__general__v[1-4]\.webp$/)
    }
  })

  it("两个维度都为 null 时命中 none__general，不是兜底", () => {
    const r = resolveCourseCover({
      id: "c",
      coverUrl: null,
      categoryKey: null,
      subCategoryKey: null,
    })
    expect(r.kind).toBe("image")
    if (r.kind === "image") {
      expect(r.src).toMatch(/^\/images\/courses\/none__general__v[1-4]\.webp$/)
    }
  })

  it("主题图路径携带的变体下标与 themeVariantIndex 一致", () => {
    const r = resolveCourseCover({ ...base, coverUrl: null })
    const expected = themeVariantIndex(base.id) + 1
    if (r.kind === "image") expect(r.src).toContain(`__v${expected}.webp`)
  })
})

describe("resolveCourseCover · 第 3 层渐变兜底", () => {
  it("槽位不在 44 个合法槽位内时返回渐变色块", () => {
    const r = resolveCourseCover({
      id: "course-2",
      coverUrl: null,
      categoryKey: "practical",
      subCategoryKey: "brand_new_sub_category_not_in_list",
    })
    expect(r.kind).toBe("gradient")
  })

  it("未知分类走默认配色", () => {
    const r = resolveCourseCover({
      id: "c",
      coverUrl: null,
      categoryKey: "nope",
      subCategoryKey: "nope",
    })
    expect(r.theme).toEqual(DEFAULT_THEME)
    expect(r.kind).toBe("gradient")
  })

  it("已知分类在兜底时仍带上该分类的配色", () => {
    const theme = getTheme("exam_prep")
    const r = resolveCourseCover({
      id: "c",
      coverUrl: null,
      categoryKey: "exam_prep",
      subCategoryKey: "not_a_slot",
    })
    expect(r.kind).toBe("gradient")
    expect(r.theme).toEqual(theme)
  })
})

describe("themeVariantIndex · 变体选择必须只由 courseId 决定", () => {
  it("同一个 courseId 永远得到同一个下标", () => {
    const a = themeVariantIndex("abc-123")
    const b = themeVariantIndex("abc-123")
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(COVER_VARIANTS_PER_THEME)
  })

  it("相邻 courseId 不会总落在同一个变体（哈希不能退化成常量）", () => {
    const idx = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(themeVariantIndex))
    expect(idx.size).toBeGreaterThan(1)
  })

  it("分布覆盖全部 4 个变体", () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(themeVariantIndex(`course-${i}`))
    expect(seen.size).toBe(COVER_VARIANTS_PER_THEME)
  })

  it("分布大致均匀（每个变体都不低于 10%）", () => {
    const counts = new Array(COVER_VARIANTS_PER_THEME).fill(0)
    const n = 4000
    for (let i = 0; i < n; i++) counts[themeVariantIndex(`c-${i}`)]++
    for (const c of counts) expect(c / n).toBeGreaterThan(0.1)
  })
})

describe("getCategoryLabel · 卡片上的分类标签", () => {
  it("分类为空时返回「综合」", () => {
    expect(getCategoryLabel(null, null)).toBe("综合")
  })

  it("只有主类时返回主类标签", () => {
    expect(getCategoryLabel("graded_reading", null)).toBe("分级阅读")
  })

  it("主类 + 子类时用「·」连接", () => {
    expect(getCategoryLabel("graded_reading", "raz")).toBe("分级阅读 · RAZ")
  })

  it("未知主类原样返回，不抛错", () => {
    expect(getCategoryLabel("unknown_cat", null)).toBe("unknown_cat")
  })

  it("未知子类退回主类标签", () => {
    expect(getCategoryLabel("graded_reading", "not_a_sub")).toBe("分级阅读")
  })
})
