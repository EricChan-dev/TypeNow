"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { SearchX, Loader2, Info } from "lucide-react"
import type { Course, SortMode } from "@/types/course"
import { ErrorBoundary } from "@/components/shared/ErrorBoundary"
import { SearchAndSortBar } from "./SearchAndSortBar"
import { CourseCard } from "./CourseCard"
import { cn } from "@/lib/utils"
import { GRADE_LABELS } from "@/lib/textbook-taxonomy"

const PAGE_SIZE = 20

/** /api/courses/textbook-facets 的响应形状 */
interface Facets {
  stages: {
    key: string
    label: string
    total: number
    /** 该学段里**版本未回填**的课程数（≠「未分级」，那是 sub_category_key 为空） */
    versionUnclassified: number
    versions: { key: string; label: string; count: number }[]
    grades: {
      key: string
      label: string
      total: number
      versions: { key: string; label: string; count: number }[]
    }[]
  }[]
  versionReady: boolean
}

/** 全部筛选条件放在**一个** state 里：它们永远一起决定同一次请求。 */
interface Filters {
  stage: string | null
  grade: string | null
  version: string | null
  search: string
  sort: SortMode
}

const INITIAL_FILTERS: Filters = {
  stage: null,
  grade: null,
  version: null,
  search: "",
  sort: "latest",
}

/**
 * 教材同步：**学段 → 年级 → 版本** 三级筛选。
 *
 * ── 为什么单独一个页面而不是给课程广场加筛选 ────────────────────────────────
 *
 * 课程广场是**单层分类**（`COURSE_CATEGORIES` 的 类别 → 子类），
 * 而教材同步是**两个正交维度**（年级 × 版本）叠加学段。硬塞进 CourseTabs 会让
 * 那个组件的语义变模糊。所以独立成页，但**复用** CourseCard / SearchAndSortBar。
 *
 * ── 三个刻意的设计 ──────────────────────────────────────────────────────────
 *
 * 1. **只列出真的有内容的选项，并显示数量**（数据来自 facets 接口）。
 *    实测高中只有 10 门、某些年级只有 9 门 —— 无条件全列会让用户点进空列表。
 * 2. **换年级时校验版本是否仍然存在**，不存在就重置为「全部版本」。
 *    否则「三年级 + 人教版」切到「七年级」（没有人教版）会得到空结果，
 *    而用户会以为是产品坏了。
 * 3. **版本尚未回填时隐藏整条版本栏**（facets 的 versionReady=false）。
 *    迁移执行与数据回填是两步，中间态必须显式处理，不能显示一排全是 0 的按钮。
 *
 * ── 取数为什么不放在 useEffect 里 ───────────────────────────────────────────
 *
 * 筛选条件**只由用户操作改变**，所以每次取数都从事件处理函数发起（`applyFilters`），
 * 不需要一个"监听 filters 变化"的 effect。这既避免了 effect 体内同步 setState
 * 造成的级联渲染，也少了一次"状态变化 → effect → 再取数"的间接跳转。
 * 首屏那次取数发生在 facets 请求的回调里（异步），同样不构成 effect 内同步更新。
 */
