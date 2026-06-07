"use client"

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { animate, stagger } from "animejs"
import {
  Flame, BookOpen, ChevronRight, Zap,
  BarChart2, Clock, Check,
  CalendarDays, ArrowRight, Loader2,
  ChevronLeft, Trophy, HelpCircle,
  Smartphone, X, MessageCircle,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ArchivePanel } from "@/components/home/ArchiveClient"
import { CheckInRulesModal } from "@/components/home/CheckInRulesModal"
import { GlobalSettingsModal } from "@/components/home/GlobalSettingsModal"
import { WelcomeTrialModal } from "@/components/home/WelcomeTrialModal"
import { DailyTasks } from "@/components/home/DailyTasks"
import { PaymentSuccessModal } from "@/components/payment/PaymentSuccessModal"

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatsData {
  totalSentences: number
  totalDays: number
  streakDays: number
  todayCount: number
  pendingReviews: number
  checkedInToday: boolean
  heatmap: Record<string, number>
  heatmapDuration: Record<string, number>
  weekly: { date: string; count: number }[]
  lastStudied: {
    courseId: string
    lessonId: string
    courseTitle: string
    lessonTitle: string
    studiedAt: string
  } | null
  checkInDatesThisMonth: string[]
  todayDiamonds: number
  checkInGoal: number
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
  if (count <= 20) return "var(--heat-low)"
  if (count <= 60) return "var(--heat-mid)"
  if (count <= 100) return "var(--heat-high)"
  return "var(--heat-max)"
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}分钟`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hours}小时${rem}分钟` : `${hours}小时`
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

