"use client"

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react"
import { animate, stagger } from "animejs"
import {
  CalendarDays, BookOpen, Flame, Trophy,
  Target, Zap, BarChart2, TrendingUp, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCountUp } from "@/lib/hooks/useCountUp"
import { YearlyHeatmap } from "@/components/home/YearlyHeatmap"

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "week" | "month" | "all"

interface ArchiveStats {
  learningDays: number
  totalSentences: number
  streakDays: number
  completedCourses: number
  bestScore: number
  avgScore: number
  totalMistakes: number
  trend: { date: string; count: number }[]
  heatmap: Record<string, number>
  today: string
}

// ─── SVG Area Chart ───────────────────────────────────────────────────────────

function TrendChart({ data, period }: { data: { date: string; count: number }[]; period: Period }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-foreground/20 text-sm">
        暂无数据
      </div>
    )
  }

  const W = 100
  const H = 60
  const max = Math.max(...data.map((d) => d.count), 1)

  const pts = data.map((d, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - (d.count / max) * (H * 0.85) - H * 0.05,
    count: d.count,
    date: d.date,
  }))

  // Smooth cubic bezier
  const linePath = pts
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`
      const prev = pts[i - 1]
      const cpx = (prev.x + p.x) / 2
      return `C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`
    })
    .join(" ")

  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`

  // X-axis labels: show first, last, and a few in between
  const labelIndices = new Set<number>()
  labelIndices.add(0)
  labelIndices.add(data.length - 1)
  if (data.length > 4) {
    const mid = Math.floor(data.length / 2)
    labelIndices.add(mid)
    if (data.length > 8) {
      labelIndices.add(Math.floor(data.length / 4))
      labelIndices.add(Math.floor((3 * data.length) / 4))
    }
  }

  function fmtDate(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00")
    if (period === "week") return ["日","一","二","三","四","五","六"][d.getDay()]
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const total = data.reduce((s, d) => s + d.count, 0)
  const avgPerDay = data.filter((d) => d.count > 0).length > 0
    ? Math.round(total / data.filter((d) => d.count > 0).length)
    : 0

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-40"
      >
        <defs>
          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#area-grad)" />
        <path d={linePath} fill="none" stroke="#a78bfa" strokeWidth="0.8" />
        {pts.map((p, i) =>
          p.count > 0 ? (
            <circle key={i} cx={p.x} cy={p.y} r="1.2" fill="#a78bfa" />
          ) : null
        )}
      </svg>
      {/* X-axis labels */}
      <div className="relative flex justify-between mt-1 px-0.5">
        {data.map((d, i) =>
          labelIndices.has(i) ? (
            <span key={i} className="text-[9px] text-foreground/25 font-mono absolute" style={{ left: `${(i / (data.length - 1)) * 100}%`, transform: "translateX(-50%)" }}>
              {fmtDate(d.date)}
            </span>
          ) : null
        )}
      </div>
      <div className="mt-5 flex items-center justify-between text-[11px] text-foreground/30">
        <span>单位：句</span>
        <span>累计 {total} 句 · 日均 {avgPerDay} 句</span>
      </div>
    </div>
  )
}

// ─── Compact Stat Card ─────────────────────────────────────────────────────────