export function TextbookClient() {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [facetsError, setFacetsError] = useState(false)
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)

  const [courses, setCourses] = useState<Course[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)

  const buildUrl = useCallback((p: number, f: Filters) => {
    const params = new URLSearchParams()
    params.set("current", String(p))
    params.set("pageSize", String(PAGE_SIZE))
    params.set("categoryKey", "school_sync")
    // 选定具体年级时用 subCategoryKey（更精确）；否则用 stage 展开成年级集合
    if (f.grade) params.set("subCategoryKey", f.grade)
    else if (f.stage) params.set("stage", f.stage)
    if (f.version) params.set("textbookVersion", f.version)
    if (f.search.trim()) params.set("search", f.search.trim())
    params.set("sortMode", f.sort)
    return `/api/courses/list?${params.toString()}`
  }, [])

  const doFetch = useCallback(
    async (p: number, append: boolean, f: Filters, signal: AbortSignal) => {
      if (p > 1) {
        setLoadingMore(true)
        loadingMoreRef.current = true
      }
      try {
        const res = await fetch(buildUrl(p, f), { signal })
        const json = await res.json()
        if (signal.aborted) return
        if (json.data) {
          setCourses((prev) => {
            const next = append ? [...prev, ...json.data] : json.data
            // 去重：并发写入可能让同一条在两页里都出现
            const seen = new Set<string>()
            return next.filter((c: Course) => {
              if (seen.has(c.id)) return false
              seen.add(c.id)
              return true
            })
          })
          setTotalCount(json.total ?? 0)
          setPage(p)
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return
        setLoadError(true)
      } finally {
        if (!signal.aborted) {
          setLoading(false)
          setLoadingMore(false)
          loadingMoreRef.current = false
        }
      }
    },
    [buildUrl],
  )

  /**
   * 应用一组新的筛选条件并重新取第一页。
   *
   * **只从事件处理函数（或异步回调）调用**，不从 effect 体内调用 ——
   * 见组件头注释里关于取数位置的说明。
   */
  const applyFilters = useCallback(
    (next: Filters) => {
      setLoading(true)
      setLoadError(false)
      setFilters(next)
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller
      void doFetch(1, false, next, controller.signal)
    },
    [doFetch],
  )

  // 首屏：拉筛选面 → 选中第一个有内容的学段 → 拉该学段的课程列表。
  // 所有 setState 都在 promise 回调里（异步），不是 effect 体内同步更新。
  useEffect(() => {
    let alive = true
    fetch("/api/courses/textbook-facets")
      .then((r) => r.json())
      .then((d: Facets) => {
        if (!alive) return
        setFacets(d)
        const first = d.stages?.[0]
        if (first) {
          applyFilters({ ...INITIAL_FILTERS, stage: first.key })
        } else {
          setLoading(false)
        }
      })
      .catch(() => {
        if (!alive) return
        setFacetsError(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [applyFilters])

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return
    if (courses.length >= totalCount) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    void doFetch(page + 1, true, filters, controller.signal)
  }, [doFetch, page, courses.length, totalCount, filters])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    if (courses.length >= totalCount) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: "200px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, courses.length, totalCount])

  const stage = facets?.stages.find((s) => s.key === filters.stage) ?? null
  const grade = stage?.grades.find((g) => g.key === filters.grade) ?? null
  // 当前可见的版本选项：选定年级时用它自己的分布，否则用学段汇总
  const versionOptions = grade ? grade.versions : (stage?.versions ?? [])
  const hasMore = courses.length < totalCount

  /** 切学段：年级与版本都必须重置（它们的可选值整个换了）。 */
  function handleStage(next: string) {
    applyFilters({ ...filters, stage: next, grade: null, version: null })
  }

  /** 切年级：版本若在新年级下不存在，必须重置 —— 否则会得到空列表。 */
  function handleGrade(next: string | null) {
    if (!next || !stage) {
      applyFilters({ ...filters, grade: next, version: null })
      return
    }
    const nextGrade = stage.grades.find((g) => g.key === next)
    const stillAvailable = nextGrade?.versions.some((v) => v.key === filters.version)
    applyFilters({
      ...filters,
      grade: next,
      version: stillAvailable ? filters.version : null,
    })
  }

  function handleVersion(next: string | null) {
    applyFilters({ ...filters, version: next })
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  if (facetsError) {
    return (
      <div className="px-6 lg:px-10 xl:px-14 py-24 text-center">
        <p className="text-sm text-muted-foreground">筛选条件加载失败，请刷新重试</p>
      </div>
    )
  }

  if (!facets) {
    return (
      <div className="px-6 lg:px-10 xl:px-14 py-24 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (facets.stages.length === 0) {
    return (
      <div className="px-6 lg:px-10 xl:px-14 py-24 text-center">
        <p className="text-sm font-medium text-muted-foreground">教材同步内容正在整理中</p>
        <p className="text-xs text-muted-foreground/70 mt-1">你可以先到课程广场浏览其他课程</p>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="px-6 lg:px-10 xl:px-14 py-6">
        {/* 学段 */}
        <div className="flex items-center gap-1.5 mb-3">
          {facets.stages.map((s) => (
            <button
              key={s.key}
              onClick={() => handleStage(s.key)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                filters.stage === s.key
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {s.label}
              <span className="ml-1.5 text-[11px] font-normal opacity-60">{s.total}</span>
            </button>
          ))}
        </div>

        {/* 年级：只在该学段真的有年级子层时渲染。
            「未分级」分组的 grades 为空 —— 渲染出来会只剩一个孤零零的
            「全部年级」按钮，反而让人以为漏了东西。 */}
        {stage && stage.grades.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none border-t border-border/50 pt-3">
            <button
              onClick={() => handleGrade(null)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filters.grade === null
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              全部年级
            </button>
            {stage.grades.map((g) => (
              <button
                key={g.key}
                onClick={() => handleGrade(g.key)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filters.grade === g.key
                    ? "bg-accent/15 text-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {g.label ?? GRADE_LABELS[g.key] ?? g.key}
                <span className="ml-1 opacity-60">{g.total}</span>
              </button>
            ))}
          </div>
        )}

        {/* 版本：只列有内容的；整库都没有版本值时隐藏这一栏 */}
        {stage && facets.versionReady && versionOptions.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto py-3 scrollbar-none">
            <button
              onClick={() => handleVersion(null)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filters.version === null
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              全部版本
            </button>
            {versionOptions.map((v) => (
              <button
                key={v.key}
                onClick={() => handleVersion(v.key)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filters.version === v.key
                    ? "bg-accent/15 text-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {v.label}
                <span className="ml-1 opacity-60">{v.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* 版本尚未回填时的说明（迁移已跑、回填未跑） */}
        {stage && !facets.versionReady && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 my-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/70" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              教材版本分类正在整理中，暂时请按年级浏览。
            </p>
          </div>
        )}

        <SearchAndSortBar
          searchQuery={filters.search}
          onSearchChange={(v) => applyFilters({ ...filters, search: v })}
          sortMode={filters.sort}
          onSortChange={(v) => applyFilters({ ...filters, sort: v })}
          courseCount={totalCount}
          isAll={filters.grade === null && filters.version === null && !filters.search.trim()}
        />

        {loadError ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-sm text-muted-foreground mb-3">加载失败</p>
            <button
              onClick={() => applyFilters(filters)}
              className="text-sm text-accent font-medium hover:underline"
            >
              点击重试
            </button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card animate-pulse">
                <div className="aspect-[16/10] bg-foreground/[0.04]" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-foreground/[0.06] rounded w-3/4" />
                  <div className="h-3 bg-foreground/[0.04] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : courses.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {courses.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>

            {hasMore && (
              <div
                ref={sentinelRef}
                className="flex items-center justify-center py-8 text-sm text-muted-foreground"
              >
                {loadingMore && <Loader2 className="h-5 w-5 animate-spin" />}
              </div>
            )}

            {!hasMore && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground/60">
                已经到底了
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <SearchX className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">这个组合下还没有课程</p>
            <p className="text-xs text-muted-foreground/70 mt-1">换一个年级或版本试试</p>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
