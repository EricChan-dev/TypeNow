"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { BookMarked, ChevronRight, Loader2, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { masteryLabel, fmtDate } from "@/lib/review-utils"

type TabKey = "due" | "done" | "all"

interface ReviewItem {
  reviewId: string
  sentenceId: string
  status: string
  intervalDays: number
  consecutiveOk: number
  reviewCount: number
  nextReviewAt: string | null
  createdAt: string
  english: string
  chinese: string
  courseId: string | null
  courseTitle: string | null
}

interface Stats {
  dueCount: number
  doneCount: number
  allCount: number
}


const TABS: { key: TabKey; label: string }[] = [
  { key: "due", label: "今日待复习" },
  { key: "done", label: "已掌握" },
  { key: "all", label: "全部" },
]

export function ReviewNotebook() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>("due")
  const [items, setItems] = useState<ReviewItem[]>([])
  const [stats, setStats] = useState<Stats>({ dueCount: 0, doneCount: 0, allCount: 0 })
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState<string | null>(null)

  const load = useCallback(async (t: TabKey) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/review/list?status=${t}&pageSize=100`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items ?? [])
      setStats({ dueCount: data.dueCount ?? 0, doneCount: data.doneCount ?? 0, allCount: data.allCount ?? 0 })
    } catch { /* silently handled — shows empty list */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  const resetToReview = useCallback(async (sentenceId: string) => {
    setResetting(sentenceId)
    await fetch("/api/review/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentenceId, forceReset: true }),
    }).catch(() => {})
    await load(tab)
    setResetting(null)
  }, [tab, load])

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <BookMarked className="h-5 w-5 text-violet-400" />
          <h1 className="text-lg font-bold text-foreground/80">复习本</h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-foreground/40">
          <span>今日待复习 <span className="font-bold text-amber-400">{stats.dueCount}</span></span>
          <span>·</span>
          <span>已掌握 <span className="font-bold text-emerald-400">{stats.doneCount}</span></span>
          <span>·</span>
          <span>共 <span className="font-bold text-foreground/60">{stats.allCount}</span> 句</span>
        </div>
        <button
          onClick={() => router.push("/home/review/session")}
          disabled={stats.dueCount === 0}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
            stats.dueCount > 0
              ? "bg-violet-600 text-white hover:bg-violet-500"
              : "bg-foreground/5 text-foreground/25 cursor-not-allowed"
          )}
        >
          开始今日复习
          {stats.dueCount > 0 && <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl p-1 w-fit" style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200",
              tab === key ? "bg-violet-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            {key === "due" && stats.dueCount > 0 && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{stats.dueCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 text-violet-400 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <BookMarked className="h-10 w-10 text-foreground/15" />
          <p className="text-foreground/35 text-sm">
            {tab === "due" ? "今日无待复习内容" : tab === "done" ? "还没有已掌握的句子" : "暂无数据"}
          </p>
        </div>
      ) : (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid var(--surface-border)" }}
        >
          {items.map((item, i) => {
            const mastery = masteryLabel(item)
            return (
              <div
                key={item.reviewId}
                className={cn(
                  "flex items-center gap-5 px-6 py-4 transition-colors",
                  i !== 0 && "border-t",
                  "hover:bg-foreground/[0.02]"
                )}
                style={i !== 0 ? { borderColor: "var(--surface-border)" } : undefined}
              >
                {/* Text block */}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-foreground/80 truncate">{item.chinese}</p>
                  <p className="text-xs text-foreground/40 truncate">{item.english}</p>
                </div>

                {/* Course */}
                {item.courseTitle && item.courseId ? (
                  <button
                    onClick={() => router.push(`/home/store/${item.courseId}`)}
                    className="shrink-0 text-[11px] text-foreground/35 hover:text-violet-400 transition-colors max-w-[120px] truncate"
                  >
                    {item.courseTitle}
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-foreground/20 max-w-[120px] truncate">—</span>
                )}

                {/* Mastery badge */}
                <span className={cn("shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border", mastery.color)}>
                  {mastery.label}
                </span>

                {/* Next review / action */}
                {item.status === "done" ? (
                  <button
                    onClick={() => resetToReview(item.sentenceId)}
                    disabled={resetting === item.sentenceId}
                    className="shrink-0 flex items-center gap-1 text-[11px] text-foreground/30 hover:text-amber-400 transition-colors"
                    title="重新加入复习"
                  >
                    <RotateCcw className={cn("h-3 w-3", resetting === item.sentenceId && "animate-spin")} />
                    再练一次
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-foreground/30">
                    {fmtDate(item.nextReviewAt)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
    </div>
  )
}