function CompactStat({
  label,
  value,
  unit,
  icon: Icon,
  color,
}: {
  label: string
  value: number | string
  unit?: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  return (
    <div
      className="archive-card rounded-2xl p-3.5 flex items-center gap-3"
      style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}
    >
      <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}>
        <Icon className="h-4 w-4" color={color} />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-black tabular-nums text-foreground/85">{value}</span>
          {unit && <span className="text-[11px] text-foreground/40">{unit}</span>}
        </div>
        <p className="text-[10px] text-foreground/45 font-medium mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ArchivePanel() {
  const [period, setPeriod] = useState<Period>("all")
  const [stats, setStats] = useState<ArchiveStats | null>(null)
  const [loading, setLoading] = useState(true)
  const pageRef = useRef<HTMLDivElement>(null)

  const animEnabled = !!stats
  const initialLoadRef = useRef(true)

  const learningDays = useCountUp(stats?.learningDays ?? 0, animEnabled)
  const totalSentences = useCountUp(stats?.totalSentences ?? 0, animEnabled)
  const streakDays = useCountUp(stats?.streakDays ?? 0, animEnabled)
  const completedCourses = useCountUp(stats?.completedCourses ?? 0, animEnabled)

  const fetchStats = useCallback(async (p: Period) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/archive/stats?period=${p}`)
      const data = await res.json()
      setStats(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      initialLoadRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchStats(period)
  }, [period, fetchStats])

  useLayoutEffect(() => {
    if (!stats || !pageRef.current) return
    const cards = Array.from(pageRef.current.querySelectorAll(".archive-card") as NodeListOf<HTMLElement>)
    cards.forEach((c) => { c.style.opacity = "0"; c.style.transform = "translateY(20px)" })
    requestAnimationFrame(() => {
      animate(cards, {
        translateY: [20, 0],
        opacity: [0, 1],
        duration: 500,
        delay: stagger(60, { start: 80 }),
        ease: "out(3)",
      })
    })
  }, [stats])

  const maxDailySentences = stats?.trend?.length
    ? Math.max(...stats.trend.map((t: { count: number }) => t.count), 0)
    : 0

  const PERIODS: { value: Period; label: string }[] = [
    { value: "week", label: "本周" },
    { value: "month", label: "本月" },
    { value: "all", label: "全部" },
  ]

  return (
    <div ref={pageRef} className="w-full max-w-5xl space-y-5">

        {/* Period selector */}
        <div className="flex justify-end">
          <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}>
            {PERIODS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200",
                  period === value
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && !stats ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
              <p className="text-foreground/30 text-sm">加载中…</p>
            </div>
          </div>
        ) : stats ? (
          <>
            {loading && (
              <div className="flex justify-center -mb-2">
                <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
              </div>
            )}
            {/* Unified stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CompactStat label="学习天数" value={learningDays} unit="天" icon={CalendarDays} color="#7c3aed" />
              <CompactStat label="练习句数" value={totalSentences} unit="句" icon={BookOpen} color="#3b82f6" />
              <CompactStat label="连续打卡" value={streakDays} unit="天" icon={Flame} color="#f59e0b" />
              <CompactStat label="完成课程" value={completedCourses} unit="门" icon={Trophy} color="#10b981" />
              <CompactStat label="最高分" value={stats.bestScore || "—"} unit={stats.bestScore ? "分" : undefined} icon={Zap} color="#ec4899" />
              <CompactStat label="平均分" value={stats.avgScore || "—"} unit={stats.avgScore ? "分" : undefined} icon={Target} color="#06b6d4" />
              <CompactStat label="累计错误" value={stats.totalMistakes} unit="次" icon={BarChart2} color="#f97316" />
              <CompactStat label="单日最多" value={maxDailySentences} unit="句" icon={TrendingUp} color="#8b5cf6" />
            </div>

            {/* Trend + Heatmap side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div
                className="archive-card rounded-2xl p-5"
                style={{ background: "var(--surface-alt)", border: "1px solid var(--surface-border)" }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-violet-400" />
                  <h3 className="text-sm font-semibold text-foreground/70">练习趋势</h3>
                </div>
                <TrendChart data={stats.trend} period={period} />
              </div>

              <div
                className="archive-card rounded-2xl p-5"
                style={{ background: "var(--surface-alt)", border: "1px solid var(--surface-border)" }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <CalendarDays className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-semibold text-foreground/70">年度热力图</h3>
                </div>
                <YearlyHeatmap heatmap={stats.heatmap} />
              </div>
            </div>
          </>
        ) : null}

    </div>
  )
}
