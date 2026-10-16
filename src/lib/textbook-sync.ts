/**
 * 课本同步列表页（/home/textbook）的纯逻辑层（无数据库依赖，可单测）。
 *
 * 课本同步列表页（/home/textbook）的纯逻辑层（无数据库依赖，可单测）。
 *
 * 本文件收拢课本同步页里**可独立验证**的行为：分页窗口、搜索校验、
 * 「上次选择」记忆、URL 参数解析，以及把筛选面（facets）拍平成
 * 「一排年级 + 一排版本」的扁平布局。
 *
 * 年级与版本均为**数据驱动**：
 * · 年级只列真的有课的年级（facets 接口已按 total>0 过滤），外加「未分级」兜底；
 * · 版本来自 textbook_version 回填，各学段版本并集按数量倒序。
 */

import {
  UNGRADED_STAGE_KEY,
  UNGRADED_STAGE_LABEL,
} from "@/lib/textbook-taxonomy"

// ─── 页面常量 ─────────────────────────────────────────────

/** 每页 24 条。 */
export const TEXTBOOK_PAGE_SIZE = 24
/** 分页器窗口大小（pager.js pageButtonSize=5）。 */
export const PAGE_BUTTON_SIZE = 5
/** 搜索上限：超过 100 字符截断。 */
export const MAX_SEARCH_LENGTH = 100
/** 搜索下限：只有 1 个字符时 toast 提示。 */
export const MIN_SEARCH_LENGTH = 2
/** page 合法域为 1..10000，越界回退 1。 */
export const MAX_PAGE_NUMBER = 10000
/**
 * 「上次选择」的 localStorage 键（typenow 前缀）。
 */
export const LAST_FILTER_KEY = "typenow_textbook_sync_last_filter"

// ─── 筛选面拍平 ───────────────────────────────────────────────────────────────

/** /api/courses/textbook-facets 的响应（与该路由的 FacetStage 对齐）。 */
export interface FacetStage {
  key: string
  label: string
  total: number
  versionUnclassified: number
  versions: { key: string; label: string; count: number }[]
  grades: { key: string; label: string; total: number; versions: { key: string; label: string; count: number }[] }[]
}

export interface GradeTab {
  key: string
  label: string
}

/**
 * 把学段分层的 facets 拍平成单行年级标签。
 *
 * 顺序 = STAGES 声明顺序（小学一年级 → 高中），最后追加「未分级」
 * （facets 把它放在 stages 末尾，grades 为空、total>0 时才存在）。
 */
export function flattenGradeTabs(stages: readonly FacetStage[]): GradeTab[] {
  const tabs: GradeTab[] = []
  let ungraded: GradeTab | null = null
  for (const stage of stages) {
    if (stage.key === UNGRADED_STAGE_KEY) {
      ungraded = { key: UNGRADED_STAGE_KEY, label: UNGRADED_STAGE_LABEL }
      continue
    }
    for (const grade of stage.grades) {
      tabs.push({ key: grade.key, label: grade.label })
    }
  }
  if (ungraded) tabs.push(ungraded)
  return tabs
}

/**
 * 版本行 = 各学段版本并集，按数量倒序。
 * 同一版本可能出现在多个学段（人教版横跨小学初中高中），数量要**累加**而不是去重丢弃。
 */
export function unionVersionTabs(
  stages: readonly FacetStage[],
): { key: string; label: string; count: number }[] {
  const merged = new Map<string, { key: string; label: string; count: number }>()
  for (const stage of stages) {
    for (const v of stage.versions) {
      const prev = merged.get(v.key)
      if (prev) prev.count += v.count
      else merged.set(v.key, { key: v.key, label: v.label, count: v.count })
    }
  }
  return [...merged.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"),
  )
}

// ─── 搜索 ────────────────────────────────────────────────────────────────────

/** 超长截断 + trim：输入超过 100 字符时截断。 */
export function normalizeSearchValue(raw: string): string {
  return raw.trim().slice(0, MAX_SEARCH_LENGTH)
}

/**
 * 提交搜索前的校验：len===1 时 toast「请输入至少2个字符进行搜索」并
 * 聚焦输入框，不发请求。返回 null 表示通过。
 */
export function searchTermError(term: string): string | null {
  const trimmed = term.trim()
  if (trimmed.length === 1) return "请输入至少2个字符进行搜索"
  return null
}

// ─── 分页窗口（pager.js 语义）─────────────────────────────────────────────────

/** 窗口起点：floor((page-1)/5)*5+1。 */
export function pageWindowStart(page: number, size: number = PAGE_BUTTON_SIZE): number {
  return Math.floor((page - 1) / size) * size + 1
}

