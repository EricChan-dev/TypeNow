"use client"

import { TrendingUp, Repeat, Zap } from "lucide-react"

interface ProgressCardProps {
  todayPracticed: number
  todayReviewed: number
  streak: number
}

export function ProgressCard({ todayPracticed, todayReviewed, streak }: ProgressCardProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
      <div className="rounded-xl border border-border bg-card p-3 sm:p-5 flex items-center gap-3 sm:gap-4">
        <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
          <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-accent" />
        </div>
        <div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums">{todayPracticed}</p>
          <p className="text-xs sm:text-sm text-muted-foreground">今日已练（句）</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 sm:p-5 flex items-center gap-3 sm:gap-4">
        <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
          <Repeat className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-500" />
        </div>
        <div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums">{todayReviewed}</p>
          <p className="text-xs sm:text-sm text-muted-foreground">今日已复习（句）</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 sm:p-5 flex items-center gap-3 sm:gap-4">
        <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
          <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500" />
        </div>
        <div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums">{streak}</p>
          <p className="text-xs sm:text-sm text-muted-foreground">连续打卡（天）</p>
        </div>
      </div>
    </div>
  )
}
