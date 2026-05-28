"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import Link from "next/link"
import { animate, stagger } from "animejs"
import {
  Flame, BookOpen, ChevronRight, Zap,
  BarChart2, Clock, Check,
  CalendarDays, ArrowRight, Loader2,
  ChevronLeft, Trophy,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { YearlyHeatmap } from "@/components/home/YearlyHeatmap"

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatsData {
  totalSentences: number
  totalDays: number
  streakDays: number
  todayCount: number
  pendingReviews: number
  checkedInToday: boolean
  heatmap: Record<string, number>
  weekly: { date: string; count: number }[]
  lastStudied: {
    courseId: string
    lessonId: string
    courseTitle: string
    lessonTitle: string
    studiedAt: string
  } | null
  checkInDatesThisMonth: string[]
}

interface HomeClientProps {
  name: string
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function toLocalDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function getHeatColor(count: number): string {
  if (count === 0) return "var(--heat-empty)"
  if (count <= 2) return "rgba(124,58,237,0.35)"
  if (count <= 5) return "rgba(124,58,237,0.58)"
  if (count <= 10) return "rgba(139,92,246,0.78)"
  return "rgba(167,139,250,0.95)"
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(diff / 86400000)
  return `${days}天前`
}

function getWeekDayShort(dateStr: string): string {
  const labels = ["日", "一", "二", "三", "四", "五", "六"]
  return labels[new Date(dateStr + "T12:00:00").getDay()]
}

// ─── Count-up hook ────────────────────────────────────────────────────────────

function useCountUp(target: number, enabled: boolean, duration = 1400) {
  const [value, setValue] = useState(0)
  const objRef = useRef({ val: 0 })

  useEffect(() => {
    if (!enabled || target === 0) { setValue(target); return }
    objRef.current.val = 0
    animate(objRef.current, {
      val: target,
      duration,
      ease: "out(3)",
      onUpdate: () => setValue(Math.round(objRef.current.val)),
    })
  }, [target, enabled, duration])

  return value
}

// ─── Monthly Check-In Calendar ────────────────────────────────────────────────

function MonthlyCheckInCalendar({
  checkInDates,
  checkedInToday,
}: {
  checkInDates: string[]
  checkedInToday: boolean
}) {
  const [offset, setOffset] = useState(0)
  const checkInSet = useMemo(() => new Set(checkInDates), [checkInDates])

  const { year, month, days } = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
    const y = d.getFullYear()
    const m = d.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const firstDow = new Date(y, m, 1).getDay()
    const startPad = firstDow === 0 ? 6 : firstDow - 1
    const cells: { date: string | null; day: number | null; isCheckedIn: boolean; isToday: boolean; isFuture: boolean }[] = []
    for (let i = 0; i < startPad; i++) cells.push({ date: null, day: null, isCheckedIn: false, isToday: false, isFuture: false })
    const today = toLocalDateStr()
    for (let n = 1; n <= daysInMonth; n++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`
      const isToday = dateStr === today
      const isFuture = dateStr > today
      const isCheckedIn = isToday ? checkedInToday : checkInSet.has(dateStr)
      cells.push({ date: dateStr, day: n, isCheckedIn, isToday, isFuture })
    }
    return { year: y, month: m, days: cells }
  }, [offset, checkInSet, checkedInToday])

  const monthName = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"][month]
  const cellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!cellRef.current) return
    const cells = cellRef.current.querySelectorAll(".checkin-cell")
    animate(cells, {
      opacity: [0, 1],
      scale: [0.6, 1],
      duration: 240,
      delay: stagger(14, { start: 0 }),
      ease: "out(3)",
    })
  }, [offset])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setOffset((o) => o - 1)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.06] transition-all"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-foreground/70">{year}年 {monthName}</span>
        <button
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset === 0}
          className={cn(
            "w-7 h-7 flex items-center justify-center rounded-lg transition-all",
            offset === 0 ? "text-foreground/15 cursor-default" : "text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.06]"
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {["一","二","三","四","五","六","日"].map((l) => (
          <div key={l} className="text-center text-[10px] text-foreground/25 font-medium">{l}</div>
        ))}
      </div>

      <div ref={cellRef} className="grid grid-cols-7 gap-1">
        {days.map((cell, i) =>
          cell.date === null ? (
            <div key={`pad-${i}`} />
          ) : (
            <div
              key={cell.date}
              className={cn(
                "checkin-cell w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-semibold mx-auto transition-all",
                cell.isCheckedIn
                  ? cell.isToday
                    ? "bg-emerald-500/35 border border-emerald-400/50 text-emerald-200"
                    : "bg-violet-500/40 border border-violet-400/50 text-violet-200"
                  : cell.isToday
                  ? "border border-foreground/30 text-foreground/60"
                  : cell.isFuture
                  ? "text-foreground/10"
                  : "text-foreground/20"
              )}
              title={cell.date}
            >
              {cell.day}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ─── Monthly Heatmap (right column) ──────────────────────────────────────────

function MonthlyHeatmap({ heatmap }: { heatmap: Record<string, number> }) {
  const [offset, setOffset] = useState(0)

  const { year, month, days } = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
    const y = d.getFullYear()
    const m = d.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const firstDow = new Date(y, m, 1).getDay()
    const startPad = firstDow === 0 ? 6 : firstDow - 1
    const cells: { date: string | null; count: number; day: number | null }[] = []
    for (let i = 0; i < startPad; i++) cells.push({ date: null, count: 0, day: null })
    for (let n = 1; n <= daysInMonth; n++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`
      cells.push({ date: dateStr, count: heatmap[dateStr] ?? 0, day: n })
    }
    return { year: y, month: m, days: cells }
  }, [offset, heatmap])

  const today = toLocalDateStr()
  const monthName = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"][month]
  const cellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!cellRef.current) return
    const cells = cellRef.current.querySelectorAll(".heat-cell-m")
    animate(cells, {
      opacity: [0, 1],
      scale: [0.5, 1],
      duration: 220,
      delay: stagger(12, { start: 0 }),
      ease: "out(3)",
    })
  }, [offset])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setOffset((o) => o - 1)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.06] transition-all"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-semibold text-foreground/60">{year}年 {monthName}</span>
        <button
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset === 0}
          className={cn(
            "w-7 h-7 flex items-center justify-center rounded-lg transition-all",
            offset === 0 ? "text-foreground/15 cursor-default" : "text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.06]"
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1.5">
        {["一","二","三","四","五","六","日"].map((l) => (
          <div key={l} className="text-center text-[9px] text-foreground/25 font-medium">{l}</div>
        ))}
      </div>
      <div ref={cellRef} className="grid grid-cols-7 gap-y-1 gap-x-0.5">
        {days.map((cell, i) =>
          cell.date === null ? (
            <div key={`pad-${i}`} />
          ) : (
            <div
              key={cell.date}
              className={cn(
                "heat-cell-m aspect-square rounded-md flex items-center justify-center text-[10px] font-medium",
                cell.date === today ? "ring-1 ring-violet-400/70 ring-offset-1 ring-offset-background" : ""
              )}
              style={{
                background: cell.count > 0 ? getHeatColor(cell.count) : "var(--heat-empty)",
                color: cell.count > 0 ? "var(--heat-cell-text)" : "var(--heat-cell-text-empty)",
              }}
              title={`${cell.date}: ${cell.count} 句`}
            >
              {cell.day}
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-1 mt-2 justify-end">
        <span className="text-[9px] text-foreground/20">少</span>
        {[0, 2, 5, 10, 15].map((v) => (
          <div key={v} className="w-2.5 h-2.5 rounded-sm" style={{ background: getHeatColor(v) }} />
        ))}
        <span className="text-[9px] text-foreground/20">多</span>
      </div>
    </div>
  )
}

// ─── Weekly Bar Chart ─────────────────────────────────────────────────────────

function WeeklyChart({ weekly }: { weekly: { date: string; count: number }[] }) {
  const max = Math.max(...weekly.map((w) => w.count), 1)
  const barsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!barsRef.current) return
    const bars = barsRef.current.querySelectorAll(".week-bar")
    animate(bars, {
      scaleY: [0, 1],
      opacity: [0, 1],
      duration: 600,
      delay: stagger(60, { start: 200 }),
      ease: "out(3)",
    })
  }, [weekly])

  return (
    <div ref={barsRef} className="flex items-end justify-between gap-2 h-28">
      {weekly.map((w, i) => {
        const pct = Math.max((w.count / max) * 100, w.count > 0 ? 8 : 2)
        const isToday = w.date === toLocalDateStr()
        return (
          <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
            {w.count > 0 && (
              <span className="text-[10px] font-mono text-foreground/40">{w.count}</span>
            )}
            <div
              className="week-bar w-full rounded-t-[5px] origin-bottom"
              style={{
                height: `${pct}%`,
                minHeight: 3,
                background: isToday
                  ? "linear-gradient(to top, #7c3aed, #ec4899)"
                  : w.count > 0
                  ? "linear-gradient(to top, rgba(124,58,237,0.5), rgba(124,58,237,0.3))"
                  : "var(--bar-empty)",
              }}
            />
            <span className={cn("text-[10px]", isToday ? "text-violet-400 font-semibold" : "text-foreground/25")}>
              {getWeekDayShort(w.date)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function HomeClient({ name }: HomeClientProps) {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkedIn, setCheckedIn] = useState(false)
  const [streak, setStreak] = useState(0)
  const [checkInDatesThisMonth, setCheckInDatesThisMonth] = useState<string[]>([])

  const checkInBtnRef = useRef<HTMLButtonElement>(null)
  const streakRef = useRef<HTMLSpanElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  const animEnabled = !!stats

  const totalCount = useCountUp(stats?.totalSentences ?? 0, animEnabled)
  const totalDays = useCountUp(stats?.totalDays ?? 0, animEnabled)
  const pendingCount = useCountUp(stats?.pendingReviews ?? 0, animEnabled)

  useEffect(() => {
    fetch("/api/home/stats")
      .then((r) => r.json())
      .then((d: StatsData) => {
        setStats(d)
        setCheckedIn(d.checkedInToday)
        setStreak(d.streakDays)
        setCheckInDatesThisMonth(d.checkInDatesThisMonth ?? [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!stats || !pageRef.current) return
    const cards = pageRef.current.querySelectorAll(".anim-card")
    animate(cards, {
      translateY: [24, 0],
      opacity: [0, 1],
      duration: 550,
      delay: stagger(70, { start: 100 }),
      ease: "out(3)",
    })
  }, [stats])

  const handleCheckIn = useCallback(async () => {
    if (checkedIn || checkingIn) return
    setCheckingIn(true)
    try {
      const res = await fetch("/api/home/check-in", { method: "POST" })
      const data = await res.json()
      if (data.success) {
        setCheckedIn(true)
        setStreak(data.streakDays)

        const todayStr = toLocalDateStr()
        setCheckInDatesThisMonth((prev) => prev.includes(todayStr) ? prev : [...prev, todayStr])

        if (checkInBtnRef.current) {
          animate(checkInBtnRef.current, {
            scale: [1, 1.18, 0.94, 1.06, 1],
            duration: 550,
            ease: "out(2)",
          })
        }
        if (streakRef.current) {
          animate(streakRef.current, {
            scale: [1, 1.45, 0.9, 1.1, 1],
            duration: 700,
            ease: "out(2)",
          })
        }
      }
    } finally {
      setCheckingIn(false)
    }
  }, [checkedIn, checkingIn])

  const today = new Date()
  const greetings = ["早上好", "上午好", "下午好", "晚上好"]
  const hour = today.getHours()
  const greeting = hour < 9 ? greetings[0] : hour < 12 ? greetings[1] : hour < 18 ? greetings[2] : greetings[3]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
          <p className="text-muted-foreground text-sm">加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={pageRef} className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5 max-w-7xl mx-auto">

        {/* ── Greeting Banner (always dark, intentional gradient) ── */}
        <div
          className="anim-card relative overflow-hidden rounded-2xl px-6 py-6"
          style={{
            background: "linear-gradient(135deg, #1e1b4b 0%, #2d1b69 50%, #0f172a 100%)",
            boxShadow: "0 0 60px rgba(124,58,237,0.2)",
          }}
        >
          <div className="absolute -top-10 -left-10 w-56 h-56 rounded-full blur-3xl pointer-events-none opacity-30"
            style={{ background: "radial-gradient(circle, #7c3aed, transparent 70%)" }} />
          <div className="absolute -bottom-8 right-10 w-40 h-40 rounded-full blur-3xl pointer-events-none opacity-20"
            style={{ background: "radial-gradient(circle, #a855f7, transparent 70%)" }} />

          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-violet-300/70 text-sm font-medium mb-0.5">{greeting}，</p>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">{name || "同学"}</h1>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stats?.todayCount !== undefined && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] border border-white/[0.12] px-3 py-1.5 backdrop-blur-sm">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[13px] font-semibold text-white/80">今日 {stats.todayCount} 句</span>
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] border border-white/[0.12] px-3 py-1.5 backdrop-blur-sm">
                <Flame className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[13px] font-semibold text-white/80">连续 {streak} 天</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Two-column grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

          {/* ── Left column ── */}
          <div className="space-y-5">

            {/* Streak + check-in card */}
            <div
              className="anim-card relative overflow-hidden rounded-2xl border p-5"
              style={{
                background: "var(--surface-violet)",
                borderColor: "var(--surface-violet-border)",
              }}
            >
              <div className="relative flex items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3.5">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/20 shrink-0">
                    <Flame className="h-6 w-6 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-foreground/40 text-[11px] font-medium tracking-wider uppercase">连续打卡</p>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span
                        ref={streakRef}
                        className="text-5xl font-black tabular-nums"
                        style={{ background: "linear-gradient(135deg, #a78bfa, #ec4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                      >
                        {streak}
                      </span>
                      <span className="text-foreground/40 text-sm font-medium">天</span>
                    </div>
                  </div>
                </div>

                <button
                  ref={checkInBtnRef}
                  onClick={handleCheckIn}
                  disabled={checkedIn || checkingIn}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 shrink-0",
                    checkedIn
                      ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 cursor-default"
                      : "border text-white hover:opacity-90 active:scale-95"
                  )}
                  style={checkedIn ? {} : {
                    background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                    borderColor: "rgba(167,139,250,0.4)",
                    boxShadow: "0 0 20px rgba(124,58,237,0.35)",
                  }}
                >
                  {checkingIn ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : checkedIn ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <CalendarDays className="h-4 w-4" />
                  )}
                  {checkedIn ? "已签到" : "签到打卡"}
                </button>
              </div>

              {/* Monthly check-in calendar */}
              <div className="border-t pt-4" style={{ borderColor: "var(--surface-divider)" }}>
                <MonthlyCheckInCalendar
                  checkInDates={checkInDatesThisMonth}
                  checkedInToday={checkedIn}
                />
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "累计练习",
                  value: totalCount,
                  unit: "句",
                  icon: BookOpen,
                  iconColor: "text-violet-400",
                  iconBg: "rgba(124,58,237,0.15)",
                  gradient: "linear-gradient(135deg, #a78bfa, #7c3aed)",
                },
                {
                  label: "学习天数",
                  value: totalDays,
                  unit: "天",
                  icon: BarChart2,
                  iconColor: "text-blue-400",
                  iconBg: "rgba(59,130,246,0.15)",
                  gradient: "linear-gradient(135deg, #60a5fa, #06b6d4)",
                },
                {
                  label: "待复习",
                  value: pendingCount,
                  unit: "项",
                  icon: Clock,
                  iconColor: "text-amber-400",
                  iconBg: "rgba(245,158,11,0.15)",
                  gradient: "linear-gradient(135deg, #fbbf24, #f97316)",
                  link: "/home/review",
                },
              ].map(({ label, value, unit, icon: Icon, iconColor, iconBg, gradient, link }) => {
                const inner = (
                  <div
                    className="anim-card h-full rounded-2xl border p-4 flex flex-col gap-3 transition-colors"
                    style={{
                      background: "var(--surface)",
                      borderColor: "var(--surface-border)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-foreground/35 font-medium">{label}</p>
                      <div className="p-1.5 rounded-lg" style={{ background: iconBg }}>
                        <Icon className={cn("h-3.5 w-3.5", iconColor)} />
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span
                        className="text-2xl font-black tabular-nums"
                        style={{ background: gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                      >
                        {value}
                      </span>
                      <span className="text-foreground/30 text-xs">{unit}</span>
                    </div>
                  </div>
                )
                return link
                  ? <Link key={label} href={link} className="block">{inner}</Link>
                  : <div key={label}>{inner}</div>
              })}
            </div>

            {/* Weekly trend */}
            {stats && (
              <div
                className="anim-card rounded-2xl border p-5"
                style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-violet-400" />
                    <h3 className="text-sm font-semibold text-foreground/70">本周趋势</h3>
                  </div>
                  <span className="text-[11px] text-foreground/25 font-mono">
                    共 {stats.weekly.reduce((s, w) => s + w.count, 0)} 句
                  </span>
                </div>
                <WeeklyChart weekly={stats.weekly} />
              </div>
            )}

          </div>

          {/* ── Right column ── */}
          <div className="space-y-5">

            {/* Monthly heatmap */}
            <div
              className="anim-card rounded-2xl border p-5"
              style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-foreground/70">学习热力图</h3>
              </div>
              {stats && <MonthlyHeatmap heatmap={stats.heatmap} />}
            </div>

            {/* Continue studying */}
            {stats?.lastStudied && (
              <Link
                href={`/home/learn/${stats.lastStudied.courseId}?lesson=${stats.lastStudied.lessonId}`}
                className="anim-card group block rounded-2xl border hover:border-violet-500/40 transition-all duration-300 overflow-hidden"
                style={{ background: "var(--surface)", borderColor: "var(--surface-border)" }}
              >
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 shrink-0">
                      <BookOpen className="h-5 w-5 text-violet-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-foreground/35 font-medium mb-0.5">继续上次学习</p>
                      <p className="text-sm font-semibold text-foreground truncate">{stats.lastStudied.courseTitle}</p>
                      <p className="text-[12px] text-foreground/40 truncate mt-0.5">{stats.lastStudied.lessonTitle}</p>
                    </div>
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-violet-500/15 group-hover:bg-violet-500/25 transition-colors shrink-0">
                      <ArrowRight className="h-4 w-4 text-violet-400" />
                    </div>
                  </div>
                  <p className="text-[11px] text-foreground/20 mt-3">{relativeTime(stats.lastStudied.studiedAt)}</p>
                </div>
              </Link>
            )}

            {/* Yearly heatmap */}
            <div
              className="anim-card rounded-2xl border p-5"
              style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-foreground/70">年度热力图</h3>
              </div>
              {stats && <YearlyHeatmap heatmap={stats.heatmap} />}
            </div>

            {/* Store link */}
            <Link
              href="/home/store"
              className="anim-card flex items-center justify-between rounded-2xl border hover:border-violet-500/40 px-5 py-4 transition-all group"
              style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
            >
              <span className="text-sm text-foreground/50 group-hover:text-foreground/70 transition-colors">浏览课程商城</span>
              <ChevronRight className="h-4 w-4 text-foreground/25 group-hover:text-violet-400 transition-colors" />
            </Link>

          </div>
        </div>

      </div>
    </div>
  )
}
