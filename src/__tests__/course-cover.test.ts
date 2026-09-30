/**
 * 封面解析是三个列表页与课程详情页共用的唯一入口。2026-09-30 起从三层降级
 * 收敛为**两层**：专属图（`cover_url`）→ 分类色卡（按课程着色）。
 *
 * 这里守三件事：
 *   1. `cover_url` 必须优先 —— 否则逐课生成的专属图会被色卡盖掉；
 *   2. 没有 `cover_url` 的课**一律**是色卡，不再回退到「同槽位共用的主题图」——
 *      那正是需求方要求消除的重复来源（最惨时 15 门课共用一张）；
 *   3. 色卡颜色只由 courseId 决定且**每门课都不同** —— 若掺入列表下标，
 *      用户换一次排序方式，同一门课的颜色就会跳变；若只按分类取色，
 *      同一分类下的色卡又会变成几百张同款。
 */
import { describe, it, expect } from "vitest"
import {
  DEFAULT_THEME,
  courseGradient,
  getCategoryLabel,
  getTheme,
  resolveCourseCover,
  themeVariantIndex,
} from "@/lib/course-cover"
import { COVER_VARIANTS_PER_THEME } from "@/lib/course-cover-themes"

const base = { id: "course-1", categoryKey: "practical", subCategoryKey: "movies_stories" }

describe("resolveCourseCover · 第 1 层 专属图优先", () => {
  it("cover_url 非空时直接用", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "/images/courses/custom.webp" })
    expect(r.kind).toBe("image")
    if (r.kind === "image") expect(r.src).toBe("/images/courses/custom.webp")
  })

  it("cover_url 是外部 URL 时也直接用（管理员可能填外链）", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "https://cdn.example.com/a.webp" })
    expect(r.kind).toBe("image")
    if (r.kind === "image") expect(r.src).toBe("https://cdn.example.com/a.webp")
  })

  it("cover_url 只有空白字符时视为空，落到色卡", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "   " })
    expect(r.kind).toBe("gradient")
  })

  it("image 分支也带上 gradient —— 图片加载失败时组件用它兜底", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "/images/courses/custom.webp" })
    expect(r.gradient).toMatch(/^linear-gradient/)
  })
})

describe("resolveCourseCover · 第 2 层 色卡（不再有主题图共用）", () => {
  const slots: [string | null, string | null][] = [
    ["practical", "movies_stories"],
    ["school_sync", "grade_3"],
    ["exam_prep", null],
    [null, null],
  ]

  it("没有 cover_url 的课一律是色卡 —— 不再回退到同槽位共用的主题图", () => {
    for (const [categoryKey, subCategoryKey] of slots) {
      const r = resolveCourseCover({ id: "c-1", coverUrl: null, categoryKey, subCategoryKey })
      expect(r.kind, `${categoryKey}/${subCategoryKey} 竟然解析出了图片`).toBe("gradient")
    }
  })

  it("同一门课每次解析得到同一张色卡（稳定）", () => {
    const args = { id: "stable-id", coverUrl: null, categoryKey: "practical", subCategoryKey: null }
    expect(resolveCourseCover(args).gradient).toBe(resolveCourseCover(args).gradient)
  })

  it("不同课程得到不同颜色的色卡 —— 这是『色卡不重复』的核心", () => {
    const grads = new Set<string>()
    for (let i = 0; i < 200; i++) {
      grads.add(
        resolveCourseCover({
          id: `course-${i}`,
          coverUrl: null,
          categoryKey: "school_sync",
          subCategoryKey: "grade_3",
        }).gradient,
      )
    }
    // 理论上界 = 61 档色相 × 9 档明度；200 个 id 至少应命中数十种
    expect(grads.size).toBeGreaterThan(40)
  })

  it("同分类的色卡仍在同一色系内，且足够暗（浅色文字可读）", () => {
    const theme = getTheme("exam_prep")
    for (let i = 0; i < 50; i++) {
      const g = resolveCourseCover({
        id: `x-${i}`,
        coverUrl: null,
        categoryKey: "exam_prep",
        subCategoryKey: "gre",
      }).gradient
      const hues = [...g.matchAll(/hsl\((\d+)/g)].map((m) => Number(m[1]))
      expect(hues.length).toBeGreaterThan(0)
      for (const h of hues) {
        // 允许 +16° 的第二停靠点，所以上界放到 47
        const diff = Math.min((h - theme.hue + 360) % 360, (theme.hue - h + 360) % 360)
        expect(diff, `色相 ${h} 偏离基准 ${theme.hue} 过远：${g}`).toBeLessThanOrEqual(47)
      }
      const lights = [...g.matchAll(/% (\d+)%/g)].map((m) => Number(m[1]))
      for (const l of lights) expect(l).toBeLessThan(35)
    }
  })
})

describe("courseGradient · 按课程着色", () => {
  it("输出的是合法的 linear-gradient", () => {
    expect(courseGradient("abc", getTheme("practical"))).toMatch(/^linear-gradient\(135deg, hsl\(/)
  })

  it("色相落点始终在 0~360 之间（不会出现负值或超界）", () => {
    for (let i = 0; i < 300; i++) {
      const g = courseGradient(`id-${i}`, getTheme("graded_reading"))
      for (const m of g.matchAll(/hsl\((\d+)/g)) {
        const h = Number(m[1])
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(360)
      }
    }
  })

  it("明度不会被压到 0（否则色卡变纯黑，看不出差异）", () => {
    for (let i = 0; i < 300; i++) {
      const g = courseGradient(`id-${i}`, DEFAULT_THEME)
      for (const m of g.matchAll(/% (\d+)%/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(6)
      }
    }
  })
})

describe("resolveCourseCover · 兜底永不空白", () => {
  it("完全未知的分类也返回色卡，不是空", () => {
    const r = resolveCourseCover({
      id: "c",
      coverUrl: null,
      categoryKey: "nope",
      subCategoryKey: "nope",
    })
    expect(r.kind).toBe("gradient")
    expect(r.theme).toEqual(DEFAULT_THEME)
    expect(r.gradient).toMatch(/^linear-gradient/)
  })

  it("已知分类的色卡带上该分类的强调色（保留分类识别性）", () => {
    const theme = getTheme("exam_prep")
    const r = resolveCourseCover({ id: "c", coverUrl: null, categoryKey: "exam_prep", subCategoryKey: "gre" })
    expect(r.theme).toEqual(theme)
    expect(r.kind).toBe("gradient")
  })
})

describe("themeVariantIndex · 生成/验收工具仍在用（解析器已不用）", () => {
  it("同一个 courseId 永远得到同一个下标", () => {
    const a = themeVariantIndex("abc-123")
    expect(a).toBe(themeVariantIndex("abc-123"))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(COVER_VARIANTS_PER_THEME)
  })

  it("分布覆盖全部变体（不会退化成常量）", () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(themeVariantIndex(`course-${i}`))
    expect(seen.size).toBe(COVER_VARIANTS_PER_THEME)
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
