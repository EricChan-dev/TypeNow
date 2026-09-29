import type { Course } from "@/types/course"
import { COURSE_CATEGORIES } from "@/types/course"
import {
  COVER_THEME_SLUGS,
  COVER_VARIANTS_PER_THEME,
  themeSlug,
} from "@/lib/course-cover-themes"

export interface CategoryTheme {
  bg: string
  accent: string
  text: string
  badge: string
}

/**
 * 分类配色。原先在 `CourseCard.tsx` 与 `CourseDetailClient.tsx` 里各复制了一份
 * （各约 40 行），改一处漏一处是迟早的事 —— 现在只留这一份。
 *
 * 只在「主题图缺失」或「课程还没落到任何槽位」时才会用到。
 */
export const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  graded_reading: {
    bg: "linear-gradient(135deg, #0f2b1a 0%, #1a3d28 40%, #0d2216 100%)",
    accent: "#4ade80",
    text: "#bbf7d0",
    badge: "#166534",
  },
  school_sync: {
    bg: "linear-gradient(135deg, #0f1a3a 0%, #1a2d5a 40%, #0d1430 100%)",
    accent: "#60a5fa",
    text: "#bfdbfe",
    badge: "#1e3a5f",
  },
  exam_prep: {
    bg: "linear-gradient(135deg, #3a1010 0%, #5c1818 40%, #2d0d0d 100%)",
    accent: "#f87171",
    text: "#fecaca",
    badge: "#5c1a1a",
  },
  practical: {
    bg: "linear-gradient(135deg, #2d1a0f 0%, #4a2a1a 40%, #221006 100%)",
    accent: "#fb923c",
    text: "#fed7aa",
    badge: "#5c2d1a",
  },
}

export const DEFAULT_THEME: CategoryTheme = {
  bg: "linear-gradient(135deg, #1a1a2e 0%, #2a2a44 40%, #12121f 100%)",
  accent: "#a78bfa",
  text: "#ddd6fe",
  badge: "#2e1a4a",
}

export function getTheme(categoryKey: string | null): CategoryTheme {
  if (categoryKey && CATEGORY_THEMES[categoryKey]) return CATEGORY_THEMES[categoryKey]
  return DEFAULT_THEME
}

/** 分类标签：主类 + 子类，用于卡片上的小标签与渐变兜底封面 */
export function getCategoryLabel(
  categoryKey: string | null,
  subCategoryKey: string | null,
): string {
  if (!categoryKey) return "综合"
  const main = COURSE_CATEGORIES.find((c) => c.key === categoryKey)
  if (!main) return categoryKey
  if (!subCategoryKey) return main.label
  const sub = main.subCategories.find((s) => s.key === subCategoryKey)
  return sub ? `${main.label} · ${sub.label}` : main.label
}

const COVER_BASE_PATH = "/images/courses"

/**
 * 由 courseId 稳定地选出变体下标。
 *
 * **必须用 courseId（稳定且唯一），不能用数组下标。** 用下标的话，用户切换排序方式
 * 或翻页后同一门课的封面就会变，看起来像封面加载错了。用 FNV-1a：实现只有几行、
 * 零依赖、分布足够均匀（单测里对 4000 个 id 断言过每个变体都不低于 10%）。
 */
export function themeVariantIndex(courseId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < courseId.length; i++) {
    h ^= courseId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % COVER_VARIANTS_PER_THEME
}

export type ResolvedCover =
  | { kind: "image"; src: string; theme: CategoryTheme }
  | { kind: "gradient"; theme: CategoryTheme }

type CoverInput = Pick<Course, "id" | "coverUrl" | "categoryKey" | "subCategoryKey">

/**
 * 三层降级：`cover_url`（覆盖项）→ 主题变体表 → 分类渐变。
 *
 * 第 2 层命中与否由 `COVER_THEME_SLUGS` 判断，**不是**「能拼出路径就算命中」——
 * 后者会让一个未生成的槽位拼出不存在的路径，表现为图片 404 而页面不报错。
 * 这也意味着：删掉 `public/images/courses/` 里的图不会白屏，只会让所有课退回渐变色块。
 */
export function resolveCourseCover(course: CoverInput): ResolvedCover {
  const theme = getTheme(course.categoryKey)

  // 第 1 层：管理员上传 / 主推课专属图 / 版权方提供的图
  const explicit = course.coverUrl?.trim()
  if (explicit) return { kind: "image", src: explicit, theme }

  // 第 2 层：主题变体表
  const slug = themeSlug(course.categoryKey, course.subCategoryKey)
  if (COVER_THEME_SLUGS.has(slug)) {
    const variant = themeVariantIndex(course.id) + 1
    return { kind: "image", src: `${COVER_BASE_PATH}/${slug}__v${variant}.webp`, theme }
  }

  // 第 3 层：渐变兜底（永不出现空白封面）
  return { kind: "gradient", theme }
}
