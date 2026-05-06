"use client"

import { Users } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { Course } from "@/types/course"

function formatLearnerCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function getCoverGradient(categoryKey: string, subCategoryKey: string): string {
  const seed = (categoryKey + subCategoryKey).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const hue = seed % 360
  return `linear-gradient(135deg, hsl(${hue}, 50%, 35%) 0%, hsl(${(hue + 40) % 360}, 45%, 25%) 100%)`
}

interface CourseCardProps {
  course: Course
}

export function CourseCard({ course }: CourseCardProps) {
  const coverGradient = getCoverGradient(course.categoryKey, course.subCategoryKey)

  return (
    <button
      onClick={() => toast("即将上线", { description: "课程详情页正在开发中…" })}
      className="group w-full text-left rounded-xl border border-border bg-card overflow-hidden hover:border-accent/50 hover:shadow-lg transition-all"
    >
      {/* Cover */}
      <div
        className="relative aspect-[16/10] flex items-center justify-center"
        style={{ background: coverGradient }}
      >
        <span className="text-white/25 text-4xl font-extrabold tracking-wider select-none">
          {course.title.slice(0, 4)}
        </span>
        {course.source === "official" && (
          <span className="absolute top-2.5 left-2.5 rounded-full bg-white/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/90">
            官方
          </span>
        )}
      </div>

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
    </button>
  )
}
