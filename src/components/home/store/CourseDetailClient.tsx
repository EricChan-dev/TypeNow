"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ChevronLeft, BookOpen, Users, Play, Check } from "lucide-react"
import type { Course } from "@/types/course"
import { useAcquiredCourses } from "@/lib/hooks/useAcquiredCourses"
import { trackCourseOpen } from "@/lib/analytics"
import { cn } from "@/lib/utils"
// 配色与分类标签原先在本文件里复制了一份（与 CourseCard 各约 40 行），
// 且这里只看 cover_url 决定用图还是色块 —— 在主题图上线的语境下，那会让同一门课
// 在列表里有图、点进详情却是色块。现在两处走同一个解析函数。
import { getCategoryLabel, resolveCourseCover } from "@/lib/course-cover"

interface LessonRow {
  id: string
  courseId: string
  title: string
  summary: string | null
  sortOrder: number
}

function formatLearnerCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

interface CourseDetailClientProps {
  courseId: string
}

export function CourseDetailClient({ courseId }: CourseDetailClientProps) {
  const router = useRouter()
  const [course, setCourse] = useState<Course | null>(null)
  const [lessons, setLessons] = useState<LessonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  /**
   * 图片加载失败时退回渐变色块。
   * 第 2 层（主题变体表）只根据 slug 是否在 44 个合法槽位里就拼出路径，
   * 无法知道文件此刻是否真在磁盘上；没有这个兜底，文件缺失的表现是破图 +
   * alt 文本溢出，比色块难看得多。与 CourseCard 里同一处兜底对应。
   *
   * 必须和其它 useState 放在一起、且在下面三个提前 return **之前** ——
   * 放到 return 之后会违反 hooks 规则：loading 由 true 变 false 时
   * 组件会多调用一个 hook，React 直接抛「Rendered more hooks than …」。
   */
  const [coverFailed, setCoverFailed] = useState(false)
  const { isAcquired, acquire } = useAcquiredCourses()

  useEffect(() => {
    setLoading(true)
    // 课程详情是「注册了但一直没开始学」的分界点：漏斗里注册之后的第一步。
    // 放在这里而不是 store 列表页，因为点进具体课程才代表真的有学习意图。
    trackCourseOpen(courseId)
    Promise.all([
      fetch(`/api/courses/${courseId}`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/lessons`).then((r) => r.json()),
    ]).then(([courseJson, lessonsJson]) => {
      if (courseJson.data) setCourse(courseJson.data as Course)
      if (lessonsJson.data) setLessons(lessonsJson.data as LessonRow[])
    }).catch(() => setLoadError(true)).finally(() => setLoading(false))
  }, [courseId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-6 w-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <p className="text-sm text-muted-foreground mb-3">加载失败</p>
        <button onClick={() => window.location.reload()} className="text-sm text-accent font-medium hover:underline">点击重试</button>
      </div>
    )
  }

  if (!course) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <p className="text-sm font-medium text-muted-foreground">课程未找到</p>
        <Link
          href="/home/store"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          返回课程列表
        </Link>
      </div>
    )
  }

  const acquired = isAcquired(courseId)
  const firstLessonId = lessons[0]?.id
  const cover = resolveCourseCover(course)
  const categoryLabel = getCategoryLabel(course.categoryKey, course.subCategoryKey)

  return (
    <div className="px-6 lg:px-10 xl:px-14 py-6">
      {/* Back button */}
      <Link
        href="/home/store"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
      >
        <ChevronLeft className="h-4 w-4" />
        返回课程列表
      </Link>

      {/* Header Card */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden mb-6 flex flex-col sm:flex-row">
        {/* Cover */}
        {cover.kind === "image" && !coverFailed ? (
          <div className="relative sm:w-[280px] lg:w-[320px] shrink-0 aspect-[16/10] sm:aspect-auto overflow-hidden">
            {/* 本地图片走 next/image；外链与后台传的 base64 dataURL 走裸 img
                （next/image 对未登记 remotePatterns 的域名会直接抛错）。
                alt 用空串：标题就在紧邻的右侧，重复朗读对读屏用户是噪音。 */}
            {cover.src.startsWith("/") ? (
              <Image
                src={cover.src}
                alt=""
                fill
                sizes="320px"
                className="object-cover"
                onError={() => setCoverFailed(true)}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover.src}
                alt=""
                onError={() => setCoverFailed(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {course.source === "official" && (
              <span className="absolute top-3 left-3 rounded-full bg-foreground/15 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-medium text-foreground/90">
                官方
              </span>
            )}
          </div>
        ) : (
          <div
            className="relative sm:w-[280px] lg:w-[320px] shrink-0 aspect-[16/10] sm:aspect-auto flex flex-col justify-between p-5 overflow-hidden select-none"
            style={{ background: cover.gradient }}
          >
            {/* Subtle texture dots */}
            <div
              className="absolute inset-0 opacity-[0.05]"
              style={{
                backgroundImage: `radial-gradient(circle, ${cover.theme.accent} 1px, transparent 1px)`,
                backgroundSize: "14px 14px",
              }}
            />

            {/* Top row: category + source badges */}
            <div className="relative z-10 flex items-center gap-2">
              <span
                className="rounded-md px-2.5 py-1 text-xs font-semibold tracking-wide"
                style={{ background: cover.theme.badge, color: cover.theme.accent }}
              >
                {categoryLabel}
              </span>
              {course.source === "official" && (
                <span className="rounded-full bg-white/10 backdrop-blur-sm px-2.5 py-1 text-xs font-medium text-white/70">
                  官方
                </span>
              )}
            </div>

            {/* Middle: title */}
            <div className="relative z-10 flex-1 flex items-center">
              <h2
                className="text-base font-bold leading-snug line-clamp-3"
                style={{ color: cover.theme.text }}
              >
                {course.title}
              </h2>
            </div>

            {/* Bottom: creator */}
            <div className="relative z-10 flex items-center gap-2">
              <span className="text-xs font-medium opacity-50" style={{ color: cover.theme.text }}>
                {course.sourceName}
              </span>
              <div className="flex-1 h-px opacity-10" style={{ background: cover.theme.text }} />
            </div>
          </div>
        )}

        {/* Info */}
        <div className="p-5 sm:p-6 flex-1 flex flex-col justify-center min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-foreground">{course.title}</h1>
          {course.description && (
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed line-clamp-3">
              {course.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className={cn(
                "flex items-center justify-center h-5 w-5 rounded-full shrink-0 text-[10px] font-bold",
                course.source === "official" ? "bg-accent text-white" : "bg-muted text-muted-foreground"
              )}>
                {course.source === "official" ? "官" : (course.sourceName || "U")[0]}
              </div>
              {course.sourceName}
            </div>
            <div className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              {lessons.length} 课
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {formatLearnerCount(course.learnerCount)} 人学习
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {acquired ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-5 py-2.5 text-sm font-medium text-muted-foreground cursor-not-allowed">
                  <Check className="h-4 w-4" />
                  已获取
                </span>
                <button
                  onClick={() => firstLessonId && router.push(`/home/learn/${courseId}?lesson=${firstLessonId}`)}
                  disabled={!firstLessonId}
                  title={!firstLessonId ? "暂无可用章节" : undefined}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="h-4 w-4" />
                  开始学习
                </button>
              </>
            ) : (
              <button
                onClick={() => acquire(courseId)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                获取课程
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mb-5">
        <div className="flex items-center gap-0">
          <span className="relative px-4 py-3 text-sm font-medium text-accent after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-accent after:rounded-full">
            大纲 ({lessons.length})
          </span>
        </div>
      </div>

      {/* Tab Content */}
      {lessons.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {lessons.map((lesson, i) => (
              <Link
                key={lesson.id}
                href={`/home/learn/${courseId}?lesson=${lesson.id}`}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/30 transition-colors"
              >
                <div className="flex items-center justify-center h-7 w-7 rounded-full bg-accent/10 text-accent text-xs font-bold shrink-0">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-foreground truncate">
                    {lesson.title}
                  </h3>
                  {lesson.summary && (
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {lesson.summary}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm font-medium text-muted-foreground">暂无章节</p>
          </div>
        )}
    </div>
  )
}
