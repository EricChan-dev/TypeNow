"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Course } from "@/types/course"
import {
  getCategoryLabel,
  resolveCourseCover,
  type CategoryTheme,
} from "@/lib/course-cover"

export interface CourseCardStats {
  lessonCount: number
  sentenceCount: number
  completedLessons: number
}

interface CourseCardProps {
  course: Course
  /**
   * "discover" —— 课程广场 / 教材同步：用户在**挑**课程，图片负责吸引点击
   * "mine"     —— 我的课程：用户已经挑过、要回来继续练，需要的是「我学到哪了」
   *
   * 默认 discover，所以另两个列表页无需改动。
   */
  variant?: "discover" | "mine"
  /** 仅 variant="mine" 需要，由 /api/courses/mine 提供 */
  stats?: CourseCardStats
}

function formatLearnerCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * 封面图。
 *
 * 只有我们自己生成的本地图片（以 `/` 开头）才走 `next/image`：自动出 WebP/AVIF、
 * 懒加载、按 `sizes` 下发合适尺寸。外链与 dataURL 走裸 img ——
 * `next/image` 对未在 `next.config.ts` 的 `remotePatterns` 里登记的域名会直接抛错，
 * 而后台的「上传封面」是把图片转成 base64 dataURL 写进 `courses.cover_url`。
 *
 * `alt` 用空串：课程标题就在紧邻的下方，重复朗读一遍对读屏用户是噪音。
 */
function CoverImage({
  src,
  sizes,
  onError,
}: {
  src: string
  sizes: string
  onError: () => void
}) {
  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt=""
        fill
        sizes={sizes}
        onError={onError}
        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      onError={onError}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

/**
 * 主题图缺失（或课程还没落到任何槽位）时的兜底：分类渐变 + 分类标签 + 标题。
 * 这是三层降级里唯一会画出文字的一层，所以它必须自己带上标题。
 */
function GradientCover({
  theme,
  label,
  title,
  sourceName,
}: {
  theme: CategoryTheme
  label: string
  title: string
  sourceName: string
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col justify-between p-4 select-none"
      style={{ background: theme.bg }}
    >
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `radial-gradient(circle, ${theme.accent} 1px, transparent 1px)`,
          backgroundSize: "16px 16px",
        }}
      />
      <span
        className="relative z-10 self-start rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide"
        style={{ background: theme.badge, color: theme.accent }}
      >
        {label}
      </span>
      <h3
        className="relative z-10 line-clamp-2 text-sm font-bold leading-snug"
        style={{ color: theme.text }}
      >
        {title}
      </h3>
      <span
        className="relative z-10 text-[10px] font-medium opacity-50"
        style={{ color: theme.text }}
      >
        {sourceName}
      </span>
    </div>
  )
}

export function CourseCard({ course, variant = "discover", stats }: CourseCardProps) {
  const cover = resolveCourseCover(course)
  const categoryLabel = getCategoryLabel(course.categoryKey, course.subCategoryKey)

  /**
   * 图片加载失败时退回渐变色块。
   *
   * 为什么需要：第 2 层（主题变体表）是**乐观返回路径**的 —— 它只根据 slug 是否在
   * 44 个合法槽位里就拼出图片路径，无法知道那个文件此刻是否真的在磁盘上。
   * 没有这个兜底，文件缺失（部署漏传 public/、生成中断、手工删图）的表现是
   * 一张破图：`alt` 文本会直接溢出到卡片上，比色块难看得多。
   * 有了它，「三层降级，永不出现空白封面」才是真的 —— 而不是只在代码里成立。
   */
  const [coverFailed, setCoverFailed] = useState(false)

  // 5 列布局时卡片约 220px；sizes 必须按断点如实声明，否则 next/image 会下发过大的图
  const sizes =
    "(max-width: 639px) 100vw, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 20vw"

  const isMine = variant === "mine"
  const progressPct =
    stats && stats.lessonCount > 0
      ? Math.min(100, Math.round((stats.completedLessons / stats.lessonCount) * 100))
      : 0
  const showImage = cover.kind === "image" && !coverFailed

  return (
    <Link
      href={`/home/store/${course.id}`}
      className="group block w-full text-left rounded-xl border border-border bg-card overflow-hidden hover:border-accent/50 hover:shadow-lg transition-all"
    >
      {/*
        封面：discover 用 3:2 大图（视觉冲击由图片本身提供），mine 用 16:10。
        两种形态都**不把标题压在图上** —— 实测 4 张样图的底部全是画面里最亮最碎的
        区域，「下三分之一留暗区」的约束一次都没生效，压图方案的可靠性取决于
        每一张图的明暗，而 176 张的构图不受控（见设计文档 D7）。
      */}
      <div className={cn("relative overflow-hidden", isMine ? "aspect-[16/10]" : "aspect-[3/2]")}>
        {showImage && cover.kind === "image" ? (
          <CoverImage src={cover.src} sizes={sizes} onError={() => setCoverFailed(true)} />
        ) : (
          <GradientCover
            theme={cover.theme}
            label={categoryLabel}
            title={course.title}
            sourceName={course.sourceName}
          />
        )}
        {course.source === "official" && (
          <span className="absolute top-2 left-2 rounded-full bg-foreground/15 px-2 py-0.5 text-[10px] font-medium text-foreground/90 backdrop-blur-sm">
            官方
          </span>
        )}
      </div>

      {/* 信息区：标题只渲染一次（原先封面上还压了一次，换成真图后纯属重复） */}
      <div className={cn("space-y-2", isMine ? "p-3.5" : "p-3")}>
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {course.title}
        </h3>

        {isMine && stats ? (
          <>
            <p className="text-xs text-muted-foreground">
              {stats.lessonCount} 课 · {stats.sentenceCount} 句
            </p>
            {stats.lessonCount > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    已学 {stats.completedLessons} / {stats.lessonCount} 课
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{categoryLabel}</span>
            <span className="flex shrink-0 items-center gap-1">
              <Users className="h-3 w-3" />
              {formatLearnerCount(course.learnerCount)}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}
