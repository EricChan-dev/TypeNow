/**
 * 封面主题槽位清单 —— 生成脚本与运行时解析器的**唯一事实来源**。
 *
 * 刻意不 import 任何东西：`scripts/gen-course-covers.ts` 由 tsx 执行，走的是相对路径
 * 解析，而 `@/` 这类路径别名在 tsx 下不保证可用。这个模块被两边同时引用，
 * 所以它必须零依赖。
 *
 * 另外它会被客户端组件间接引入（CourseCard → course-cover → 这里），
 * 所以**不要往这个文件里放场景描述等生成期才需要的大段文本**，那会白白进前端包。
 *
 * 清单来自生产库实测（设计文档 4.3）：
 *   SELECT category_key, sub_category_key, COUNT(*) FROM courses
 *   WHERE is_published = 1 GROUP BY 1, 2
 * 共 44 个槽位，覆盖全部 774 门在架课程。
 */
export interface CoverThemeSlot {
  categoryKey: string | null
  subCategoryKey: string | null
}

export const COVER_THEME_SLOTS: readonly CoverThemeSlot[] = [
  // ── 扁平 · 24 个槽位 / 531 门（应试与职场向）────────────────────────────
  { categoryKey: "practical", subCategoryKey: "movies_stories" },
  { categoryKey: "practical", subCategoryKey: "classic_textbooks" },
  { categoryKey: "practical", subCategoryKey: "grammar_vocab" },
  { categoryKey: "practical", subCategoryKey: "listening_speaking" },
  { categoryKey: "exam_prep", subCategoryKey: "ielts_toefl" },
  { categoryKey: "practical", subCategoryKey: "daily_oral" },
  { categoryKey: "practical", subCategoryKey: null },
  { categoryKey: null, subCategoryKey: null },
  { categoryKey: "exam_prep", subCategoryKey: "cet_4_6" },
  { categoryKey: "practical", subCategoryKey: "business_career" },
  { categoryKey: "exam_prep", subCategoryKey: "pte" },
  { categoryKey: "exam_prep", subCategoryKey: "gaokao" },
  { categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben" },
  { categoryKey: "exam_prep", subCategoryKey: "zhongkao" },
  { categoryKey: "exam_prep", subCategoryKey: "postgraduate" },
  { categoryKey: "practical", subCategoryKey: "travel_english" },
  { categoryKey: "exam_prep", subCategoryKey: "degree_english" },
  { categoryKey: "exam_prep", subCategoryKey: "tem_4_8" },
  { categoryKey: "exam_prep", subCategoryKey: "pet" },
  { categoryKey: "exam_prep", subCategoryKey: "gre" },
  { categoryKey: "exam_prep", subCategoryKey: "toeic" },
  { categoryKey: "exam_prep", subCategoryKey: "ket" },
  { categoryKey: "exam_prep", subCategoryKey: "fce" },
  { categoryKey: "exam_prep", subCategoryKey: null },

  // ── 水彩 · 20 个槽位 / 243 门（儿童与校园向）────────────────────────────
  { categoryKey: "school_sync", subCategoryKey: "grade_4" },
  { categoryKey: "school_sync", subCategoryKey: "grade_3" },
  { categoryKey: "school_sync", subCategoryKey: "grade_8" },
  { categoryKey: "school_sync", subCategoryKey: "grade_1" },
  { categoryKey: "school_sync", subCategoryKey: "grade_7" },
  { categoryKey: "school_sync", subCategoryKey: "grade_5" },
  { categoryKey: "school_sync", subCategoryKey: "grade_6" },
  { categoryKey: "school_sync", subCategoryKey: null },
  { categoryKey: "school_sync", subCategoryKey: "high_school" },
  { categoryKey: "school_sync", subCategoryKey: "grade_9" },
  { categoryKey: "school_sync", subCategoryKey: "grade_2" },
  { categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree" },
  { categoryKey: "graded_reading", subCategoryKey: "lets_go" },
  { categoryKey: "graded_reading", subCategoryKey: "raz" },
  { categoryKey: "graded_reading", subCategoryKey: "heinemann" },
  { categoryKey: "school_sync", subCategoryKey: "vocational" },
  { categoryKey: "graded_reading", subCategoryKey: "big_cat" },
  { categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm" },
  { categoryKey: "graded_reading", subCategoryKey: "red_rocket" },
  { categoryKey: "graded_reading", subCategoryKey: null },
]

/**
 * 槽位标识。**生成脚本的文件名与运行时的查找路径必须由同一个函数产生** ——
 * 这是唯一能保证「生成的图」与「解析的路径」不会错位的手段。
 */
export function themeSlug(
  categoryKey: string | null,
  subCategoryKey: string | null,
): string {
  return `${categoryKey ?? "none"}__${subCategoryKey ?? "general"}`
}

/** 全部合法 slug。运行时用它判断第 2 层是否命中，未命中才落到渐变兜底 */
export const COVER_THEME_SLUGS: ReadonlySet<string> = new Set(
  COVER_THEME_SLOTS.map((s) => themeSlug(s.categoryKey, s.subCategoryKey)),
)

/** 每个主题的构图变体数量，必须与生成脚本里 COMPOSITIONS 的长度、以及实际文件名一致 */
export const COVER_VARIANTS_PER_THEME = 4
