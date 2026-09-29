/**
 * 槽位清单是生成脚本与运行时解析器共同依赖的契约，所以这里守五件事：
 *   1. 恰好 44 个槽位（生产库实测），少了会让一批课落到渐变兜底；
 *   2. slug 唯一 —— 重复会导致两个槽位共用同一张图，且生成脚本会互相覆盖；
 *   3. 两个维度都为 null 时退化为 none__general（生产库有 28 门这样的课）；
 *   4. 只有子类为 null 时退化为 <category>__general；
 *   5. 变体数量为 4 —— 这个数字被 course-cover.ts 的哈希取模依赖，
 *      改了它必须同时改已生成的图片文件名，否则封面会 404。
 */
import { describe, it, expect } from "vitest"
import {
  COVER_THEME_SLOTS,
  COVER_THEME_SLUGS,
  COVER_VARIANT_COUNTS,
  COVER_VARIANTS_PER_THEME,
  themeSlug,
} from "@/lib/course-cover-themes"

describe("COVER_THEME_SLOTS · 与生产库一致的 44 个槽位", () => {
  it("恰好 44 个槽位", () => {
    expect(COVER_THEME_SLOTS).toHaveLength(44)
  })

  it("slug 全部唯一", () => {
    const slugs = COVER_THEME_SLOTS.map((s) => themeSlug(s.categoryKey, s.subCategoryKey))
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(COVER_THEME_SLUGS.size).toBe(44)
  })

  it("每个槽位都真的存在于 slug 集合里", () => {
    for (const s of COVER_THEME_SLOTS) {
      expect(COVER_THEME_SLUGS.has(themeSlug(s.categoryKey, s.subCategoryKey))).toBe(true)
    }
  })

  it("两个维度都为 null 时退化为 none__general", () => {
    expect(themeSlug(null, null)).toBe("none__general")
    expect(COVER_THEME_SLUGS.has("none__general")).toBe(true)
  })

  it("只有子类为 null 时退化为 <category>__general", () => {
    expect(themeSlug("practical", null)).toBe("practical__general")
    expect(COVER_THEME_SLUGS.has("practical__general")).toBe(true)
    expect(themeSlug("school_sync", null)).toBe("school_sync__general")
    expect(COVER_THEME_SLUGS.has("school_sync__general")).toBe(true)
    expect(themeSlug("exam_prep", null)).toBe("exam_prep__general")
    expect(COVER_THEME_SLUGS.has("exam_prep__general")).toBe(true)
  })

  /**
   * 第二版量产把变体数从 4 改为 3：需求方反馈封面「太雷同」，改为让每个槽位的三张图
   * 分别用扁平 / 水彩 / 3D 卡通三种风格 + 三个不同场景。这个数字必须与
   * 生成脚本里每个槽位的场景条目数、以及磁盘上的文件数三方一致。
   */
  it("变体数量为 3", () => {
    expect(COVER_VARIANTS_PER_THEME).toBe(3)
  })

  it("每个槽位声明的变体数都不超过目标变体数", () => {
    for (const [slug, n] of Object.entries(COVER_VARIANT_COUNTS)) {
      expect(n, `${slug} 声明的变体数超过目标`).toBeLessThanOrEqual(COVER_VARIANTS_PER_THEME)
      expect(n, `${slug} 声明的变体数至少为 1`).toBeGreaterThanOrEqual(1)
    }
  })

  it("分类分布与设计文档一致：扁平 24 个、水彩 20 个", () => {
    const water = COVER_THEME_SLOTS.filter(
      (s) => s.categoryKey === "graded_reading" || s.categoryKey === "school_sync",
    )
    expect(water).toHaveLength(20)
    expect(COVER_THEME_SLOTS.length - water.length).toBe(24)
  })
})
