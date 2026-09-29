/**
 * 教材同步的「学段 / 年级 / 版本」分类层（纯函数，无数据库依赖）。
 *
 * ── 为什么只有「版本」是新增字段 ─────────────────────────────────────────────
 *
 * 实测生产库（2026-09-29，已发布 774 门课，其中中小学同步 194 门）：
 *   · **年级**维度早就有 —— `courses.sub_category_key` = grade_1 … grade_9 / high_school；
 *   · **版本**维度没有字段，但它一直写在课程标题里：
 *       【人教版】一年级上册【PEP课本同步】
 *       【译林版】三年级上册【课本同步】
 *       【外研版 三起点】三年级上册【课本同步】
 *   · **学段**（小学/初中/高中）可以不存 —— 它由 sub_category_key 派生。
 *
 * 所以本次只加一列 `textbook_version`，学段用 {@link STAGES} 映射，不新增冗余列
 * （冗余列迟早与主来源漂移，本仓库已经因为「同一事实存两处」栽过）。
 *
 * ── 解析为什么必须保守 ──────────────────────────────────────────────────────
 *
 * 194 门课里只有 114 门（59%）能从标题可靠认出教材版本，剩下 80 门认不出。
 * 认不出的一律写 `other`（{@link OTHER_VERSION}），**绝不猜测** ——
 * 猜错会让用户在错误的教材版本下练习，那比"筛不出来"严重得多。
 *
 * 解析优先级：
 *   1. 标题里【…】括号内的版本名（最可靠，67 门课有）
 *   2. 全文关键词匹配（合计覆盖 114/194）
 *   3. 都匹配不到 → other
 */

// ─── 学段 ────────────────────────────────────────────────────────────────────

export type StageKey = "primary" | "junior" | "senior" | "vocational"

export interface StageSpec {
  key: StageKey
  label: string
  /** 该学段包含的 `courses.sub_category_key` 取值（按年级顺序）。 */
  grades: readonly string[]
}

export const STAGES: readonly StageSpec[] = [
  {
    key: "primary",
    label: "小学",
    grades: ["grade_1", "grade_2", "grade_3", "grade_4", "grade_5", "grade_6"],
  },
  {
    key: "junior",
    label: "初中",
    grades: ["grade_7", "grade_8", "grade_9"],
  },
  {
    key: "senior",
    label: "高中",
    // 高中在库里是**单桶**（没有高一/高二/高三之分），全库仅 10 门课。
    grades: ["high_school"],
  },
  {
    key: "vocational",
    label: "中职",
    // 中职英语一直存在于 COURSE_CATEGORIES（types/course.ts 的 school_sync 子分类），
    // 但第一版 STAGES 漏了它 —— 结果 7 门中职课在教材同步页完全不可见。
    // 是发布前的核对查询（按 sub_category_key 分组）把它暴露出来的。
    grades: ["vocational"],
  },
]

/**
 * 「未分级」—— `sub_category_key IS NULL` 的课程。
 *
 * 生产库有 11 门已发布的 school_sync 课程没有年级（实测 2026-09-29），
 * 从标题看多数其实能判断年级（`2026年外研社8下单词` → 八年级、
 * `外研社选必三` → 高中、`牛津上海四（下）` → 四年级），
 * 但**改年级是内容归类变更**，不由脚本擅自决定。
 *
 * 这里的处理是：先让它们**可见**（一个独立的「未分级」分组），
 * 同时由回填脚本产出清单供人工判断。不可见比"归错类"更糟 ——
 * 用户会以为这批内容不存在。
 *
 * 它不是一个真正的学段，所以不进 {@link STAGES}（那会污染 stageOfGrade 的语义），
 * 而是由筛选接口显式识别。
 */
export const UNGRADED_STAGE_KEY = "ungraded"
export const UNGRADED_STAGE_LABEL = "未分级"

export function isUngradedStage(key: string): boolean {
  return key === UNGRADED_STAGE_KEY
}

