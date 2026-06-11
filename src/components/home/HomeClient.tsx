"use client"

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { animate, stagger } from "animejs"
import {
  Flame, BookOpen, ChevronRight, Zap,
  BarChart2, Clock, Check,
  CalendarDays, Loader2,
  ChevronLeft, Trophy, HelpCircle,
  Smartphone, X, MessageCircle,
  FileText, BookText, ShoppingBag,
  Gift,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useCountUp } from "@/lib/hooks/useCountUp"
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
  recentPractices: {
    courseId: string
    lessonId: string
    courseTitle: string
    lessonTitle: string
    sentenceText: string
    studiedAt: string
  }[]
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
                  : { color: "var(--heat-cell-text-empty)", border: "1px dashed rgba(156,163,175,0.4)" }
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

// ─── Invite Card ──────────────────────────────────────────────────────────────

function InviteCard() {
  const [inviteData, setInviteData] = useState<{ inviteCode: string | null; inviteTotal: number } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch("/api/tasks/status")
      .then((r) => r.json())
      .then((d) => setInviteData({ inviteCode: d.inviteCode, inviteTotal: d.inviteTotal ?? 0 }))
      .catch(() => null)
  }, [])

  const inviteLink = inviteData?.inviteCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/register?ref=${inviteData.inviteCode}`
    : ""

  const handleCopy = () => {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true)
      toast.success("邀请链接已复制！")
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => null)
  }

  return (
    <div
      onClick={handleCopy}
      className="anim-card rounded-2xl border p-3.5 cursor-pointer hover:opacity-90 transition-all duration-200 active:scale-[0.98]"
      style={{ background: "var(--surface-violet)", borderColor: "var(--surface-violet-border)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
          style={{ background: "var(--stat-2-icon-bg)", border: "1px solid var(--stat-2-border)" }}
        >
          <Gift className="h-4 w-4 text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground/80">邀请好友</p>
          <p className="text-[10px] text-foreground/40 mt-0.5">
            {copied ? "链接已复制！" : "点击复制分享链接"}
          </p>
        </div>
        {inviteData && inviteData.inviteTotal > 0 && (
          <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
            已邀请 {inviteData.inviteTotal} 人
          </span>
        )}
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
  const [checkInVersion, setCheckInVersion] = useState(0)

  const checkInBtnRef = useRef<HTMLButtonElement>(null)
  const streakRef = useRef<HTMLSpanElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  const animEnabled = !!stats

  const totalCount = useCountUp(stats?.totalSentences ?? 0, animEnabled)
  const totalDays = useCountUp(stats?.totalDays ?? 0, animEnabled)
  const pendingCount = useCountUp(stats?.pendingReviews ?? 0, animEnabled)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/home/stats")
      const d: StatsData = await res.json()
      setStats(d)
      setCheckedIn(d.checkedInToday)
      setStreak(d.streakDays)
      setCheckInDatesThisMonth(d.checkInDatesThisMonth ?? [])
      setTodayDiamonds(d.todayDiamonds ?? 0)
      setCheckInGoal(d.checkInGoal ?? 50)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    fetchStats().finally(() => setLoading(false))
  }, [fetchStats])

  // Refresh data when user returns to the page (visibility change or focus)
  // Debounced to avoid duplicate calls from rapid focus+visibility events
  useEffect(() => {
    let lastRefresh = 0
    const refresh = () => {
      const now = Date.now()
      if (now - lastRefresh < 5000) return // 5s debounce
      lastRefresh = now
      fetchStats()
    }
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [fetchStats])

  // Animation — useLayoutEffect to set invisible BEFORE paint, then animate in
  useLayoutEffect(() => {
    if (!stats || !pageRef.current) return
    const cards = Array.from(pageRef.current.querySelectorAll(".anim-card") as NodeListOf<HTMLElement>)
    cards.forEach((c) => { c.style.opacity = "0"; c.style.transform = "translateY(24px)" })
    requestAnimationFrame(() => {
      animate(cards, {
        translateY: [24, 0],
        opacity: [0, 1],
        duration: 550,
        delay: stagger(70, { start: 100 }),
        ease: "out(3)",
      })
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
        setCheckInVersion((v) => v + 1)

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

        {/* ── Tab switcher + greeting ── */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}>
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
          {activeTab === "today" && (
            <div className="flex items-center gap-2 sm:gap-4">
              <span className="hidden sm:inline text-sm font-medium text-foreground/60">
                {greeting}，<span className="font-bold text-foreground/80">{name || "同学"}</span>
              </span>
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                {stats?.todayCount !== undefined && (
                  <div
                    className="inline-flex items-center gap-1 sm:gap-1.5 rounded-full px-2 sm:px-2.5 py-1"
                    style={{ background: "var(--banner-pill-today-bg)", border: "1px solid var(--banner-pill-today-border)" }}
                  >
                    <Zap className="h-3 w-3 text-amber-400" />
                    <span className="text-[11px] sm:text-[12px] font-semibold" style={{ color: "var(--banner-pill-today-text)" }}>今日 {stats.todayCount} 句</span>
                  </div>
                )}
                <div
                  className="inline-flex items-center gap-1 sm:gap-1.5 rounded-full px-2 sm:px-2.5 py-1"
                  style={{ background: "var(--banner-pill-streak-bg)", border: "1px solid var(--banner-pill-streak-border)" }}
                >
                  <Flame className="h-3 w-3 text-amber-400" />
                  <span className="text-[11px] sm:text-[12px] font-semibold" style={{ color: "var(--banner-pill-streak-text)" }}>连续 {streak} 天</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={cn(activeTab === "today" ? "block" : "hidden")}>
        <div className="space-y-5">

        {/* ── Stats card ── */}
        <div
          className="anim-card relative overflow-hidden rounded-2xl px-6 py-5"
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

          <div className="relative">
            {/* 3 compact stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
              {[
                {
                  label: "累计练习",
                  value: totalCount,
                  unit: "句",
                  icon: BookOpen,
                  color: "#ec4899",
                  gradient: "linear-gradient(135deg, #f472b6, #ec4899)",
                },
                {
                  label: "学习天数",
                  value: totalDays,
                  unit: "天",
                  icon: BarChart2,
                  color: "#f59e0b",
                  gradient: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                },
                {
                  label: "待复习",
                  value: pendingCount,
                  unit: "项",
                  icon: Clock,
                  color: "#06b6d4",
                  gradient: "linear-gradient(135deg, #22d3ee, #06b6d4)",
                  link: "/home/review",
                },
              ].map(({ label, value, unit, icon: Icon, color, gradient, link }) => {
                const inner = (
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg shrink-0" style={{ background: "var(--surface)" }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium mb-0.5" style={{ color: "var(--banner-subtitle)" }}>{label}</p>
                      <div className="flex items-baseline gap-1">
                        <span
                          className="text-lg font-black tabular-nums"
                          style={{ background: gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                        >
                          {value}
                        </span>
                        <span className="text-[11px]" style={{ color: "var(--banner-subtitle)" }}>{unit}</span>
                      </div>
                    </div>
                  </div>
                )
                return link
                  ? <Link key={label} href={link} className="block hover:opacity-80 transition-opacity">{inner}</Link>
                  : <div key={label}>{inner}</div>
              })}
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

        {/* ── Three-column grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_260px] gap-5">

          {/* ── Column 1: 签到区 ── */}
          <div className="flex flex-col gap-5 h-full">
            {/* Check-in card (compact) */}
            <div
              className="anim-card relative overflow-hidden rounded-2xl border p-5"
              style={{
                background: "var(--surface-violet)",
                borderColor: "var(--surface-violet-border)",
              }}
            >
              <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4">
                <div className="flex items-center gap-3 sm:gap-3.5">
                  <div
                    className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl shrink-0"
                    style={{ background: "var(--stat-2-icon-bg)", border: "1px solid var(--stat-2-border)" }}
                  >
                    <Flame className="h-5 w-5 sm:h-6 sm:w-6 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-foreground/65 text-[10px] sm:text-[11px] font-bold tracking-wider uppercase">连续打卡</p>
                    <div className="flex items-baseline gap-1 sm:gap-1.5 mt-0.5">
                      <span
                        ref={streakRef}
                        className="text-3xl sm:text-5xl font-black tabular-nums"
                        style={{ background: "linear-gradient(135deg, #a78bfa, #ec4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                      >
                        {streak}
                      </span>
                      <span className="text-foreground/40 text-xs sm:text-sm font-medium">天</span>
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
              <div>
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
            </div>

            {/* Monthly check-in calendar — fills remaining space */}
            <div
              className="anim-card rounded-2xl border p-5 flex-1 flex flex-col"
              style={{ background: "var(--surface-violet)", borderColor: "var(--surface-violet-border)" }}
            >
              <MonthlyCheckInCalendar
                checkInDates={checkInDatesThisMonth}
                checkedInToday={checkedIn}
              />
            </div>
          </div>

          {/* ── Column 2: 每日任务 ── */}
          <div className="h-full">
            <DailyTasks className="h-full" refreshKey={checkInVersion} />
          </div>

          {/* ── Column 3: 热力图 + 邀请好友 + 课程广场 + 最近学习 ── */}
          <div className="space-y-3">
            {/* Monthly heatmap */}
            <div
              className="anim-card rounded-2xl border p-4"
              style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                <h3 className="text-[13px] font-semibold text-foreground/70">学习热力图</h3>
              </div>
              {stats && <MonthlyHeatmap heatmap={stats.heatmap} heatmapDuration={stats.heatmapDuration ?? {}} />}
            </div>

            {/* Invite friends */}
            <InviteCard />

            {/* Store link */}
            <Link
              href="/home/store"
              className="anim-card flex items-center gap-3 rounded-2xl border p-3.5 hover:border-foreground/15 transition-all duration-200 group"
              style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
            >
              <div
                className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                style={{ background: "#ec489918", border: "1px solid #ec489930" }}
              >
                <ShoppingBag className="h-4 w-4 text-[#ec4899]" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground/80">课程广场</p>
                <p className="text-[10px] text-foreground/40 mt-0.5">浏览更多课程</p>
              </div>
            </Link>

            {/* Recent learning list */}
            {stats?.recentPractices && stats.recentPractices.length > 0 && (
              <div
                className="anim-card rounded-2xl border p-4"
                style={{ background: "var(--surface)", borderColor: "var(--surface-border)" }}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <Clock className="h-3.5 w-3.5 text-sky-400" />
                  <h3 className="text-[13px] font-semibold text-foreground/70">最近学习</h3>
                </div>
                <div className="space-y-1.5">
                  {stats.recentPractices.slice(0, 4).map((p, i) => (
                    <Link
                      key={`${p.courseId}-${p.lessonId}-${i}`}
                      href={`/home/learn/${p.courseId}?lesson=${p.lessonId}`}
                      className="flex items-center gap-2 group/item rounded-lg px-2 py-1.5 -mx-2 hover:bg-foreground/[0.04] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground/80 truncate">{p.courseTitle}</p>
                        <p className="text-[10px] text-muted-foreground/55 truncate mt-0.5">{p.lessonTitle}</p>
                      </div>
                      <span className="text-[10px] text-foreground/25 shrink-0">{relativeTime(p.studiedAt)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom row: 复习本 / 笔记本 / 单词本 ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          {[
            { label: "复习本", desc: "待复习项", icon: BookOpen, href: "/home/review", color: "#06b6d4" },
            { label: "笔记本", desc: "学习笔记", icon: FileText, href: "/home/notes", color: "#8b5cf6" },
            { label: "单词本", desc: "我的单词", icon: BookText, href: "/home/wordbook", color: "#f59e0b" },
          ].map(({ label, desc, icon: Icon, href, color }) => (
            <Link
              key={label}
              href={href}
              className="anim-card group flex items-center gap-4 rounded-2xl border p-4 hover:border-foreground/15 transition-all duration-200"
              style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
            >
              <div
                className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                style={{ background: `${color}18`, border: `1px solid ${color}30` }}
              >
                <Icon className="h-5 w-5" style={{ color }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground/80">{label}</p>
                <p className="text-[11px] text-foreground/40 mt-0.5">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
        </div>
        </div>

        <div className={cn(activeTab === "archive" ? "block" : "hidden")}>
          <ArchivePanel />
        </div>

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
