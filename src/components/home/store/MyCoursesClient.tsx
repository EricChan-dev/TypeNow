"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ShoppingBag } from "lucide-react"
import type { Course } from "@/types/course"
import { CourseCard, type CourseCardStats } from "./CourseCard"
import "@/app/home/store/store-market.css"

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

/**
 * 我的课程。
 *
 * 卡片与课程广场统一为句游式 `.market-course-card`（用户要求：广场和我的课程一起改）——
 * 差异只在 variant="mine" 多一条学习进度，以及封面右上角的「N天前学过」。
 * 网格与卡片样式复用同一份生成的 store-market.css（scoped 到 `.store-market-page`，
 * 所以这里根节点也必须带上这个类名）。
 */
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
    <div className="store-market-page">
      <div className="maxWidth">
        <div className="market-hero-section">
          <div className="hero-left">
            <h2>我的课程</h2>
            <span className="hero-subtitle">共 {myCourses.length} 门课程，继续上次的进度</span>
          </div>
        </div>
      </div>

      <div className="maxWidth">
        <div className="TypeList">
          {loadError ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="mb-3 text-sm text-muted-foreground">加载失败</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-sm font-medium text-accent hover:underline"
              >
                点击重试
              </button>
            </div>
          ) : loading ? (
            <ul>
              {Array.from({ length: 6 }).map((_, i) => (
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
          ) : myCourses.length > 0 ? (
            <ul>
              {myCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  variant="mine"
                  stats={course.stats}
                  cornerBadge={
                    course.lastStudiedAt ? (
                      <span className="inline-block rounded-full border border-border bg-background/80 px-2 py-0.5 text-[10px] leading-relaxed text-foreground/60 backdrop-blur-sm">
                        {relativeTime(course.lastStudiedAt)}学过
                      </span>
                    ) : null
                  }
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <ShoppingBag className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">还没有学习任何课程</p>
              <Link
                href="/home/store"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent transition-colors hover:text-accent/80"
              >
                去课程广场浏览
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
