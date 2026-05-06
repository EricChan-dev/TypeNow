"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { SearchX } from "lucide-react"
import { mockCourses } from "@/lib/mock-data/courses"
import type { SortMode } from "@/types/course"
import { SearchAndSortBar } from "./SearchAndSortBar"
import { CourseTabs } from "./CourseTabs"
import { CourseCard } from "./CourseCard"

const PAGE_SIZE = 20

export function StoreClient() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeMainTab, setActiveMainTab] = useState("all")
  const [activeSubTab, setActiveSubTab] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>("latest")
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingRef = useRef(false)

  const filteredCourses = useMemo(() => {
    let result = mockCourses

    if (activeMainTab !== "all") {
      result = result.filter((c) => c.categoryKey === activeMainTab)
    }

    if (activeSubTab !== null) {
      result = result.filter((c) => c.subCategoryKey === activeSubTab)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.sourceName.toLowerCase().includes(q)
      )
    }

    return result
  }, [searchQuery, activeMainTab, activeSubTab])

  const sortedCourses = useMemo(() => {
    const sorted = [...filteredCourses]
    switch (sortMode) {
      case "latest":
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case "most_used":
        sorted.sort((a, b) => b.usageCount - a.usageCount)
        break
      case "name":
        sorted.sort((a, b) => a.title.localeCompare(b.title, "zh"))
        break
    }
    return sorted
  }, [filteredCourses, sortMode])

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(PAGE_SIZE)
  }, [searchQuery, activeMainTab, activeSubTab])

  const visibleCourses = sortedCourses.slice(0, displayCount)
  const hasMore = displayCount < sortedCourses.length

  // IntersectionObserver for infinite scroll
  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return
    loadingRef.current = true
    setLoadingMore(true)

    setTimeout(() => {
      setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, sortedCourses.length))
      setLoadingMore(false)
      loadingRef.current = false
    }, 500)
  }, [hasMore, sortedCourses.length])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: "200px" }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, hasMore])

  return (
    <div className="px-6 lg:px-10 xl:px-14 py-6">
      <SearchAndSortBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortMode={sortMode}
        onSortChange={setSortMode}
        courseCount={sortedCourses.length}
      />

      <CourseTabs
        activeMainTab={activeMainTab}
        activeSubTab={activeSubTab}
        onMainTabChange={setActiveMainTab}
        onSubTabChange={setActiveSubTab}
      />

      {visibleCourses.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {visibleCourses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>

          {/* Sentinel for infinite scroll */}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-8 text-sm text-muted-foreground"
            >
              {loadingMore && "加载中…"}
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
          <p className="text-sm font-medium text-muted-foreground">没有找到匹配的课程</p>
          <p className="text-xs text-muted-foreground/70 mt-1">试试其他关键词或分类</p>
        </div>
      )}
    </div>
  )
}
