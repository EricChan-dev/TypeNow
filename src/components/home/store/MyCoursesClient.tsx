"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ShoppingBag } from "lucide-react"
import type { Course } from "@/types/course"
import { CourseCard, type CourseCardStats } from "./CourseCard"

/**
 * `/api/courses/mine` 返回的形状：课程行 + 卡片所需的规模/进度 + 上次练习时间。
 *
 * 注意这里不再需要「拉全量课程再前端筛」——过滤已在服务端完成。
 * 原先那条路径有个真实 bug：它请求 pageSize=500，而 list 路由把 pageSize 夹到 100，
 * 于是最新 100 门之外的课程（774 门中的 674 门）在「我的课程」里完全不可见。
 */
type MyCourse = Course & {
  stats: CourseCardStats
  lastStudiedAt: string | null
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
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
  const [myCourses, setMyCourses] = useState<MyCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    setLoading(true)
    // 服务端已按 lastStudiedAt 倒序返回，前端不再排序，也不再读 localStorage
    fetch("/api/courses/mine")
      .then((r) => r.json())
      .then((json: { data?: MyCourse[] }) => {
        if (json.data) setMyCourses(json.data)
        else setLoadError(true)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

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
              <CourseCard course={course} variant="mine" stats={course.stats} />
              {course.lastStudiedAt && (
                <div className="absolute top-2 right-2 z-10 pointer-events-none">
                  <span className="inline-block rounded-full bg-background/80 backdrop-blur-sm border border-border px-2 py-0.5 text-[10px] text-foreground/60 leading-relaxed">
                    {relativeTime(course.lastStudiedAt)}学过
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