/** 当前窗口内的页码列表（1-based）。 */
export function pageWindowNumbers(totalPages: number, page: number, size: number = PAGE_BUTTON_SIZE): number[] {
  if (totalPages <= 0) return []
  const start = pageWindowStart(page, size)
  const out: number[] = []
  for (let p = start; p < start + size && p <= totalPages; p++) out.push(p)
  return out
}

/** 校验：page 1..10000，越界回退 1（非法输入同样回退 1）。 */
export function normalizePage(raw: string | null | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || Math.trunc(n) !== n || n < 1 || n > MAX_PAGE_NUMBER) return 1
  return n
}

// ─── 「上次选择」记忆（localStorage 语义）────────────────────────────────────

export interface LastFilter {
  gradeCode: string
  gradeName: string
  publisherId: string
  publisherName: string
  updatedAt: number
}

/** 安全解析 localStorage 里的记忆值；坏数据一律当不存在。 */
export function parseLastFilter(raw: string | null): LastFilter | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Partial<LastFilter>
    if (typeof obj !== "object" || obj === null) return null
    const gradeCode = typeof obj.gradeCode === "string" ? obj.gradeCode : ""
    const gradeName = typeof obj.gradeName === "string" ? obj.gradeName : ""
    const publisherId = typeof obj.publisherId === "string" ? obj.publisherId : ""
    const publisherName = typeof obj.publisherName === "string" ? obj.publisherName : ""
 // 两者全空的记忆没有意义，视为无效记录
    if (!gradeCode && !publisherId) return null
    return {
      gradeCode,
      gradeName,
      publisherId,
      publisherName,
      updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : 0,
    }
  } catch {
    return null
  }
}

export function saveLastFilter(filter: Omit<LastFilter, "updatedAt">): void {
  if (typeof window === "undefined") return
 // 两者全空时 removeItem 而不是存空记录
  if (!filter.gradeCode && !filter.publisherId) {
    window.localStorage.removeItem(LAST_FILTER_KEY)
    return
  }
  const record: LastFilter = { ...filter, updatedAt: Date.now() }
  window.localStorage.setItem(LAST_FILTER_KEY, JSON.stringify(record))
}

export function readLastFilter(): LastFilter | null {
  if (typeof window === "undefined") return null
  return parseLastFilter(window.localStorage.getItem(LAST_FILTER_KEY))
}

/**
 * 「上次选择: X · Y」按钮文案。只带一个维度时不出现分隔点。
 * 返回空串表示没有可展示的记忆。
 */
export function restoreSummaryText(filter: Pick<LastFilter, "gradeName" | "publisherName"> | null): string {
  if (!filter) return ""
  const parts = [filter.gradeName, filter.publisherName].filter(Boolean)
  if (parts.length === 0) return ""
  return `上次选择: ${parts.join(" · ")}`
}

// ─── URL 参数 ────────────────────────────────────────────────────────────────

/** URL 参数名。 */
export const QUERY_GRADE = "TextbookGradeCode"
export const QUERY_VERSION = "TextbookPublisherId"
export const QUERY_SEARCH = "CourseName"
export const QUERY_PAGE = "PageNumber"

export interface TextbookSyncQuery {
  gradeCode: string
  publisherId: string
  courseName: string
  page: number
}

/**
 * 解析 URL 参数：非法年级/版本回退空（= 全部），
 * 搜索词截断到 100，页码越界回退 1。
 */
export function parseTextbookSyncQuery(
  params: URLSearchParams | ReadonlyMap<string, string> | Record<string, string | string[] | undefined>,
  validGrades: readonly string[] = [],
  validVersions: readonly string[] = [],
): TextbookSyncQuery {
  const get = (key: string): string => {
    if (params instanceof URLSearchParams) return params.get(key) ?? ""
    if ("get" in params && typeof (params as Map<string, string>).get === "function") {
      return (params as ReadonlyMap<string, string>).get(key) ?? ""
    }
    const v = (params as Record<string, string | string[] | undefined>)[key]
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "")
  }

  const gradeCode = validGrades.includes(get(QUERY_GRADE)) ? get(QUERY_GRADE) : ""
  const publisherId = validVersions.includes(get(QUERY_VERSION)) ? get(QUERY_VERSION) : ""
  const courseName = normalizeSearchValue(get(QUERY_SEARCH))
  return { gradeCode, publisherId, courseName, page: normalizePage(get(QUERY_PAGE)) }
}

/** 是否有任一筛选生效（决定 chips/重置按钮的显隐）。 */
export function hasActiveFilters(gradeCode: string, publisherId: string, courseName: string): boolean {
  return Boolean(gradeCode || publisherId || courseName)
}
