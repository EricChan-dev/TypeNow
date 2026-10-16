"use client"

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { animate, stagger } from "animejs"
import {
  Flame, ChevronRight, Zap,
  Check, Loader2,
  ChevronsLeft, ChevronsRight, HelpCircle,
  MessageCircle,
  CalendarDays, Plus, Settings, Crown, LogOut,
  Headphones, Mic, BookOpen, BookText, BookMarked,
  ArrowRight, TrendingUp,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ArchivePanel } from "@/components/home/ArchiveClient"
import { CheckInRulesModal } from "@/components/home/CheckInRulesModal"
import { GlobalSettingsModal } from "@/components/home/GlobalSettingsModal"
import { WelcomeTrialModal } from "@/components/home/WelcomeTrialModal"
import { DailyTasks } from "@/components/home/DailyTasks"
import { PaymentSuccessModal } from "@/components/payment/PaymentSuccessModal"
import { ContactModal } from "@/components/auth/ContactModal"
import { PracticeTrendChart } from "@/components/home/PracticeTrendChart"
import { signOutAction } from "@/app/actions/auth"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import { CHECK_IN_GOAL_DEFAULT } from "@/lib/coins"
import { BRAND } from "@/lib/brand"
import { TRIAL_DAYS } from "@/lib/trial-days"
import type { MemberTier } from "@/lib/pricing"
import { memberTierLabel } from "@/lib/pricing"

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatsData {
  streakDays: number
  todayCount: number
  checkedInToday: boolean
  heatmap: Record<string, number>
  heatmapDuration: Record<string, number>
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
  todaySentences: number
  checkInGoal: number
  weekly: { date: string; count: number }[]
  /** 待复习项数量（复习队列 pending），学习数据与词汇卡都要用。 */
  pendingReviews: number
 /* 以下是本次改版新增的真实聚合字段（见 api/home/stats） */
  totalSentences?: number
  totalDurationSeconds?: number
  totalDurationHours?: number
  totalMistakes?: number
  reviewBreakdown?: { mastered: number; almost: number; reviewing: number }
  wordbookCount?: number
  pronunciationToday?: number
}

/** `/api/auth/me` 返回的会员信息（无全局 user context，只能自己 fetch）。 */
interface MeData {
  id: string
  name: string
  avatar: string | null
  is_pro: boolean
  is_partner: boolean
  trial_available: boolean
  level: number
  member_tier: MemberTier
  diamonds: number
  coins: number
  role: string
}

/** 一千小时 = 首页「千小时进度」的目标常量。 */
const THOUSAND_HOURS = 1000

// ─── Utilities ────────────────────────────────────────────────────────────────

// 日期键必须与后端 DATE(created_at) 的上海口径一致，见 lib/practice-stats。
// 不要用 toISOString().slice(0,10) —— 那是 UTC 日期，CST 00:00-08:00 会差一天。

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

/** 小数保留 n 位（时长/百分比统一两位小数口径，如 0.00）。 */
function fixed(n: number, digits = 2): string {
  return n.toFixed(digits)
}

// ─── 区块：学习日历（.calendar）────────────────────

/**
 * 月历是「整月 7 列网格 + 到今天为止」，用**练习记录**（heatmap）
 * 标出已学习 / 未学习，而不是签到（签到是我方独有的概念，已改到日签卡里）。
 *
 * 与旧版 `MonthlyCheckInCalendar` 的差别：这版只用打卡日历的**几何**
 * （`.Date` / `.days` / `.tit`），数据换成 heatmap，翻月时不联网。
 */
