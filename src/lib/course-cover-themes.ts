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

/** 每个槽位的**目标**变体数量（生成脚本按它决定要出几张） */
export const COVER_VARIANTS_PER_THEME = 4

/**
 * 每个槽位**实际已生成**多少张变体（1~4）。
 *
 * ── 为什么必须有这张表，而不是一律按 4 取模 ──────────────────────────────────
 *
 * 生成是按「广度优先」的顺序跑的：先保证 44 个槽位都有 v1，再按课程数多少补 v2/v3/v4。
 * 于是额度一旦耗尽，各槽位的实际张数就不一样（首次量产被迫停在
 * 18 个槽位 1 张 / 23 个 2 张 / 3 个 4 张，见设计文档的额度记录）。
 *
 * 如果解析器仍然 `hash % 4 + 1`，只有 v1 的槽位里会有 3/4 的课程指向不存在的文件 ——
 * 表现为**同一个槽位的卡片一半有图、一半是色块**，比整批没图更难解释。
 *
 * ── 维护方式 ────────────────────────────────────────────────────────────────
 *
 * 补生成变体后，跑 `npx tsx scripts/gen-course-covers.ts --step=report`，
 * 它会打印一张可直接粘贴到这里的表。
 * `src/__tests__/course-cover-files.test.ts` 会断言这张表与磁盘上的文件**完全一致** ——
 * 所以忘了更新不会静默生效，测试会直接变红。
 */
export const COVER_VARIANT_COUNTS: Readonly<Record<string, number>> = {
  practical__movies_stories: 4,
  practical__classic_textbooks: 4,
  /**
   * 只有 1 张，且这张是从原 v4 提升上来的。
   *
   * 原因：首版提示词里写了十六进制色值 `#1e293b` / `#e2603f`，模型把色值当画面内容，
   * 在这个槽位的索引卡片上渲染出「#1e2983b」「#1e6033b」这类乱码字符串，**在 220px
   * 卡片尺寸下清晰可读**（见 .covers-build/review/suspects-cardsize.jpg）。
   * 原 v4 恰好是唯一没有文字的（卡片全空白），所以把它提升为 v1 先顶上，
   * 同时删掉 v2~v4，让额度恢复后用已修正的提示词重新生成。
   */
  practical__grammar_vocab: 1,
  practical__listening_speaking: 2,
  exam_prep__ielts_toefl: 2,
  practical__daily_oral: 2,
  practical__general: 2,
  none__general: 2,
  exam_prep__cet_4_6: 2,
  practical__business_career: 2,
  exam_prep__pte: 2,
  exam_prep__gaokao: 2,
  exam_prep__zhuan_sheng_ben: 2,
  exam_prep__zhongkao: 2,
  exam_prep__postgraduate: 2,
  practical__travel_english: 2,
  exam_prep__degree_english: 1,
  exam_prep__tem_4_8: 1,
  exam_prep__pet: 1,
  exam_prep__gre: 1,
  exam_prep__toeic: 1,
  exam_prep__ket: 1,
  exam_prep__fce: 1,
  exam_prep__general: 1,
  school_sync__grade_4: 2,
  school_sync__grade_3: 2,
  school_sync__grade_8: 2,
  school_sync__grade_1: 2,
  school_sync__grade_7: 2,
  school_sync__grade_5: 2,
  school_sync__grade_6: 2,
  school_sync__general: 2,
  school_sync__high_school: 2,
  school_sync__grade_9: 2,
  school_sync__grade_2: 1,
  graded_reading__oxford_reading_tree: 1,
  graded_reading__lets_go: 1,
  graded_reading__raz: 1,
  graded_reading__heinemann: 1,
  school_sync__vocational: 1,
  graded_reading__big_cat: 1,
  graded_reading__oxford_bookworm: 1,
  graded_reading__red_rocket: 1,
  graded_reading__general: 1,
}

/**
 * 某个槽位可用于轮换的变体数。
 * 缺省为 1 而不是 4 —— 缺省值必须是「保证存在的那一张」，
 * 否则新增槽位但忘了补图时，课程会指向不存在的文件。
 */
export function availableVariants(slug: string): number {
  const n = COVER_VARIANT_COUNTS[slug]
  return typeof n === "number" && n > 0 ? n : 1
}

/**
 * 每个大类里「通用」槽位的 slug，用于变体不足时借图。
 *
 * ── 为什么需要这个 ──────────────────────────────────────────────────────────
 *
 * 首次量产额度在半途耗尽，19 个槽位只剩 1 张变体。课程数多的槽位（如
 * `school_sync__grade_3` 有 26 门课）在列表里会出现**同一张图反复出现** ——
 * 默认「最新发布」排序下同年级课程扎堆，一眼就能看出是同一张。
 *
 * 补齐变体是正解，但需要额度。在补上之前，从同大类的通用槽位借几张来扩充轮换池，
 * 能把「同一张图连续出现 5 次」变成「3 张图交替出现」。
 *
 * 代价要说清楚：借来的图在主题上只是**同类**、不是**同槽位**的。
 * 例如三年级课程可能显示「校园跑道」而不是「公交站台」。判断是：
 * 「同大类里略显通用」比「同一张图刷屏」更像正常产品。
 *
 * **补齐变体后应当删掉这个机制** —— 那时每个槽位都够用，借图只会降低主题贴合度。
 */
export const CATEGORY_GENERAL_SLUG: Readonly<Record<string, string>> = {
  graded_reading: "graded_reading__general",
  school_sync: "school_sync__general",
  exam_prep: "exam_prep__general",
  practical: "practical__general",
  none: "none__general",
}

/**
 * 某个槽位的**完整轮换池**（文件路径相对 `/images/courses/`）。
 *
 * - 变体 ≥2 张：只用自己槽位的，主题最贴合；
 * - 只有 1 张：自己的 v1 打头，再并入同大类通用槽位的变体。
 *
 * 池子里每一项都保证文件存在（由 `course-cover-files.test.ts` 断言），
 * 所以解析出来的路径不会是死链。
 */
export function coverPool(slug: string): string[] {
  const own = Array.from(
    { length: availableVariants(slug) },
    (_, i) => `${slug}__v${i + 1}.webp`,
  )
  if (own.length >= 2) return own

  const category = slug.split("__")[0]
  const general = CATEGORY_GENERAL_SLUG[category]
  if (!general || general === slug) return own

  const borrowed = Array.from(
    { length: availableVariants(general) },
    (_, i) => `${general}__v${i + 1}.webp`,
  )
  return [...own, ...borrowed]
}
