"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { ShoppingBag } from "lucide-react"
import type { Course } from "@/types/course"
import { useAcquiredCourses } from "@/lib/hooks/useAcquiredCourses"
import { CourseCard } from "./CourseCard"

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(diff / 86400000)
  if (days < 30) return `${days}天前`
  const months = Math.floor(diff / 2592000000)
  return `${Math.max(1, months)}个月前`
}

export function MyCoursesClient() {
  const { acquiredIds } = useAcquiredCourses()
  const [allCourses, setAllCourses] = useState<Course[]>([])
  const [studyHistory, setStudyHistory] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch("/api/courses/list?pageSize=500")
      .then((r) => r.json())
      .then((json) => { if (json.data) setAllCourses(json.data as Course[]) })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let local: Record<string, number> = {}
    try {
      const raw = localStorage.getItem("typenow_study_history")
      if (raw) local = JSON.parse(raw)
    } catch {}
    setStudyHistory(local)

    fetch("/api/user/progress")
      .then((r) => r.json())
      .then((json: { data?: { courseId: string; lastStudiedAt: string }[] }) => {
        if (!json.data) return
        const merged = { ...local }
        for (const row of json.data) {
          const ts = new Date(row.lastStudiedAt).getTime()
          if (!merged[row.courseId] || ts > merged[row.courseId]) {
            merged[row.courseId] = ts
          }
        }
        setStudyHistory(merged)
      })
      .catch(() => {})
  }, [])

  // My Courses = acquired OR studied, sorted by last studied (most recent first)
  const myCourses = useMemo(() => {
    const studiedIds = new Set(Object.keys(studyHistory))
    const allMyIds = new Set([...acquiredIds, ...studiedIds])
    return allCourses
      .filter((c) => allMyIds.has(c.id))
      .sort((a, b) => (studyHistory[b.id] ?? 0) - (studyHistory[a.id] ?? 0))
  }, [allCourses, studyHistory, acquiredIds])

  return (
    <div className="px-6 lg:px-10 xl:px-14 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">我的课程</h1>
          <p className="text-xs text-muted-foreground mt-1">
            共 {myCourses.length} 门课程
          </p>
        </div>
      </div>

      {loadError ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-sm text-muted-foreground mb-3">加载失败</p>
          <button onClick={() => window.location.reload()} className="text-sm text-accent font-medium hover:underline">点击重试</button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card animate-pulse">
              <div className="aspect-[16/10] bg-foreground/[0.04]" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-foreground/[0.06] rounded w-3/4" />
                <div className="h-3 bg-foreground/[0.04] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : myCourses.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {myCourses.map((course) => (
            <div key={course.id} className="relative">
              <CourseCard course={course} />
              {studyHistory[course.id] && (
                <div className="absolute top-2 right-2 z-10 pointer-events-none">
                  <span className="inline-block rounded-full bg-background/80 backdrop-blur-sm border border-border px-2 py-0.5 text-[10px] text-foreground/60 leading-relaxed">
                    {relativeTime(studyHistory[course.id])}学过
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShoppingBag className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">还没有学习任何课程</p>
          <Link
            href="/home/store"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors"
          >
            去课程广场浏览
          </Link>
        </div>
      )}
    </div>
  )
}