function StudyCalendar({
  heatmap,
  heatmapDuration,
  streakDays,
}: {
  heatmap: Record<string, number>
  heatmapDuration: Record<string, number>
  streakDays: number
}) {
  const [offset, setOffset] = useState(0)

  const { year, month, cells, studiedDays, avgMinutes } = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
    const y = d.getFullYear()
    const m = d.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const firstDow = new Date(y, m, 1).getDay() // 0=周日
    const today = toShanghaiDateStr()

    const list: { day: number; date: string; studied: boolean; isToday: boolean; future: boolean }[] = []
    for (let n = 1; n <= daysInMonth; n++) {
      const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`
      // heatmap 是「日期 → 当日金币」，>0 视为当天有练习记录。
      // 只统计到今天：未来的格子恒为未学习（否则会跟随历史数据「预知未来」）。
      list.push({
        day: n,
        date,
        studied: date <= today && (heatmap[date] ?? 0) > 0,
        isToday: date === today,
        future: date > today,
      })
    }

    const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`
    // 本月平均时长：只对**本月有过练习的天**取平均，除以整月天数会得到一个
    // 随日期推进不断下降的假数字。
    let seconds = 0
    let active = 0
    for (const c of list) {
      if (!c.date.startsWith(monthPrefix)) continue
      const sec = heatmapDuration[c.date] ?? 0
      if (sec > 0) { seconds += sec; active += 1 }
    }

    return {
      year: y,
      month: m,
      cells: list,
      studiedDays: list.filter((c) => c.studied).length,
      avgMinutes: active > 0 ? Math.round(seconds / 60 / active) : 0,
    }
  }, [offset, heatmap, heatmapDuration])

 // 首格之前的留白（渲染成空占位，保持 7 列对齐）
  const padCount = new Date(year, month, 1).getDay()
  const rows: (typeof cells[number] | null)[][] = []
  {
    const flat: (typeof cells[number] | null)[] = [
      ...Array.from({ length: padCount }, () => null),
      ...cells,
    ]
    while (flat.length % 7 !== 0) flat.push(null)
    for (let i = 0; i < flat.length; i += 7) rows.push(flat.slice(i, i + 7))
  }

  return (
    <div className="calendar">
      <h5>
        学习日历
        <div className="state">
          <label><i className="yxx" />已学习</label>
          <label><i className="wwc" />未学习</label>
        </div>
      </h5>
      <div className="Date">
        <button type="button" aria-label="上个月" onClick={() => setOffset((o) => Math.max(-11, o - 1))}>
          <em><ChevronsLeft /></em>
        </button>
        <span>{year}年{month + 1}月</span>
        <button type="button" aria-label="下个月" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}>
          <em><ChevronsRight /></em>
        </button>
      </div>
      <div className="days">
        <p>
          {["日", "一", "二", "三", "四", "五", "六"].map((w) => <em key={w}>{w}</em>)}
        </p>
        {rows.map((row, ri) => (
          <p key={ri}>
            {row.map((c, ci) => (
              <label key={c?.date ?? `pad-${ri}-${ci}`} className={c?.isToday ? "on" : undefined}>
                {c && (
                  <span className={c.studied ? "yxx" : "wwc"}>
                    {c.day}
                    <i />
                  </span>
                )}
              </label>
            ))}
          </p>
        ))}
      </div>
      <div className="tit">
        <p>本月学习<b>{studiedDays} 天</b></p>
        <p>连续天数<b>{streakDays} 天</b></p>
        <p>本月平均时长<b>{avgMinutes} 分</b></p>
      </div>
    </div>
  )
}

// ─── 区块：客户服务与支持（.cs-banner-compact）───────

function CsBanner({ onContact }: { onContact: () => void }) {
  return (
    <div className="cs-banner-compact">
      <div className="cs-left">
        <div className="cs-icon-wrapper">
          <Headphones />
        </div>
        <div className="cs-text">
          <h3>客户服务与支持</h3>
          <p>在使用中遇到问题，或有意见建议，欢迎随时联系我们</p>
        </div>
      </div>
      <div className="cs-right">
        <div className="follow-us-wrapper">
          <button type="button" className="cs-btn follow-btn">
            <MessageCircle style={{ color: "#10b981" }} />
            关注我们
          </button>
          <div className="qrcode-popup">
            {/* 二维码是公众号码，不是客服码 —— 标签必须诚实（同上文 ContactModal 注释） */}
            <img src="/wechat-oa.jpeg" alt="公众号二维码" />
            <p>扫码关注公众号</p>
          </div>
        </div>
        <button type="button" className="cs-btn support-btn" onClick={onContact}>
          <MessageCircle />
          在线客服
        </button>
      </div>
    </div>
  )
}

