"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  Search,
  CircleX,
  ChevronDown,
  Check,
  SearchX,
  Loader2,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Course, SortMode } from "@/types/course"
import { SORT_OPTIONS } from "@/types/course"
import type { StoreFacets } from "@/lib/store-facets"
import { ErrorBoundary } from "@/components/shared/ErrorBoundary"
import { CourseTabs } from "./CourseTabs"
import { CourseCard } from "./CourseCard"

const PAGE_SIZE = 20

/**
 * 排序下拉 —— 参考站的 hero 右侧只有搜索框，没有排序控件；本仓的排序是既有功能
 * （`SORT_OPTIONS` 三档），不能因为改版丢掉。于是挂进提示卡的右侧，
 * 直接用参考站 `.kefu-btn` 的白色胶囊外观 —— 那本来就是「右侧动作」的样式。
 */
function SortMenu({
  sortMode,
  onSortChange,
}: {
  sortMode: SortMode
  onSortChange: (v: SortMode) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const currentLabel = SORT_OPTIONS.find((o) => o.key === sortMode)?.label ?? "最新发布"

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="kefu-btn"
      >
        {currentLabel}
        <ChevronDown
          size={16}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-xl border border-border bg-card py-1 shadow-xl"
        >
          {SORT_OPTIONS.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.key === sortMode}
              key={option.key}
              onClick={() => {
                onSortChange(option.key)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center justify-between px-4 py-2 text-sm transition-colors",
                option.key === sortMode
                  ? "bg-accent/5 text-accent"
                  : "text-foreground hover:bg-muted"
              )}
            >
              {option.label}
              {option.key === sortMode && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function StoreClient() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeMainTab, setActiveMainTab] = useState("all")
  const [activeSubTab, setActiveSubTab] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>("latest")

  const [courses, setCourses] = useState<Course[]>([])
  const [totalCount, setTotalCount] = useState(0)
  // 各分类 / 子分类的课程数。与列表分开取：它**不随筛选变化**（理由见 lib/store-facets），
  // 所以只在挂载时请求一次，翻页与切换分类都不会重新拉。
  const [facets, setFacets] = useState<StoreFacets | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const mountedRef = useRef(false)

  // Build query params
  const buildUrl = useCallback(
    (p: number) => {
      const params = new URLSearchParams()
      params.set("current", String(p))
      params.set("pageSize", String(PAGE_SIZE))
      if (activeMainTab !== "all") params.set("categoryKey", activeMainTab)
      if (activeSubTab) params.set("subCategoryKey", activeSubTab)
      if (searchQuery.trim()) params.set("search", searchQuery.trim())
      params.set("sortMode", sortMode)
      return `/api/courses/list?${params.toString()}`
    },
    [activeMainTab, activeSubTab, searchQuery, sortMode]
  )

  // Fetch: page=1 replaces, page>1 appends
  const doFetch = useCallback(
    async (p: number, append: boolean, signal: AbortSignal) => {
      if (p === 1) {
        setLoading(true)
        setLoadError(false)
      } else {
        setLoadingMore(true)
        loadingMoreRef.current = true
      }

      try {
        const res = await fetch(buildUrl(p), { signal })
        const json = await res.json()
        if (signal.aborted) return

        if (json.data) {
          setCourses((prev) => {
            const next = append ? [...prev, ...json.data] : json.data
            // Dedup by id — concurrent DB writes may shift items between pages
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
    [buildUrl]
  )

  // Reset + fetch page 1 when filters change
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Skip initial mount — React 19 Strict Mode double-mount would trigger twice
    if (mountedRef.current) {
      doFetch(1, false, controller.signal)
    } else {
      mountedRef.current = true
      doFetch(1, false, controller.signal)
    }

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMainTab, activeSubTab, searchQuery, sortMode])

  /**
   * 取各分类的课程数，只跑一次。
   *
   * 用 AbortController 而不是忽略卸载后 setState：Strict Mode 下这个 effect 会跑两次，
   * 第一次的响应在组件重建后落地会把 facets 写进已废弃的实例（数字还是对的，
   * 但会在 React 里留下一次无意义的更新）。取消失败比事后判断更干净。
   */
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/courses/counts", { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: StoreFacets | null) => {
        if (!controller.signal.aborted && json) setFacets(json)
      })
      // 计数取失败就不显示角标。不要设 loadError —— 课程列表好好的，
      // 一个装饰性数字不该把整页变成「加载失败」。
      .catch(() => {})
    return () => controller.abort()
  }, [])

  // Load next page (infinite scroll)
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return
    if (courses.length >= totalCount) return
    const controller = new AbortController()
    abortRef.current = controller
    doFetch(page + 1, true, controller.signal)
  }, [doFetch, page, courses.length, totalCount])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const hasMore = courses.length < totalCount
    if (!hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: "200px" }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, courses.length, totalCount])

  const hasMore = courses.length < totalCount
  const searching = searchQuery.trim().length > 0

  return (
    <ErrorBoundary>
    <div className="store-market-page">
      <div className="maxWidth">
        {/* ── Hero：标题 + 副标题 + 搜索框（参考站 .market-hero-section）── */}
        <div className="market-hero-section">
          <div className="hero-left">
            <h2>课程广场</h2>
            <span className="hero-subtitle">
              精选分级阅读、中小学同步、应试考试与实用英语课程，找到适合你的那一门
            </span>
          </div>
          <div className="hero-right">
            <div className="searchInp modern-search">
              <p>
                {/* 参考站把搜索图标也做成「点击即搜」的触发器，这里保持一致 */}
                <i
                  className="search-icon-main"
                  role="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => {
                    const el = document.getElementById("store-search-input")
                    el?.focus()
                  }}
                >
                  <Search size={20} />
                </i>
                <input
                  id="store-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索课程名称..."
                  aria-label="搜索课程"
                />
                <i
                  className={cn("search-clear", searching && "on")}
                  role="button"
                  tabIndex={0}
                  aria-label="清空搜索"
                  onClick={() => setSearchQuery("")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setSearchQuery("")
                    }
                  }}
                >
                  <CircleX size={18} />
                </i>
              </p>
            </div>
          </div>
        </div>

        {/* ── 提示条：课程总数 + 排序（参考站 .modern-tip-card）── */}
        <div className="modern-tip-card">
          <div className="tip-left">
            <i>
              <Sparkles size={16} />
            </i>
            <span>
              共 <strong>{totalCount}</strong> 门课程
              {searching ? ` · 正在搜索「${searchQuery.trim()}」` : " · 选一门开始你的英语学习"}
            </span>
          </div>
          <div className="tip-right">
            <SortMenu sortMode={sortMode} onSortChange={setSortMode} />
          </div>
        </div>
      </div>

      {/* ── 两级筛选标签（参考站 .fixedTab > .courseTab）── */}
      <div className="maxWidth">
        <CourseTabs
          activeMainTab={activeMainTab}
          activeSubTab={activeSubTab}
          onMainTabChange={setActiveMainTab}
          onSubTabChange={setActiveSubTab}
          facets={facets}
        />
      </div>

      {/* ── 卡片网格（参考站 .TypeList）── */}
      <div className="maxWidth">
        <div className="TypeList">
          {loadError ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="mb-3 text-sm text-muted-foreground">加载失败</p>
              <button
                type="button"
                onClick={() => doFetch(1, false, new AbortController().signal)}
                className="text-sm font-medium text-accent hover:underline"
              >
                点击重试
              </button>
            </div>
          ) : loading ? (
            <ul>
              {/* 骨架用同一套 li 结构，避免加载完成时网格列宽跳动 */}
              {Array.from({ length: 10 }).map((_, i) => (
                <li key={i} className="market-course-card">
                  <div className="img">
                    <div className="skeleton" />
                  </div>
                  <div className="market-card-info animate-pulse">
                    <div className="mt-1.5 h-4 w-3/4 rounded bg-foreground/[0.06]" />
                    <div className="mt-2 h-3 w-1/2 rounded bg-foreground/[0.04]" />
                  </div>
                </li>
              ))}
            </ul>
          ) : courses.length > 0 ? (
            <>
              <ul>
                {courses.map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
              </ul>

              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-8 text-sm text-muted-foreground"
                >
                  {loadingMore && <Loader2 className="h-5 w-5 animate-spin" />}
                </div>
              )}

              {!hasMore && courses.length > 0 && (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground/60">
                  已经到底了
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <SearchX className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">没有找到匹配的课程</p>
              <p className="mt-1 text-xs text-muted-foreground/70">试试其他关键词或分类</p>
            </div>
          )}
        </div>
      </div>
    </div>
    </ErrorBoundary>
  )
}