// Rainbow bar colors — one per day of week
const BAR_COLORS = ["#8b5cf6", "#ec4899", "#f59e0b", "#06b6d4", "#34d399", "#f97316", "#a78bfa"]

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
                "checkin-cell rounded-lg flex items-center justify-center font-semibold mx-auto transition-all",
                cell.isToday
                  ? "w-8 flex-col gap-px py-1.5"
                  : "w-8 h-8 text-[12px]"
              )}
              style={
                cell.isCheckedIn
                  ? cell.isToday
                    ? { background: "var(--cal-today-bg)", color: "var(--cal-today-text)", border: "2px solid #0e7490" }
                    : { background: "var(--cal-checkin-bg)", color: "var(--cal-checkin-text)", border: "1px solid var(--cal-checkin-text)" }
                  : cell.isToday
                  ? { border: "2px solid var(--accent)", color: "var(--accent)" }
                  : cell.isFuture
                  ? { color: "var(--heat-cell-text-empty)" }
                  : { color: "var(--heat-cell-text-empty)" }
              }
              title={cell.date}
            >
              <span className="text-[12px] leading-none">{cell.day}</span>
              {cell.isToday && (
                <span className="text-[6px] font-bold leading-none tracking-wide">今日</span>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ─── Monthly Heatmap (right column) ──────────────────────────────────────────

function MonthlyHeatmap({ heatmap, heatmapDuration }: { heatmap: Record<string, number>; heatmapDuration: Record<string, number> }) {
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
                cell.date === today ? "ring-1 ring-violet-400/70 ring-offset-1 ring-offset-[var(--background)]" : ""
              )}
              style={{
                background: cell.count > 0 ? getHeatColor(cell.count) : "var(--heat-empty)",
                color: cell.count > 0 ? "var(--heat-cell-text)" : "var(--heat-cell-text-empty)",
              }}
              title={cell.count > 0 ? `${cell.count} 颗钻石 · 学了 ${formatDuration(heatmapDuration[cell.date ?? ""] ?? 0)}` : (cell.date ?? "")}
            >
              {cell.day}
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-1 mt-2 justify-end">
        <span className="text-[9px] text-foreground/20">少</span>
        {[0, 20, 60, 100, 150].map((v) => (
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
        const color = BAR_COLORS[i % BAR_COLORS.length]
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
                  ? `linear-gradient(to top, ${color}, ${color}cc)`
                  : w.count > 0
                  ? `linear-gradient(to top, ${color}80, ${color}50)`
                  : "var(--bar-empty)",
                boxShadow: isToday ? `0 0 10px ${color}60` : undefined,
              }}
            />
            <span className={cn("text-[10px]", isToday ? "font-semibold" : "text-foreground/25")}
              style={isToday ? { color } : undefined}
            >
              {getWeekDayShort(w.date)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── WeChat Login Banner (uses useSearchParams, needs Suspense) ─────────────

function WeChatLoginBanner() {
  const searchParams = useSearchParams()
  const cleanedRef = useRef(false)

  useEffect(() => {
    const loginSuccess = searchParams.get("login_success")
    if (loginSuccess === "wechat") {
      toast.success("微信登录成功")
    }
    // Clean URL params once
    if (!cleanedRef.current && loginSuccess) {
      cleanedRef.current = true
      const url = new URL(window.location.href)
      url.searchParams.delete("login_success")
      url.searchParams.delete("new_user")
      url.searchParams.delete("follow_oa")
      window.history.replaceState({}, "", url.toString())
    }
  }, [searchParams])

  const followOA = searchParams.get("follow_oa")
  const newUser = searchParams.get("new_user")
  const loginSuccess = searchParams.get("login_success")

  // follow_oa=0 takes priority: show follow guidance regardless of new_user
  if (followOA === "0" && loginSuccess === "wechat") {
    return <FollowOABanner />
  }

  // new_user=1 (already following or not OA flow): show welcome trial modal + phone bind
  if (newUser === "1" && loginSuccess === "wechat") {
    return (
      <>
        <WelcomeTrialModal />
        <PhoneBindBanner />
      </>
    )
  }

  return null
}

function FollowOABanner() {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div
      className="anim-card relative overflow-hidden rounded-2xl border p-5"
      style={{
        background: "linear-gradient(135deg, #7c3aed08, #a855f708)",
        borderColor: "#7c3aed30",
      }}
    >
      <div className="flex items-center gap-4">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
          style={{ background: "#7c3aed18", border: "1px solid #7c3aed30" }}
        >
          <MessageCircle className="h-5 w-5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground/80">
            关注服务号，接收学习提醒
          </p>
          <p className="text-[12px] text-foreground/45 mt-0.5">
            打卡通知、复习提醒不再错过
          </p>
        </div>
        <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border bg-card">
          <img
            src="/qrcode-oa.jpg"
            alt="关注服务号"
            className="w-full h-full object-cover"
          />
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 p-1.5 rounded-lg text-foreground/25 hover:text-foreground/50 hover:bg-foreground/[0.06] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function PhoneBindBanner() {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div
      className="anim-card relative overflow-hidden rounded-2xl border p-5"
      style={{
        background: "linear-gradient(135deg, #7c3aed08, #a855f708)",
        borderColor: "#7c3aed30",
      }}
    >
      <div className="flex items-center gap-4">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
          style={{ background: "#7c3aed18", border: "1px solid #7c3aed30" }}
        >
          <Smartphone className="h-5 w-5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground/80">
            建议绑定手机号
          </p>
          <p className="text-[12px] text-foreground/45 mt-0.5">
            方便后续登录与找回账号
          </p>
        </div>
        <Link
          href="/home/settings"
          className="shrink-0 rounded-lg px-4 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
        >
          去绑定
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 p-1.5 rounded-lg text-foreground/25 hover:text-foreground/50 hover:bg-foreground/[0.06] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function HomeClient({ name }: HomeClientProps) {
  const [activeTab, setActiveTab] = useState<"today" | "archive">("today")
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkedIn, setCheckedIn] = useState(false)
  const [streak, setStreak] = useState(0)
  const [checkInDatesThisMonth, setCheckInDatesThisMonth] = useState<string[]>([])
  const [todayDiamonds, setTodayDiamonds] = useState(0)
  const [checkInGoal, setCheckInGoal] = useState(50)
  const [checkInRulesOpen, setCheckInRulesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
        setTodayDiamonds(d.todayDiamonds ?? 0)
        setCheckInGoal(d.checkInGoal ?? 50)
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
    if (todayDiamonds < checkInGoal) {
      setCheckInRulesOpen(true)
      return
    }
    setCheckingIn(true)
    try {
      const res = await fetch("/api/home/check-in", { method: "POST" })
      const data = await res.json()
      if (res.status === 403 && data.error === "need_more_diamonds") {
        const remaining = (data.checkInGoal ?? checkInGoal) - (data.todayDiamonds ?? todayDiamonds)
        toast.error(`还差 ${remaining} 颗钻石才能签到`)
        return
      }
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
  }, [checkedIn, checkingIn, todayDiamonds, checkInGoal])

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
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 pb-16 max-w-7xl mx-auto">

        {/* ── Tab switcher ── */}
        <div className="flex items-center gap-1 mb-5 rounded-xl p-1 w-fit" style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}>
          {(["today", "archive"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200",
                activeTab === tab
                  ? "bg-accent text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "today" ? "今日" : "档案"}
            </button>
          ))}
        </div>

        {activeTab === "archive" ? (
          <ArchivePanel />
        ) : (
        <div className="space-y-5">

        {/* ── Greeting Banner ── */}
        <div
          className="anim-card relative overflow-hidden rounded-2xl px-6 py-6"
          style={{
            background: "var(--banner-bg)",
            border: "1px solid var(--banner-border)",
          }}
        >
          <div
            className="absolute -top-12 -right-8 w-52 h-52 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, #7c3aed40, transparent 70%)" }}
          />
          <div
            className="absolute bottom-0 left-1/3 w-36 h-20 pointer-events-none"
            style={{ background: "radial-gradient(ellipse, #ec489920, transparent 70%)" }}
          />

          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium mb-0.5" style={{ color: "var(--banner-subtitle)" }}>{greeting}，</p>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: "var(--banner-title)" }}>{name || "同学"}</h1>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stats?.todayCount !== undefined && (
                <div
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                  style={{ background: "var(--banner-pill-today-bg)", border: "1px solid var(--banner-pill-today-border)" }}
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[13px] font-semibold" style={{ color: "var(--banner-pill-today-text)" }}>今日 {stats.todayCount} 句</span>
                </div>
              )}
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                style={{ background: "var(--banner-pill-streak-bg)", border: "1px solid var(--banner-pill-streak-border)" }}
              >
                <Flame className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[13px] font-semibold" style={{ color: "var(--banner-pill-streak-text)" }}>连续 {streak} 天</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── WeChat login feedback ── */}
        <Suspense fallback={null}>
          <WeChatLoginBanner />
        </Suspense>

        {/* ── Payment success modal ── */}
        <Suspense fallback={null}>
          <PaymentSuccessModal />
        </Suspense>

        {/* ── Stats row — full width above grid ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "累计练习",
              value: totalCount,
              unit: "句",
              icon: BookOpen,
              iconColor: "#ec4899",
              gradient: "linear-gradient(135deg, #f472b6, #ec4899)",
              bgVar: "var(--stat-1-bg)",
              borderVar: "var(--stat-1-border)",
              iconBgVar: "var(--stat-1-icon-bg)",
            },
            {
              label: "学习天数",
              value: totalDays,
              unit: "天",
              icon: BarChart2,
              iconColor: "#f59e0b",
              gradient: "linear-gradient(135deg, #fbbf24, #f59e0b)",
              bgVar: "var(--stat-2-bg)",
              borderVar: "var(--stat-2-border)",
              iconBgVar: "var(--stat-2-icon-bg)",
            },
            {
              label: "待复习",
              value: pendingCount,
              unit: "项",
              icon: Clock,
              iconColor: "#06b6d4",
              gradient: "linear-gradient(135deg, #22d3ee, #06b6d4)",
              bgVar: "var(--stat-3-bg)",
              borderVar: "var(--stat-3-border)",
              iconBgVar: "var(--stat-3-icon-bg)",
              link: "/home/review",
            },
          ].map(({ label, value, unit, icon: Icon, iconColor, gradient, bgVar, borderVar, iconBgVar, link }) => {
            const inner = (
              <div
                className="anim-card h-full rounded-2xl border p-5 flex flex-col gap-4 transition-colors"
                style={{ background: bgVar, borderColor: borderVar }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[13px] text-foreground/70 font-bold">{label}</p>
                  <div className="p-2 rounded-lg" style={{ background: iconBgVar }}>
                    <Icon className="h-[18px] w-[18px]" style={{ color: iconColor }} />
                  </div>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-3xl font-black tabular-nums"
                    style={{ background: gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                  >
                    {value}
                  </span>
                  <span className="text-foreground/55 text-sm">{unit}</span>
                </div>
              </div>
            )
            return link
              ? <Link key={label} href={link} className="block">{inner}</Link>
              : <div key={label}>{inner}</div>
          })}
        </div>

        {/* ── Two-column grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">

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
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0"
                    style={{ background: "var(--stat-2-icon-bg)", border: "1px solid var(--stat-2-border)" }}
                  >
                    <Flame className="h-6 w-6 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-foreground/65 text-[11px] font-bold tracking-wider uppercase">连续打卡</p>
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
                      ? "cursor-default bg-cyan-100 text-cyan-800 border border-cyan-300 dark:bg-cyan-900/40 dark:text-cyan-200 dark:border-cyan-700"
                      : !checkedIn && todayDiamonds < checkInGoal
                      ? "cursor-pointer opacity-70 border"
                      : "text-white hover:opacity-90 active:scale-95"
                  )}
                  style={checkedIn
                    ? undefined
                    : !checkedIn && todayDiamonds < checkInGoal
                    ? { background: "var(--muted)", borderColor: "var(--border)", color: "var(--muted-foreground)" }
                    : { background: "linear-gradient(135deg, #7c3aed, #a855f7)", border: "1px solid #6d28d9", boxShadow: "0 0 18px #7c3aed50" }
                  }
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

              {/* Diamond progress bar */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-foreground/70">
                    💎 {todayDiamonds} / {checkInGoal}
                  </span>
                  <button
                    onClick={() => setCheckInRulesOpen(true)}
                    className="flex items-center justify-center text-foreground/30 hover:text-foreground/60 transition-colors"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex-1" />
                  {!checkedIn && todayDiamonds < checkInGoal && (
                    <span className="text-[11px] text-muted-foreground/60">
                      还差 {checkInGoal - todayDiamonds} 颗可签到
                    </span>
                  )}
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (todayDiamonds / checkInGoal) * 100)}%`,
                      background: todayDiamonds >= checkInGoal
                        ? "linear-gradient(90deg, #22c55e, #16a34a)"
                        : "linear-gradient(90deg, #7c3aed, #a855f7)",
                    }}
                  />
                </div>
              </div>

              {/* Monthly check-in calendar */}
              <div className="border-t pt-4" style={{ borderColor: "var(--surface-divider)" }}>
                <MonthlyCheckInCalendar
                  checkInDates={checkInDatesThisMonth}
                  checkedInToday={checkedIn}
                />
              </div>
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
              {stats && <MonthlyHeatmap heatmap={stats.heatmap} heatmapDuration={stats.heatmapDuration ?? {}} />}
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
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                      style={{ background: "var(--surface-violet)", border: "1px solid var(--surface-violet-border)" }}
                    >
                      <BookOpen className="h-5 w-5 text-violet-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-foreground/65 font-bold mb-0.5">继续上次学习</p>
                      <p className="text-sm font-semibold text-foreground truncate">{stats.lastStudied.courseTitle}</p>
                      <p className="text-[12px] text-foreground/40 truncate mt-0.5">{stats.lastStudied.lessonTitle}</p>
                    </div>
                    <div
                      className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors"
                      style={{ background: "var(--surface-violet)" }}
                    >
                      <ArrowRight className="h-4 w-4 text-violet-400" />
                    </div>
                  </div>
                  <p className="text-[11px] text-foreground/20 mt-3">{relativeTime(stats.lastStudied.studiedAt)}</p>
                </div>
              </Link>
            )}

            {/* Daily tasks */}
            <DailyTasks />

            {/* Store link */}
            <Link
              href="/home/store"
              className="anim-card flex items-center justify-between rounded-2xl border hover:border-violet-500/40 px-5 py-4 transition-all group"
              style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
            >
              <span className="text-sm text-foreground/50 group-hover:text-foreground/70 transition-colors">浏览课程广场</span>
              <ChevronRight className="h-4 w-4 text-foreground/25 group-hover:text-violet-400 transition-colors" />
            </Link>

          </div>
        </div>
        </div>
        )}

      </div>

      <CheckInRulesModal
        open={checkInRulesOpen}
        onClose={() => setCheckInRulesOpen(false)}
        todayDiamonds={todayDiamonds}
        checkInGoal={checkInGoal}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <GlobalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialGoal={checkInGoal}
        onSaved={(g) => setCheckInGoal(g)}
      />
    </div>
  )
}
