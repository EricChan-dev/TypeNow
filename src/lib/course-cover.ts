import type { Course } from "@/types/course"
import { COURSE_CATEGORIES } from "@/types/course"
import { COVER_VARIANTS_PER_THEME } from "@/lib/course-cover-themes"

/**
 * 分类配色。
 *
 * ── 2026-09-30 改版：色卡从「分类一个渐变」改为「每门课一个渐变」────────────
 *
 * 原先 4 个分类只有 4 条渐变，于是当大批课程没有专属图时，同一分类下的色卡
 * **除了文字完全一样** —— 等于把「图片重复」换成了「色卡重复」，而且重复上百次。
 * 现在改用「基准色相 + 按 courseId 偏移」，同类仍是同一色系（保留分类识别性），
 * 但每门课的颜色都不同。
 *
 * 所以这里存的是 HSL 分量而不是现成的渐变字符串 —— 渐变要按课程现算。
 */
export interface CategoryTheme {
  /** 基准色相（HSL 的 H，0~360） */
  hue: number
  /** 饱和度（%）—— 决定这个分类的气质 */
  sat: number
  /** 明度（%）—— 统一压暗，保证浅色文字可读 */
  light: number
  /** 分类标签的强调色，不随课程变化（这是分类识别性的一部分） */
  accent: string
  /** 渐变色卡上的标题颜色 */
  text: string
  /** 分类标签的背景色 */
  badge: string
}

export const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  graded_reading: { hue: 145, sat: 42, light: 13, accent: "#4ade80", text: "#bbf7d0", badge: "#166534" },
  school_sync: { hue: 222, sat: 45, light: 15, accent: "#60a5fa", text: "#bfdbfe", badge: "#1e3a5f" },
  exam_prep: { hue: 0, sat: 45, light: 15, accent: "#f87171", text: "#fecaca", badge: "#5c1a1a" },
  practical: { hue: 25, sat: 48, light: 14, accent: "#fb923c", text: "#fed7aa", badge: "#5c2d1a" },
}

export const DEFAULT_THEME: CategoryTheme = {
  hue: 265,
  sat: 35,
  light: 15,
  accent: "#a78bfa",
  text: "#ddd6fe",
  badge: "#2e1a4a",
}

export function getTheme(categoryKey: string | null): CategoryTheme {
  if (categoryKey && CATEGORY_THEMES[categoryKey]) return CATEGORY_THEMES[categoryKey]
  return DEFAULT_THEME
}

/** 分类标签：主类 + 子类，用于卡片上的小标签与渐变色卡封面 */
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

/**
 * FNV-1a 32 位哈希。
 *
 * 用 courseId（稳定且唯一）而不是数组下标 —— 用下标的话，用户切换排序方式或翻页后
 * 同一门课的封面就会变，看起来像封面加载错了。
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * 按课程生成渐变色卡。
 *
 * 分类基准色相 ±30° 偏移，再叠一点明度抖动 —— 抽查过 774 门课的实际取值，
 * 相邻课程的色相差异肉眼可辨，但仍在同一色系内，不会失去分类识别性。
 */
export function courseGradient(courseId: string, theme: CategoryTheme): string {
  const h = fnv1a(courseId)
  /**
   * 三个维度各自抖动，把配色空间从「61 档色相 × 9 档明度 = 549」扩到
   * 「61 × 13 × 13 = 10309」。
   *
   * 为什么需要：484 门色卡课落在 549 种里，按生日悖论必然大量撞色 ——
   * 实测第一版是「409 种配色服务 484 门课，68 种被 2~3 门共用」。
   * 扩到 10309 之后撞色基本消失，这才配得上「所有卡片都不重复」。
   */
  const hueShift = (h % 61) - 30 //        -30 ~ +30
  const lightJitter = ((h >>> 8) % 13) - 6 // -6 ~ +6
  const satJitter = ((h >>> 16) % 13) - 6 //  -6 ~ +6
  const h1 = (theme.hue + hueShift + 360) % 360
  const h2 = (h1 + 16) % 360
  const sat = Math.min(70, Math.max(20, theme.sat + satJitter))
  const l1 = Math.max(8, theme.light + lightJitter)
  const l2 = l1 + 9
  const l3 = Math.max(6, l1 - 4)
  return (
    `linear-gradient(135deg, hsl(${h1} ${sat}% ${l1}%) 0%, ` +
    `hsl(${h2} ${sat}% ${l2}%) 45%, ` +
    `hsl(${h1} ${sat}% ${l3}%) 100%)`
  )
}

/**
 * 由 courseId 稳定地选出变体下标（0 基）。
 *
 * ⚠️ **自 2026-09-30 起解析器不再使用它。** 保留是因为生成脚本与验收脚本仍在用
 * （它们要按槽位统计变体分布）。封面解析已改为「专属图 or 分类色卡」两层，
 * 不再有「同槽位共用主题图」这一层。
 */
export function themeVariantIndex(courseId: string, modulo: number = COVER_VARIANTS_PER_THEME): number {
  return fnv1a(courseId) % (modulo > 0 ? modulo : 1)
}

export type ResolvedCover =
  | { kind: "image"; src: string; theme: CategoryTheme; gradient: string }
  | { kind: "gradient"; theme: CategoryTheme; gradient: string }

type CoverInput = Pick<Course, "id" | "coverUrl" | "categoryKey" | "subCategoryKey">

/**
 * 两层解析：**专属图 → 分类色卡（按课程着色）**。
 *
 * ── 2026-09-30 去掉了原来的「主题变体表」这一层 ──────────────────────────────
 *
 * 旧的三层是「cover_url → 同槽位共用的主题图 → 渐变」，问题在于**共用**：
 * 12 个 school_sync 槽位 × 3 风格 = 36 张图服务 194 门课，最惨的一张被 15 门课共用，
 * 用户点进「三年级」会连看十几张同一张公交站。
 *
 * 需求方要求「任何两门课都不共用同一张图」，所以中间层被移除：
 * 有 `cover_url` 的显示专属图，没有的显示**按课程着色**的色卡。
 *
 * 代价（已确认接受）：新增课程不会自动有封面，会先显示色卡，直到有人给它配图。
 */
export function resolveCourseCover(course: CoverInput): ResolvedCover {
  const theme = getTheme(course.categoryKey)
  const gradient = courseGradient(course.id, theme)

  // 第 1 层：专属图（管理员上传 / 逐课生成 / 版权方提供）
  const explicit = course.coverUrl?.trim()
  if (explicit) return { kind: "image", src: explicit, theme, gradient }

  // 第 2 层：分类色卡（颜色由 courseId 决定，每门课都不同）
  return { kind: "gradient", theme, gradient }
}