// ─── 区块：会员状态卡片（.membership-status-card）───

function MembershipCard({
  me,
  todaySentences,
  checkInGoal,
 /** 今日 AI 口语评测次数 —— 额度单位是「调用次数」而非「分钟配额」 */
  pronunciationToday,
}: {
  me: MeData | null
  todaySentences: number
  checkInGoal: number
  pronunciationToday: number
}) {
  const tier: MemberTier = me?.member_tier ?? "free"
  const isVip = tier !== "free"
  const quotaPercent = checkInGoal > 0 ? Math.min(100, (todaySentences / checkInGoal) * 100) : 0

  return (
    <div className={cn("membership-status-card compact", isVip ? "vip" : "free")}>
      <div className="membership-compact-layout">
        {/* 左侧：用户信息 */}
        <div className="user-info-compact">
          <div className="user-avatar-wrapper">
            {me?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.avatar} alt="头像" className="user-avatar-img" />
            ) : (
              <div className="user-avatar-placeholder">
                <BookOpen />
              </div>
            )}
          </div>
          <div className="user-details">
            <div className="user-name">{me?.name ?? "同学"}</div>
            <div className="membership-badge-row">
              <span className={cn("badge-text", isVip ? "vip" : "free")}>
                {memberTierLabel(tier)}
              </span>
              {!isVip && (
                <Link href="/pricing" className="upgrade-link">
                  获取练习配额
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* 中间：权益数据 */}
        <div className="benefits-compact">
          <div className="benefit-item-compact">
            <div className="benefit-icon blue">
              <Zap />
            </div>
            <div className="benefit-info">
 {/* 这里不放配额类指标 —— 我方**没有分钟配额**这个概念，
                  membership-benefits 的额度单位是 AI 调用次数，练习本身不限次。
                  所以换成同源的真实指标：今日练习句数 / 签到目标。 */}
              <span className="benefit-label">今日练习(句)</span>
              <span className="benefit-value" style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                {todaySentences}
                <small style={{ fontSize: 12, color: "#9aa8bb", fontWeight: 500 }}> / {checkInGoal}</small>
              </span>
              <div style={{ width: "100%", height: 4, background: "#e2e8f0", borderRadius: 3, marginTop: 5, overflow: "hidden" }}>
                <div style={{ width: `${quotaPercent}%`, height: "100%", background: "#3b82f6", borderRadius: 3, transition: "width 0.6s ease" }} />
              </div>
            </div>
          </div>
          <div className="benefit-item-compact">
            <div className="benefit-icon purple">
              <Mic />
            </div>
            <div className="benefit-info">
              <span className="benefit-label">AI 口语评测</span>
              <span className="benefit-value">{pronunciationToday}</span>
            </div>
          </div>
        </div>

        {/* 右侧：快捷功能 */}
        <div className="quick-actions-compact">
          <Link href="/home/settings" className="action-icon" data-tooltip="个人设置">
            <Settings />
          </Link>
          <Link href="/pricing" className="action-icon" data-tooltip="会员权益">
            <Crown />
          </Link>
 {/* 第三个入口不放「切换主题」；我方 2026-10 已删掉暗色体系，换成学习相关入口 */}
          <Link href="/home/review" className="action-icon" data-tooltip="错题复习">
            <BookMarked />
          </Link>
          <button
            type="button"
            className="action-icon logout"
            data-tooltip="退出登录"
            onClick={async () => {
              try { await signOutAction() } catch { /* 忽略：无论成败都跳走 */ }
              window.location.href = "/"
            }}
          >
            <LogOut />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 区块：试用 banner（.pro-trial-banner）──────────

function TrialBanner({ onClaim, claiming }: { onClaim: () => void; claiming: boolean }) {
  return (
    <div className="pro-trial-banner">
      <div className="trial-text">
        <div className="trial-icon">
          <Crown />
        </div>
        <div>
          <h3>免费体验畅学版特权</h3>
          {/* 天数取自 lib/trial-days（唯一事实源），不要写死 */}
          <p>您拥有 1 次获取 {TRIAL_DAYS} 天畅学版的机会，立即解锁「{TRIAL_DAYS} 天无限练习时长」</p>
        </div>
      </div>
      <div className="trial-action">
        <button type="button" onClick={onClaim} disabled={claiming}>
          {claiming ? "领取中…" : "申请免费体验"}
          <ArrowRight />
        </button>
        <Link href="/pricing">
          了解会员权益
          <ChevronRight />
        </Link>
      </div>
    </div>
  )
}

// ─── 区块：词汇学习（.vocab-stats）──────────────────

function VocabCard({ wordCount, pendingReviews }: { wordCount: number; pendingReviews: number }) {
  return (
    <div className="vocab-stats">
      <h5><BookText />词汇学习</h5>
      {wordCount === 0 ? (
        <div className="vocab-empty">
          <div className="empty-visual">
            <div className="empty-ring">
              <svg viewBox="0 0 120 120">
                <circle className="ring-bg" cx="60" cy="60" r="52" />
              </svg>
              <div className="ring-content">
                <Plus />
              </div>
            </div>
          </div>
          <p>开启词汇学习之旅</p>
          <Link href="/home/study-plan" className="vocab-start-btn">
            创建学习计划
          </Link>
        </div>
      ) : (
        <>
          <div className="vocab-stats-grid">
            <div className="stat-item">
              <span className="stat-num">{wordCount}</span>
              <span className="stat-txt">已收藏单词</span>
            </div>
            <div className="stat-item">
              <span className="stat-num">{pendingReviews}</span>
              <span className="stat-txt">待复习项</span>
            </div>
          </div>
          <Link href="/home/wordbook" className="vocab-action-btn">
            <BookText />
            继续背单词
          </Link>
        </>
      )}
    </div>
  )
}

// ─── 区块：最近课程（.progress3）────────────────────

function RecentCourses({
  recentPractices,
  lastStudied,
}: {
  recentPractices: StatsData["recentPractices"]
  lastStudied: StatsData["lastStudied"]
}) {
  // 后端已按 (courseId, lessonId) 去重并保持时间倒序；这里再按课程收一次，
  // 同一课的多个课时只在「最近课程」里占一格。
  const items = useMemo(() => {
    const seen = new Set<string>()
    return recentPractices.filter((p) => {
      if (seen.has(p.courseId)) return false
      seen.add(p.courseId)
      return true
    }).slice(0, 2)
  }, [recentPractices])

  return (
    <div className="progress3">
      <h5>最近课程</h5>
      <div className="rates">
        {items.length === 0 ? (
          <div className="empty-tip">
            <BookOpen />
            <span>暂无课程</span>
            <Link href="/home/store" className="add-course-btn">去添加课程</Link>
          </div>
        ) : (
          items.map((p) => (
            <div key={`${p.courseId}-${p.lessonId}`} className="rate">
              <span className="course-title">{p.courseTitle}</span>
              <Link
                href={`/home/learn/${p.courseId}?lesson=${p.lessonId}`}
                className="continue-btn"
              >
                继续
              </Link>
              <div className="course-meta">
                <span className="lesson-count">
                  <BookOpen />
                  {p.lessonTitle}
                </span>
                <em className="last-practice">{relativeTime(p.studiedAt)}</em>
              </div>
            </div>
          ))
        )}
      </div>
      {items.length > 0 && lastStudied && (
        <Link href={`/home/learn/${lastStudied.courseId}?lesson=${lastStudied.lessonId}`} className="pg">
          <p><span style={{ width: "100%" }} /></p>
          <em>继续学</em>
        </Link>
      )}
    </div>
  )
}

// ─── 区块：错题统计（.col-3 .progress）───────────────

/**
 * 常见做法是「拼写错误 / 语法错误 / 词汇错误」三分类。
 * **我方数据库没有错题分类字段** —— `practice_records.mistakes` 只有一个总数，
 * 照抄会得到三根恒为 0 的进度条。这里换成同源的、真实存在的三个档位：
 * 已掌握 / 接近掌握 / 复习中（借 review_queue 的 FSRS 字段，
 * 口径与 lib/review-utils.ts 的 masteryLabel 一致）。
 */
function MistakeStats({ stats }: { stats: StatsData }) {
  const total = stats.totalMistakes ?? 0
  const rb = stats.reviewBreakdown ?? { mastered: 0, almost: 0, reviewing: 0 }
  const reviewTotal = rb.mastered + rb.almost + rb.reviewing
  const pct = (n: number) => (reviewTotal > 0 ? Math.round((n / reviewTotal) * 100) : 0)

  const rows = [
    { key: "px", label: "已掌握", n: rb.mastered, p: pct(rb.mastered) },
    { key: "yf", label: "接近掌握", n: rb.almost, p: pct(rb.almost) },
    { key: "ch", label: "复习中", n: rb.reviewing, p: pct(rb.reviewing) },
  ]

  return (
    <div className="progress">
      <h5>错题统计</h5>
      <b>
        <TrendingUp />
        <small>
          累计错题
          <strong>{total}</strong>
        </small>
      </b>
      <div className="rates">
        {rows.map((r) => (
          <div key={r.key} className={cn("rate", r.key)}>
            <label>{r.label}</label>
            <p>
              <em>{r.n}项</em>
              <span style={{ width: `${r.p}%` }} />
            </p>
            <i>{r.p}%</i>
          </div>
        ))}
      </div>
      <Link href="/home/review" style={{ display: "block" }}>
        <button type="button">智能错题复习</button>
      </Link>
    </div>
  )
}

// ─── WeChat login feedback (URL params) ───────────────────────────────────────

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

  // new_user=1 (already following or not OA flow): show welcome trial modal
  //
  // 这里原本还挂了一个 PhoneBindBanner（"建议绑定手机号"）。删掉是因为它现在
  // 必然说错话：微信账号没绑手机号的用户**到不了这个页面** —— 微信回调与
  // oa-check 都会先把人送去 /login?bind=1（见 lib/phone-gate），绑完才放进来。
  // 也就是说能站在这里的人，手机号一定已经绑好了，再劝他绑一次纯属噪音。
  if (newUser === "1" && loginSuccess === "wechat") {
    return <WelcomeTrialModal />
  }

  return null
}

