"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Users, ListVideo, ImageIcon } from "lucide-react"
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
  /** 叠在封面右上角的小徽章（「我的课程」用来显示「3天前学过」） */
  cornerBadge?: React.ReactNode
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
 * 封面是「先铺一层占位、图 onload 后加 .loaded 淡入」
 * （`.TypeList li .img img { opacity: 0 }` / `img.loaded { opacity: 1 }`）。
 * 组件拿到图前是客户端渲染的，onload 必定触发；但为防浏览器缓存命中时
 * React 挂上 onLoad 之前图就已 complete（那样永远停在 opacity:0 的占位态），
 * 这里再用一个 callback ref 兜一次 complete。
 *
 * `alt` 用空串：课程标题就在紧邻的下方，重复朗读一遍对读屏用户是噪音。
 */
function CoverImage({
  src,
  sizes,
  loaded,
  onLoaded,
  onError,
}: {
  src: string
  sizes: string
  loaded: boolean
  onLoaded: () => void
  onError: () => void
}) {
  const refCb = useCallback(
    (node: HTMLImageElement | null) => {
      if (node?.complete && node.naturalWidth > 0) onLoaded()
    },
    [onLoaded]
  )

  if (src.startsWith("/")) {
    return (
      <Image
        ref={refCb}
        src={src}
        alt=""
        fill
        sizes={sizes}
        onLoad={onLoaded}
        onError={onError}
        className={cn("course-cover-img", loaded && "loaded")}
      />
    )
  }
  // 外链与 dataURL 必须用裸 img：next/image 对未登记 remotePatterns 的域名会直接抛错，
  // 而后台的「上传封面」把图片写成 base64 dataURL。
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={refCb}
      src={src}
      alt=""
      onLoad={onLoaded}
      onError={onError}
      className={cn("course-cover-img", loaded && "loaded")}
    />
  )
}

/**
 * 主题图缺失（或课程还没落到任何槽位）时的兜底：分类渐变 + 分类标签 + 标题。
 * 这是三层降级里唯一会画出文字的一层，所以它必须自己带上标题。
 */
function GradientCover({
  theme,
  gradient,
  label,
  title,
  sourceName,
}: {
  theme: CategoryTheme
  /** 由 courseId 算出的渐变 —— 每门课不同，这是「色卡不重复」的关键 */
  gradient: string
  label: string
  title: string
  sourceName: string
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col justify-between p-4 select-none"
      style={{ background: gradient }}
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

/**
 * 课程卡 —— 课程市场/课本同步共用的 `.TypeList li.market-course-card`。
 *
 * 结构：`.img`（16:9 封面，占位图 + 淡入真图）+ `.market-card-info`
 * （h6 两行截断标题 + `.market-card-footer`）。整卡可点：外层是 `<li>`（承接
 * `.TypeList li` 的圆角/悬停上浮），里面铺一层 `absolute inset-0` 的 `<Link>`，
 * 这样中键新开标签、键盘 Tab、右键「复制链接」这些锚点能力都还在 ——
 * 简单的 `li onclick` 会丢掉这些。
 *
 * 难度徽章（`.level-badge` cj/zj/gj）刻意不渲染：本库 courses 表没有难度字段，
 * 编一个出来就是假数据。
 */
export function CourseCard({
  course,
  variant = "discover",
  stats,
  cornerBadge,
}: CourseCardProps) {
  const cover = resolveCourseCover(course)
  const categoryLabel = getCategoryLabel(course.categoryKey, course.subCategoryKey)

  const [coverFailed, setCoverFailed] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)

  // 网格是 minmax(270px, 1fr) 自适应列；sizes 按参考断点如实声明，
  // 否则 next/image 会按最大列宽下发过大的图。
  const sizes =
    "(max-width: 639px) 100vw, (max-width: 1023px) 50vw, (max-width: 1439px) 33vw, 300px"

  const isMine = variant === "mine"
  const progressPct =
    stats && stats.lessonCount > 0
      ? Math.min(100, Math.round((stats.completedLessons / stats.lessonCount) * 100))
      : 0
  const showImage = cover.kind === "image" && !coverFailed

  return (
    <li className="market-course-card">
      {/*
        mine（我的课程）进课程详情：学习/进度视角，练习页「返回」也指向这里。
        discover（商城）保持商城详情：挑课/获取视角。两条产品线分开。
      */}
      <Link
        href={isMine ? `/home/courses/${course.id}` : `/home/store/${course.id}`}
        aria-label={course.title}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />

 {/* 封面：16:9（.TypeList li .img { aspect-ratio: 16/9 }） */}
      <div className="img">
        {/*
          占位图只在「有真图、还没加载完」时渲染。
          占位图一直存在、靠 onload 给 .hidden 隐藏的前提是每张卡都有 <img>；
          本仓渐变封面（cover.kind !== "image"）根本没有 <img> 可触发 onload，
          而 .img-placeholder 是 z-index:1 + 不透明 #f1f4f7，会直接盖住渐变
          （实测：渐变卡右下角取色 = rgb(241,244,247)，正是这个底色）。
          所以这里按条件渲染，而不是靠 .hidden 兜。
        */}
        {showImage && (
          <div className={cn("img-placeholder", imgLoaded && "hidden")}>
 {/* <i> 承接 32px 图标与 pulse 动画，lucide 继承其 currentColor */}
            <i><ImageIcon size={32} /></i>
          </div>
        )}
        {showImage && cover.kind === "image" ? (
          <CoverImage
            src={cover.src}
            sizes={sizes}
            loaded={imgLoaded}
            onLoaded={() => setImgLoaded(true)}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <GradientCover
            theme={cover.theme}
            gradient={cover.gradient}
            label={categoryLabel}
            title={course.title}
            sourceName={course.sourceName}
          />
        )}
        {course.source === "official" && (
          <span className="absolute top-2 left-2 z-20 rounded-full bg-foreground/15 px-2 py-0.5 text-[10px] font-medium text-foreground/90 backdrop-blur-sm">
            官方
          </span>
        )}
        {cornerBadge && (
          <div className="absolute top-2 right-2 z-20 pointer-events-none">{cornerBadge}</div>
        )}
      </div>

      <div className="market-card-info">
        <h6 title={course.title}>{course.title}</h6>

        {isMine && stats ? (
          <>
            <div className="market-card-footer">
              <span className="count">
                已学 {stats.completedLessons} / {stats.lessonCount} 课
              </span>
              <span className="count">{progressPct}%</span>
            </div>
            {stats.lessonCount > 0 && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="market-card-footer">
            <span className="count">
              <Users size={12} />
              {formatLearnerCount(course.learnerCount)}人加入
              {(course.lessonCount ?? 0) > 0 && (
                <>
                  <span className="mx-0.5">·</span>
                  <ListVideo size={12} /> {course.lessonCount}课时
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </li>
  )
}
