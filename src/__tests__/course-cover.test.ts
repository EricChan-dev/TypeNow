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
import {
  COVER_VARIANT_COUNTS,
  COVER_VARIANTS_PER_THEME,
  availableVariants,
  coverPool,
} from "@/lib/course-cover-themes"
import fs from "node:fs"
import path from "node:path"

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
    const expected = themeVariantIndex(base.id, availableVariants("practical__movies_stories")) + 1
    if (r.kind === "image") expect(r.src).toContain(`__v${expected}.webp`)
  })

  /**
   * 额度耗尽导致各槽位实际变体数不同（19 个只有 v1、23 个有 v2、2 个有 v4）。
   * 若解析器一律按 4 取模，只有 v1 的槽位里会有 3/4 的课程指向不存在的文件 ——
   * 表现为同一个槽位的卡片一半有图、一半是色块。这条测试守住那个回归。
   */
  it("变体 ≥2 的槽位：解析结果只落在自己槽位已声明的变体里", () => {
    const multi = Object.entries(COVER_VARIANT_COUNTS).filter(([, n]) => n >= 2)
    expect(multi.length).toBeGreaterThan(0)
    for (const [slug, count] of multi) {
      const [cat, sub] = slug.split("__")
      for (let i = 0; i < 30; i++) {
        const r = resolveCourseCover({
          id: `c-${i}`,
          coverUrl: null,
          categoryKey: cat === "none" ? null : cat,
          subCategoryKey: sub === "general" ? null : sub,
        })
        expect(r.kind).toBe("image")
        if (r.kind !== "image") continue
        const m = r.src.match(new RegExp(`/${slug}__v(\\d+)\\.webp$`))
        expect(m, `${slug} 解析出了别的槽位的图：${r.src}`).toBeTruthy()
        expect(Number(m![1])).toBeLessThanOrEqual(count)
        expect(Number(m![1])).toBeGreaterThanOrEqual(1)
      }
    }
  })

  /**
   * 变体不足时会并入同大类通用槽位的图扩池（见 CATEGORY_GENERAL_SLUG）。
   *
   * 第二次量产后每个槽位都有 3 张，借图机制**不再触发** —— 所以这里断言的是
   * 「没有多余借用」；同时保留「若出现单变体槽位则池子必须变大」这条断言，
   * 因为将来额度不足导致批量被截断时，它仍要能守住那个场景。
   */
  it("变体充足时轮换池是自洽的：只用自己槽位的图", () => {
    const multi = Object.entries(COVER_VARIANT_COUNTS).filter(([, n]) => n >= 2)
    expect(multi.length).toBeGreaterThan(0)
    for (const [slug, count] of multi) {
      const pool = coverPool(slug)
      expect(pool, `${slug} 的池子应恰好是自己声明的 ${count} 张`).toHaveLength(count)
      for (const item of pool) expect(item.startsWith(`${slug}__v`)).toBe(true)
    }
  })

  it("单变体槽位（若存在）的轮换池必须大于 1", () => {
    const singles = Object.entries(COVER_VARIANT_COUNTS).filter(([, n]) => n === 1)
    for (const [slug] of singles) {
      expect(coverPool(slug).length, `${slug} 只有 1 张且没有借到图`).toBeGreaterThan(1)
    }
    // 当前数据下不存在单变体槽位；将来批量被截断时这条会重新变得有意义
    expect(singles.length).toBeGreaterThanOrEqual(0)
  })

  it("轮换池里的每一项都对应到实际存在的文件", () => {
    for (const [slug] of Object.entries(COVER_VARIANT_COUNTS)) {
      for (const item of coverPool(slug)) {
        const full = path.join(process.cwd(), "public", "images", "courses", item)
        expect(fs.existsSync(full), `池中文件不存在：${item}`).toBe(true)
      }
    }
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