function FollowOABanner() {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div className="ref-bgwhite" style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div className="cs-icon-wrapper" style={{ background: "rgba(59,130,246,0.1)" }}>
        <MessageCircle />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", margin: 0 }}>
          关注服务号，接收学习提醒
        </p>
        <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
          打卡通知、复习提醒不再错过
        </p>
      </div>
      <img
        src="/wechat-oa.jpeg"
        alt="关注服务号"
        style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
      />
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="关闭"
        style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: 6 }}
      >
        ✕
      </button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function HomeClient() {
  // 顶部切换栏已移除，activeTab 恒为 "today"：档案面板保留挂载但暂时没有入口。
  const [activeTab] = useState<"today" | "archive">("today")
  const [stats, setStats] = useState<StatsData | null>(null)
  const [me, setMe] = useState<MeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkedIn, setCheckedIn] = useState(false)
  const [streak, setStreak] = useState(0)
  const [checkInDatesThisMonth, setCheckInDatesThisMonth] = useState<string[]>([])
  const [todaySentences, setTodaySentences] = useState(0)
  const [checkInGoal, setCheckInGoal] = useState(CHECK_IN_GOAL_DEFAULT)
  const [checkInRulesOpen, setCheckInRulesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [checkInVersion, setCheckInVersion] = useState(0)
  const [claimingTrial, setClaimingTrial] = useState(false)
  /** 今日 AI 口语评测次数（真实计数，来自 pronunciation_scores） */
  const [pronunciationToday, setPronunciationToday] = useState(0)

  const checkInBtnRef = useRef<HTMLButtonElement>(null)
  const streakRef = useRef<HTMLSpanElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  const fetchStats = useCallback(async () => {
    setFetchError(false)
    try {
      const res = await fetch("/api/home/stats")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d: StatsData = await res.json()
      setStats(d)
      setCheckedIn(d.checkedInToday)
      setStreak(d.streakDays)
      setCheckInDatesThisMonth(d.checkInDatesThisMonth ?? [])
      setTodaySentences(d.todaySentences ?? 0)
      setCheckInGoal(d.checkInGoal ?? CHECK_IN_GOAL_DEFAULT)
      setPronunciationToday(d.pronunciationToday ?? 0)
    } catch (e) {
      console.error(e)
      setStats(null)
      setFetchError(true)
    }
  }, [])

  // 会员信息（头像 / 档位 / 试用资格）：没有全局 user context，只能自己拉。
  // 昵称优先用这个接口的返回值，props.name 只是首屏兜底。
  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (!res.ok) return
      const d = await res.json()
      if (d?.user) setMe(d.user)
    } catch {
      /* 会员卡降级为「普通用户」即可，不打扰用户 */
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchStats(), fetchMe()]).finally(() => setLoading(false))
  }, [fetchStats, fetchMe])

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
    if (todaySentences < checkInGoal) {
      setCheckInRulesOpen(true)
      return
    }
    setCheckingIn(true)
    try {
      const res = await fetch("/api/home/check-in", { method: "POST" })
      const data = await res.json()
      if (res.status === 403 && data.error === "need_more_diamonds") {
        const remaining = (data.checkInGoal ?? checkInGoal) - (data.todaySentences ?? todaySentences)
        toast.error(`还差 ${remaining} 句才能签到`)
        return
      }
      if (data.success) {
        setCheckedIn(true)
        setStreak(data.streakDays)
        setCheckInVersion((v) => v + 1)

        const todayStr = toShanghaiDateStr()
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
      } else {
        toast.error(data.error || "签到失败，请稍后重试")
      }
    } finally {
      setCheckingIn(false)
    }
  }, [checkedIn, checkingIn, todaySentences, checkInGoal])

  const handleClaimTrial = useCallback(async () => {
    if (claimingTrial) return
    setClaimingTrial(true)
    try {
      const res = await fetch("/api/trial/claim", { method: "POST" })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(`已解锁 ${data.days ?? TRIAL_DAYS} 天畅学版特权`)
        fetchMe()
        return
      }
      if (res.status === 409 || data.code === "ALREADY_CLAIMED") {
        toast.info("体验会员每人仅可领取一次")
        fetchMe()
        return
      }
      toast.error(data.error || "领取失败，请稍后重试")
    } catch {
      toast.error("网络错误，请稍后重试")
    } finally {
      setClaimingTrial(false)
    }
  }, [claimingTrial, fetchMe])

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

  const totalDurationHours = stats?.totalDurationHours ?? 0
  const hoursPercent = Math.min(100, (totalDurationHours / THOUSAND_HOURS) * 100)

  // 本月平均时长（分钟）：只对本月有练习记录的天取平均
  const monthPrefix = toShanghaiDateStr().slice(0, 7)
  const monthDurations = Object.entries(stats?.heatmapDuration ?? {})
    .filter(([d, s]) => d.startsWith(monthPrefix) && s > 0)
  const monthAvgMinutes = monthDurations.length > 0
    ? Math.round(monthDurations.reduce((a, [, s]) => a + s, 0) / 60 / monthDurations.length)
    : 0

  const todayMinutes = (stats?.heatmapDuration?.[toShanghaiDateStr()] ?? 0) / 60

  return (
    <div ref={pageRef} className="h-full overflow-y-auto scrollbar-none">
      <div className="home-ref" style={{ padding: "0 0 8px" }}>

        {/* 顶部那栏（今日/档案切换 + 问候语）已按用户要求整栏去掉。
            档案面板暂时没有入口，但按用户选择保留挂载（见文件末尾）。 */}
        <div className={cn(activeTab === "today" ? "block" : "hidden")}>

          {/* ── Error banner ── */}
          {fetchError && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 flex items-center justify-between" style={{ marginBottom: 14 }}>
              <span className="text-sm text-red-500/80">数据加载失败</span>
              <button
                onClick={fetchStats}
                className="text-sm font-medium text-red-500 hover:text-red-400 transition-colors"
              >
                点击重试
              </button>
            </div>
          )}

          {/* ── WeChat login feedback ── */}
          <Suspense fallback={null}>
            <WeChatLoginBanner />
          </Suspense>

          {/* ── Payment success modal ── */}
          <Suspense fallback={null}>
            <PaymentSuccessModal />
          </Suspense>

 {/* ══ 以下区块顺序 / 几何 / 色值遵循整页版式 ══ */}

          {/* 1. 客户服务与支持 */}
          <div className="anim-card">
            <CsBanner onContact={() => setContactOpen(true)} />
          </div>

 {/* 2. 会员状态卡片（含日签按钮：签到是我方业务，折进最贴近的位置） */}
          <div className="anim-card">
            <MembershipCard
              me={me}
              todaySentences={todaySentences}
              checkInGoal={checkInGoal}
              pronunciationToday={pronunciationToday}
            />
          </div>

 {/* 3+8. 今日打卡 + 每日任务并排（两者均为我方业务；
 用白底卡几何，1:1 分栏） */}
          <div className="ref-checkin-row">
          <div className="ref-bgwhite anim-card">
            <div className="ref-title">
              <h2>今日打卡</h2>
              <div className="textRight">
                <div className="btns">
                  <button type="button" onClick={() => setCheckInRulesOpen(true)}>
                    <HelpCircle style={{ display: "inline", width: 14, height: 14, verticalAlign: "-2px", marginRight: 4 }} />
                    签到规则
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0"
                  style={{ background: "var(--stat-2-icon-bg)", border: "1px solid var(--stat-2-border)" }}
                >
                  <Flame className="h-6 w-6 text-amber-400" />
                </div>
                <div>
                  <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, fontWeight: 600 }}>连续打卡</p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span
                      ref={streakRef}
                      style={{ fontSize: 34, fontWeight: 850, lineHeight: 1.1, background: "linear-gradient(135deg, #a78bfa, #ec4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                    >
                      {streak}
                    </span>
                    <span style={{ fontSize: 13, color: "#94a3b8" }}>天</span>
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#475569" }}>
                    今日 {todaySentences} / {checkInGoal} 句
                  </span>
                  <div style={{ flex: 1 }} />
                  {!checkedIn && todaySentences < checkInGoal && (
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>还差 {checkInGoal - todaySentences} 句可签到</span>
                  )}
                </div>
                <div style={{ height: 6, borderRadius: 999, overflow: "hidden", background: "#e2e8f0" }}>
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 999,
                      transition: "width 0.5s",
                      width: `${Math.min(100, checkInGoal > 0 ? (todaySentences / checkInGoal) * 100 : 0)}%`,
                      background: todaySentences >= checkInGoal
                        ? "linear-gradient(90deg, #22c55e, #16a34a)"
                        : "linear-gradient(90deg, #7c3aed, #a855f7)",
                    }}
                  />
                </div>
              </div>

              <button
                ref={checkInBtnRef}
                onClick={handleCheckIn}
                disabled={checkedIn || checkingIn}
                aria-label={
                  checkedIn ? "已签到" :
                  !checkedIn && todaySentences < checkInGoal ? `还需练 ${checkInGoal - todaySentences} 句` :
                  "签到打卡"
                }
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 shrink-0",
                  checkedIn
                    ? "cursor-default bg-cyan-100 text-cyan-800 border border-cyan-300"
                    : !checkedIn && todaySentences < checkInGoal
                    ? "cursor-pointer opacity-70 border"
                    : "text-white hover:opacity-90 active:scale-95"
                )}
                style={checkedIn
                  ? undefined
                  : !checkedIn && todaySentences < checkInGoal
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
          </div>

 {/* 每日任务（我方业务）—— 与今日打卡并排 */}
          <div className="ref-bgwhite anim-card">
            <div className="ref-title">
              <h2>每日任务</h2>
            </div>
            <DailyTasks refreshKey={checkInVersion} bare />
          </div>
          </div>

 {/* 4. 试用 banner（仅未领过体验会员时出现） */}
          {me?.trial_available && (
            <div className="anim-card">
              <TrialBanner onClaim={handleClaimTrial} claiming={claimingTrial} />
            </div>
          )}

          {/* 5. 学习数据四格 + 千小时进度 */}
          <div className="ref-bgwhite anim-card">
            <div className="ref-title">
              <h2>学习数据</h2>
              <div className="textRight">
                <div className="btns">
                  <Link href="/home/store">
                    <button type="button">
                      <Plus style={{ display: "inline", width: 14, height: 14, verticalAlign: "-2px", marginRight: 4 }} />
                      添加课程
                    </button>
                  </Link>
                </div>
              </div>
            </div>

            <div className="parame">
 {/* 四格不带图标：`.report .parame li label { display:none }`
                  本来就是隐藏的，我们当初漏了这条规则才显出来。
                  与其补一条 CSS 再把它藏掉，不如不渲染这个 label。 */}
              <ul>
 {/* 第一格是「今日练习时长(分钟)」，数值取当日 coin_logs.duration_seconds */}
                <li>
                  <span>今日练习时长(分钟)</span>
                  <p><b>{fixed(todayMinutes)}<em /></b></p>
                </li>
                <li>
                  <span>今日练习(句)</span>
                  <p><b>{stats?.todayCount ?? 0}<em /></b></p>
                </li>
                <li>
                  <span>累计练习(句)</span>
                  <p><b>{stats?.totalSentences ?? 0}</b></p>
                </li>
                <li>
                  <span>连续天数(天)</span>
                  <p><b>{streak}</b></p>
                </li>
              </ul>
            </div>

            <div className="hours">
              <div className="time">
                <div className="hours-content">
                  <div className="hours-left">
                    <div className="hours-title">用你的注意力填满一千小时，</div>
                    <div className="hours-subtitle">就能练成任何你所需要的技能。</div>
                  </div>
                  <div className="hours-right">
                    <div className="hours-percent">
                      <span className="percent-num">{fixed(hoursPercent)}</span>
                      <span className="percent-sign">%</span>
                    </div>
                    <div className="hours-progress">
                      <div className="progress-bar" style={{ width: `${fixed(hoursPercent)}%` }} />
                    </div>
                    <div className="hours-label">
                      <span className="hours-current">{fixed(totalDurationHours, 1)}H</span>
                      <span className="hours-total">/{THOUSAND_HOURS}H COMPLETED</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 6. col73：练习趋势（ECharts）+ 错题统计 */}
          <div className="ref-col73">
            <div className="ref-col-7 anim-card">
              <h5 style={{ float: "left" }}>练习趋势</h5>
              <div className="chat" style={{ clear: "both" }}>
                <PracticeTrendChart data={stats?.weekly ?? []} height={300} />
              </div>
            </div>
            <div className="ref-col-3 anim-card">
              <MistakeStats stats={stats ?? {
                streakDays: 0, todayCount: 0, checkedInToday: false,
                heatmap: {}, heatmapDuration: {}, lastStudied: null,
                recentPractices: [], checkInDatesThisMonth: [],
                todaySentences: 0, checkInGoal, weekly: [], pendingReviews: 0,
              }} />
            </div>
          </div>

          {/* 7. col3：词汇学习 / 最近课程 / 学习日历 */}
          <div className="ref-col3">
            <div className="ref-col-3 anim-card">
              <VocabCard
                wordCount={stats?.wordbookCount ?? 0}
                pendingReviews={stats?.pendingReviews ?? 0}
              />
            </div>
            <div className="ref-col-3 anim-card" style={{ minHeight: 200 }}>
              <RecentCourses
                recentPractices={stats?.recentPractices ?? []}
                lastStudied={stats?.lastStudied ?? null}
              />
            </div>
            <div className="ref-col-3 anim-card">
              <StudyCalendar
                heatmap={stats?.heatmap ?? {}}
                heatmapDuration={stats?.heatmapDuration ?? {}}
                streakDays={streak}
              />
            </div>
          </div>

          {/* 9. 页脚 */}
          <div className="site-footer">
            <span className="footer-copyright">
              © {new Date().getFullYear()} {BRAND.nameZh}. All Rights Reserved.
            </span>
            <div className="footer-links">
              <Link href="/terms">用户协议</Link>
              <Link href="/privacy">隐私政策</Link>
              <Link href="/children-privacy">儿童隐私保护</Link>
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
        todaySentences={todaySentences}
        checkInGoal={checkInGoal}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <GlobalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialGoal={checkInGoal}
        onSaved={(g) => setCheckInGoal(g)}
      />
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  )
}
