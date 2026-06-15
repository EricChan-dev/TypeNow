"use client"

import Link from "next/link"
import { Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Course } from "@/types/course"
import { COURSE_CATEGORIES } from "@/types/course"

// ─── Category → color scheme ────────────────────────────────────────────────
const CATEGORY_THEMES: Record<string, { bg: string; accent: string; text: string; badge: string }> = {
  graded_reading: {
    bg: "linear-gradient(135deg, #0f2b1a 0%, #1a3d28 40%, #0d2216 100%)",
    accent: "#4ade80",
    text: "#bbf7d0",
    badge: "#166534",
  },
  school_sync: {
    bg: "linear-gradient(135deg, #0f1a3a 0%, #1a2d5a 40%, #0d1430 100%)",
    accent: "#60a5fa",
    text: "#bfdbfe",
    badge: "#1e3a5f",
  },
  exam_prep: {
    bg: "linear-gradient(135deg, #3a1010 0%, #5c1818 40%, #2d0d0d 100%)",
    accent: "#f87171",
    text: "#fecaca",
    badge: "#5c1a1a",
  },
  practical: {
    bg: "linear-gradient(135deg, #2d1a0f 0%, #4a2a1a 40%, #221006 100%)",
    accent: "#fb923c",
    text: "#fed7aa",
    badge: "#5c2d1a",
  },
}

const DEFAULT_THEME = {
  bg: "linear-gradient(135deg, #1a1a2e 0%, #2a2a44 40%, #12121f 100%)",
  accent: "#a78bfa",
  text: "#ddd6fe",
  badge: "#2e1a4a",
}

function getTheme(categoryKey: string | null) {
  if (categoryKey && CATEGORY_THEMES[categoryKey]) return CATEGORY_THEMES[categoryKey]
  return DEFAULT_THEME
}

function getCategoryLabel(categoryKey: string | null, subCategoryKey: string | null): string {
  if (!categoryKey) return "综合"
  const main = COURSE_CATEGORIES.find((c) => c.key === categoryKey)
  if (!main) return categoryKey
  if (!subCategoryKey) return main.label
  const sub = main.subCategories.find((s) => s.key === subCategoryKey)
  return sub ? `${main.label} · ${sub.label}` : main.label
}

function formatLearnerCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

interface CourseCardProps {
  course: Course
}

export function CourseCard({ course }: CourseCardProps) {
  const theme = getTheme(course.categoryKey)
  const categoryLabel = getCategoryLabel(course.categoryKey, course.subCategoryKey)

  return (
    <Link
      href={`/home/store/${course.id}`}
      className="group block w-full text-left rounded-xl border border-border bg-card overflow-hidden hover:border-accent/50 hover:shadow-lg transition-all"
    >
      {/* Cover */}
      {course.coverUrl ? (
        <div className="relative aspect-[16/10] overflow-hidden">
          <img src={course.coverUrl} alt={course.title} className="w-full h-full object-cover" />
          {course.source === "official" && (
            <span className="absolute top-2.5 left-2.5 rounded-full bg-foreground/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-foreground/90">
              官方
            </span>
          )}
        </div>
      ) : (
        /* Generated cover */
        <div
          className="relative aspect-[16/10] flex flex-col justify-between p-4 overflow-hidden select-none"
          style={{ background: theme.bg }}
        >
          {/* Subtle texture dots */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: `radial-gradient(circle, ${theme.accent} 1px, transparent 1px)`,
              backgroundSize: "16px 16px",
            }}
          />

          {/* Top row: category badge + source badge */}
          <div className="relative z-10 flex items-center gap-2">
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide"
              style={{ background: theme.badge, color: theme.accent }}
            >
              {categoryLabel}
            </span>
            {course.source === "official" && (
              <span className="rounded-full bg-white/10 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/70">
                官方
              </span>
            )}
          </div>

          {/* Middle: course title */}
          <div className="relative z-10 flex-1 flex items-center">
            <h3
              className="text-sm font-bold leading-snug line-clamp-2"
              style={{ color: theme.text }}
            >
              {course.title}
            </h3>
          </div>

          {/* Bottom: creator name */}
          <div className="relative z-10 flex items-center gap-1.5">
            <span className="text-[10px] font-medium opacity-50" style={{ color: theme.text }}>
              {course.sourceName}
            </span>
            {/* Decorative line */}
            <div className="flex-1 h-px opacity-10" style={{ background: theme.text }} />
          </div>
        </div>
      )}

      {/* Info */}
      <div className="p-3.5 space-y-2.5">
        <h3 className="text-sm font-medium text-foreground truncate leading-snug">
          {course.title}
        </h3>

        <div className="flex items-center justify-between">
          {/* Source */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div className={cn(
              "flex items-center justify-center h-5 w-5 rounded-full shrink-0 text-[10px] font-bold",
              course.source === "official" ? "bg-accent text-white" : "bg-muted text-muted-foreground"
            )}>
              {course.source === "official" ? "官" : (course.sourceName || "U")[0]}
            </div>
            <span className="text-xs text-muted-foreground truncate">
              {course.sourceName}
            </span>
          </div>

          {/* Learner count */}
          <div className="flex items-center gap-1 shrink-0">
            <Users className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {formatLearnerCount(course.learnerCount)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
