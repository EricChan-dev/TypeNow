"use client"

import { TrendingUp, Repeat, Zap } from "lucide-react"

export function ProgressCard() {
  // Mock data - will be replaced with real data from Supabase
  const stats = {
    todayPracticed: 0,
    todayReviewed: 0,
    streak: 0,
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
          <Zap className="h-5 w-5 text-accent" />
        </div>
        <div>
          <p className="text-2xl font-bold">{stats.todayPracticed}</p>
          <p className="text-sm text-muted-foreground">今日已练（句）</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10">
          <Repeat className="h-5 w-5 text-success" />
        </div>
        <div>
          <p className="text-2xl font-bold">{stats.todayReviewed}</p>
          <p className="text-sm text-muted-foreground">今日已复习（句）</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/10">
          <TrendingUp className="h-5 w-5 text-warning" />
        </div>
        <div>
          <p className="text-2xl font-bold">{stats.streak}</p>
          <p className="text-sm text-muted-foreground">连续打卡（天）</p>
        </div>
      </div>
    </div>
  )
}
