"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { SearchX, Loader2 } from "lucide-react"
import type { Course, SortMode } from "@/types/course"
import { SearchAndSortBar } from "./SearchAndSortBar"
import { CourseTabs } from "./CourseTabs"
import { CourseCard } from "./CourseCard"

const PAGE_SIZE = 20

export function StoreClient() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeMainTab, setActiveMainTab] = useState("all")
  const [activeSubTab, setActiveSubTab] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>("latest")

  const [courses, setCourses] = useState<Course[]>([])
  const [totalCount, setTotalCount] = useState(0)
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

  return (
    <div className="px-6 lg:px-10 xl:px-14 py-6">
      <SearchAndSortBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortMode={sortMode}
        onSortChange={setSortMode}
        courseCount={totalCount}
      />

      <CourseTabs
        activeMainTab={activeMainTab}
        activeSubTab={activeSubTab}
        onMainTabChange={setActiveMainTab}
        onSubTabChange={setActiveSubTab}
      />

      {loadError ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-sm text-muted-foreground mb-3">加载失败</p>
          <button onClick={() => doFetch(1, false, new AbortController().signal)} className="text-sm text-accent font-medium hover:underline">点击重试</button>
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

          {!hasMore && courses.length > 0 && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground/60">
              已经到底了
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <SearchX className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">没有找到匹配的课程</p>
          <p className="text-xs text-muted-foreground/70 mt-1">试试其他关键词或分类</p>
        </div>
      )}
    </div>
  )
}