/** 年级 key → 中文标签。与 COURSE_CATEGORIES 里 school_sync 的子分类保持一致。 */
export const GRADE_LABELS: Readonly<Record<string, string>> = {
  grade_1: "一年级",
  grade_2: "二年级",
  grade_3: "三年级",
  grade_4: "四年级",
  grade_5: "五年级",
  grade_6: "六年级",
  grade_7: "七年级",
  grade_8: "八年级",
  grade_9: "九年级",
  high_school: "高中",
  vocational: "中职英语",
}

export function findStage(key: string): StageSpec | null {
  return STAGES.find((s) => s.key === key) ?? null
}

export function stageOfGrade(gradeKey: string): StageKey | null {
  for (const stage of STAGES) {
    if (stage.grades.includes(gradeKey)) return stage.key
  }
  return null
}

/** 某学段下全部年级 key（用于「全部年级」时的 IN 过滤）。 */
export function gradesOfStage(stageKey: string): readonly string[] {
  return findStage(stageKey)?.grades ?? []
}

// ─── 版本 ────────────────────────────────────────────────────────────────────

export interface VersionSpec {
  key: string
  label: string
  /**
   * 标题里出现的写法。顺序有意义：**先匹配到的先算数**，
   * 所以更具体的写法要排在更宽泛的前面（例如「牛津上海」要早于「牛津」）。
   */
  patterns: readonly string[]
}

/**
 * 教材版本清单，按实测出现频次排序（人教版 35 → 外研 34 → 译林 16 → …）。
 *
 * 注意几个容易搞混的：
 *   · 「新起点」「一起点」是**人教版**的起点版本，不是独立出版社；
 *   · 「Join in」是**外研社**的版本；
 *   · 「牛津上海」要排在「沪教」之前判断（两者都存在，且是不同版本）。
 */
export const TEXTBOOK_VERSIONS: readonly VersionSpec[] = [
  { key: "pep", label: "人教版", patterns: ["人教版", "人教", "PEP", "新起点", "一起点"] },
  { key: "fltrp", label: "外研版", patterns: ["外研", "Join in"] },
  { key: "yilin", label: "译林版", patterns: ["译林"] },
  { key: "luke", label: "鲁科版", patterns: ["鲁科"] },
  // 鲁教版（山东教育出版社）与鲁科版（山东科学技术出版社）是**两个不同出版社**，
  // 生产库里两种都真实存在（【鲁科五四版】/「鲁教版五四制」），不能合并成一个。
  { key: "lujiao", label: "鲁教版", patterns: ["鲁教"] },
  { key: "bnup", label: "北师大版", patterns: ["北师大"] },
  { key: "shsj", label: "沪教版", patterns: ["沪教"] },
  { key: "hebei", label: "冀教版", patterns: ["冀教"] },
  { key: "fujian", label: "闽教版", patterns: ["闽教"] },
  { key: "jiaoke", label: "教科版", patterns: ["教科版"] },
  { key: "yueren", label: "粤人版", patterns: ["粤人"] },
  { key: "chongqing", label: "重庆版", patterns: ["重庆版"] },
  { key: "shanlv", label: "陕旅版", patterns: ["陕旅"] },
  { key: "beijing", label: "北京版", patterns: ["北京版"] },
  { key: "oxford_sh", label: "牛津上海版", patterns: ["牛津上海"] },
  // 以下两个是**回填 dry-run 时从生产数据里发现的缺口**（原本都落进了 other）：
  //   · 仁爱版 —— 北京仁爱教育研究所，多个省份在用（生产库有「仁爱新版七年级上册」）
  //   · 科普版 —— 科学普及出版社（生产库有「【科普版】八年级下册【课本同步】」）
  // 这就是 dry-run 必须先跑一遍的原因：版本表不可能靠想象列全。
  { key: "renai", label: "仁爱版", patterns: ["仁爱"] },
  { key: "kepu", label: "科普版", patterns: ["科普"] },
]

