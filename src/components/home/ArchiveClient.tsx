"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { animate, stagger } from "animejs"
import {
  CalendarDays, BookOpen, Flame, Trophy,
  Target, Zap, BarChart2, TrendingUp, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
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

// ─── Count-up hook ────────────────────────────────────────────────────────────

function useCountUp(target: number, enabled: boolean, duration = 1200) {
  const [value, setValue] = useState(0)
  const objRef = useRef({ val: 0 })

  useEffect(() => {
    if (!enabled) { setValue(target); return }
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

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  iconColor,
  iconBg,
  gradient,
}: {
  label: string
  value: number
  unit: string
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  iconBg: string
  gradient: string
}) {
  return (
    <div
      className="archive-card rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-foreground/65 font-bold">{label}</p>
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
        <span className="text-foreground/55 text-xs">{unit}</span>
      </div>
    </div>
  )
}

// ─── Highlight Card ───────────────────────────────────────────────────────────

function HighlightCard({
  label,
  value,
  unit,
  icon: Icon,
}: {
  label: string
  value: string | number
  unit?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div
      className="archive-card rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-foreground/55" />
        <p className="text-[11px] text-foreground/65 font-bold">{label}</p>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-black text-foreground/80 tabular-nums">{value}</span>
        {unit && <span className="text-foreground/55 text-xs">{unit}</span>}
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
    }
  }, [])

  useEffect(() => {
    fetchStats(period)
  }, [period, fetchStats])

  useEffect(() => {
    if (!stats || !pageRef.current) return
    const cards = pageRef.current.querySelectorAll(".archive-card")
    animate(cards, {
      translateY: [20, 0],
      opacity: [0, 1],
      duration: 500,
      delay: stagger(60, { start: 80 }),
      ease: "out(3)",
    })
  }, [stats])

  const maxDailySentences = stats
    ? Math.max(...(stats.trend.map((t) => t.count)), 0)
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
                    : "text-white/50 hover:text-white/80"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
              <p className="text-foreground/30 text-sm">加载中…</p>
            </div>
          </div>
        ) : stats ? (
          <>
            {/* Section 1 — 学习投入 */}
            <div>
              <p className="text-[11px] text-foreground/55 font-semibold uppercase tracking-widest mb-3">学习投入</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="学习天数"
                  value={learningDays}
                  unit="天"
                  icon={CalendarDays}
                  iconColor="text-violet-400"
                  iconBg="rgba(124,58,237,0.15)"
                  gradient="linear-gradient(135deg, #a78bfa, #7c3aed)"
                />
                <StatCard
                  label="练习句数"
                  value={totalSentences}
                  unit="句"
                  icon={BookOpen}
                  iconColor="text-blue-400"
                  iconBg="rgba(59,130,246,0.15)"
                  gradient="linear-gradient(135deg, #60a5fa, #06b6d4)"
                />
                <StatCard
                  label="连续打卡"
                  value={streakDays}
                  unit="天"
                  icon={Flame}
                  iconColor="text-amber-400"
                  iconBg="rgba(245,158,11,0.15)"
                  gradient="linear-gradient(135deg, #fbbf24, #f97316)"
                />
                <StatCard
                  label="完成课程"
                  value={completedCourses}
                  unit="门"
                  icon={Trophy}
                  iconColor="text-emerald-400"
                  iconBg="rgba(16,185,129,0.15)"
                  gradient="linear-gradient(135deg, #34d399, #0d9488)"
                />
              </div>
            </div>

            {/* Section 2 — 高光时刻 */}
            <div>
              <p className="text-[11px] text-foreground/55 font-semibold uppercase tracking-widest mb-3">高光时刻</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <HighlightCard label="最高分" value={stats.bestScore || "—"} unit={stats.bestScore ? "分" : undefined} icon={Zap} />
                <HighlightCard label="平均分" value={stats.avgScore || "—"} unit={stats.avgScore ? "分" : undefined} icon={Target} />
                <HighlightCard label="累计错误" value={stats.totalMistakes} unit="次" icon={BarChart2} />
                <HighlightCard label="单日最多" value={maxDailySentences} unit="句" icon={TrendingUp} />
              </div>
            </div>

            {/* Section 3 — 练习趋势 */}
            <div
              className="archive-card rounded-2xl p-5"
              style={{ background: "var(--surface-alt)", border: "1px solid var(--surface-border)" }}
            >
              <div className="flex items-center gap-2 mb-5">
                <TrendingUp className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-foreground/70">练习趋势</h3>
              </div>
              <TrendChart data={stats.trend} period={period} />
            </div>

            {/* Section 4 — 年度热力图 */}
            <div
              className="archive-card rounded-2xl p-5"
              style={{ background: "var(--surface-alt)", border: "1px solid var(--surface-border)" }}
            >
              <div className="flex items-center gap-2 mb-5">
                <CalendarDays className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-foreground/70">年度学习热力图</h3>
              </div>
              <YearlyHeatmap heatmap={stats.heatmap} />
            </div>
          </>
        ) : null}

    </div>
  )
}