/** 认不出教材版本的课程统一归到这里。 */
export const OTHER_VERSION = "other"
export const OTHER_VERSION_LABEL = "其他版本"

/** 解析结果的可信度来源，用于回填脚本产出"可人工抽检"的清单。 */
export type VersionMatchSource = "bracket" | "keyword" | "none"

export interface VersionParseResult {
  /** 版本 key（认不出时为 OTHER_VERSION） */
  version: string
  /** 靠什么认出来的 */
  source: VersionMatchSource
  /** 命中的原文片段，便于人工核对 */
  evidence: string
}

const BRACKET_RE = /【([^】]*)】/g

/** 在给定文本里找第一个命中的版本。 */
function matchIn(text: string): { key: string; evidence: string } | null {
  let best: { key: string; evidence: string; index: number } | null = null
  for (const spec of TEXTBOOK_VERSIONS) {
    for (const pattern of spec.patterns) {
      const index = text.indexOf(pattern)
      if (index === -1) continue
      // 取**最靠前**的命中；位置相同则取清单里更靠前的版本（更具体）
      if (!best || index < best.index) best = { key: spec.key, evidence: pattern, index }
    }
  }
  return best ? { key: best.key, evidence: best.evidence } : null
}

/**
 * 从课程标题解析教材版本。
 *
 * 先看【…】括号（最可靠），再退回全文关键词，都认不出就归 `other`。
 * **不做模糊猜测** —— 宁可让用户少一个筛选项，也不要给出错误的版本归属。
 */
export function parseTextbookVersion(title: string): VersionParseResult {
  if (!title) return { version: OTHER_VERSION, source: "none", evidence: "" }

  // ① 括号内的版本名
  BRACKET_RE.lastIndex = 0
  let bracket: RegExpExecArray | null
  while ((bracket = BRACKET_RE.exec(title)) !== null) {
    const inner = bracket[1] ?? ""
    const hit = matchIn(inner)
    if (hit) return { version: hit.key, source: "bracket", evidence: hit.evidence }
  }

  // ② 全文关键词
  const kw = matchIn(title)
  if (kw) return { version: kw.key, source: "keyword", evidence: kw.evidence }

  // ③ 认不出
  return { version: OTHER_VERSION, source: "none", evidence: "" }
}

/** 版本 key → 标签（含 other）。 */
export function versionLabel(key: string): string {
  if (key === OTHER_VERSION) return OTHER_VERSION_LABEL
  return TEXTBOOK_VERSIONS.find((v) => v.key === key)?.label ?? OTHER_VERSION_LABEL
}

/** 全部可选版本（含「其他版本」），供筛选 UI 使用。 */
export const VERSION_OPTIONS: readonly { key: string; label: string }[] = [
  ...TEXTBOOK_VERSIONS.map((v) => ({ key: v.key, label: v.label })),
  { key: OTHER_VERSION, label: OTHER_VERSION_LABEL },
]

// ─── 疑似非教材同步内容 ──────────────────────────────────────────────────────

/**
 * 看起来**不是**教材同步、却被归档在某个年级下的课程（用于产出人工复核清单）。
 *
 * 实测例子（都在 grade_1）：`幼儿启蒙英语`、`英语启蒙`、
 * `儿童英语启蒙·生活主题系列`、`1年纪英语基础学习`（含错别字）。
 *
 * ⚠️ 这里**只做识别、只产出清单**，脚本不会自动把它们移出年级 ——
 * 那是一次内容归类变更，需要人工判断（有些"主题系列"可能确实是教材配套）。
 */
const NON_TEXTBOOK_HINTS = ["启蒙", "幼儿", "入门", "零基础", "基础学习", "主题系列", "单词表", "默写"]

export function looksNonTextbook(title: string, versionSource: VersionMatchSource): boolean {
  // 能认出教材版本的，基本可以确定是教材同步，不打扰
  if (versionSource !== "none") return false
  return NON_TEXTBOOK_HINTS.some((h) => title.includes(h))
}
