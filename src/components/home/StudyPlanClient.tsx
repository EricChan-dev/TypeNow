"use client"

/**
 * 学习计划（第一期）：选课 → 单元概览 → 听写练习 → 到期复习。
 *
 * 流程口径（与会话里确认的第一期范围一致）：
 *   · 一人一份计划（api 层 UNIQUE，重复创建回 409）；
 *   · 听写会话：自动播词 → 用户拼词 → 判分；答错当场亮答案，并把该词
 *     「本轮末重排一次」（重排再错不再重排，避免死循环）；
 *   · 正确率只统计「首次作答」——重排后的再答不算，否则答错的词
 *     重答对了反而拉高正确率，数字就失真了。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  BookOpen,
  Check,
  ChevronRight,
  GraduationCap,
  Loader2,
  RefreshCw,
  Repeat,
  Search,
  Trash2,
  Volume2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"

// ─── API 契约（与 /api/study-plan* 各路由一一对应）──────────────────────────

interface PlanInfo {
  id: string
  courseId: string
  courseTitle: string
  createdAt: string
}

interface CourseItem {
  id: string
  title: string
  learnerCount: number
}

type UnitStatus = "empty" | "new" | "learning" | "done"

interface UnitItem {
  lessonId: string
  title: string
  sortOrder: number
  total: number
  touched: number
  mastered: number
  accuracy: number | null
  status: UnitStatus
}

interface UnitsResponse {
  plan: PlanInfo
  stats: {
    totalWords: number
    touchedWords: number
    masteredWords: number
    dueNow: number
    unitCount: number
  }
  units: UnitItem[]
}

interface SessionWord {
  word: string
  phonetic: { us: string; uk: string }
  translation: string | null
  lessonId?: string
}

interface SessionResponse {
  mode: "unit" | "review"
  unit?: { lessonId: string; title: string }
  items: SessionWord[]
  totalNew?: number
  dueTotal?: number
}

// ─── 组件 ───────────────────────────────────────────────────────────────────

export function StudyPlanClient() {
  const [phase, setPhase] = useState<"loading" | "picker" | "overview">("loading")
  const [overview, setOverview] = useState<UnitsResponse | null>(null)

  const loadOverview = useCallback(async () => {
    const res = await fetch("/api/study-plan/units")
    if (!res.ok) throw new Error("units failed")
    const data = (await res.json()) as UnitsResponse
    setOverview(data)
    setPhase("overview")
  }, [])

  // 首屏：有计划 → 概览；没有 → 选课
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/study-plan")
        const data = (await res.json()) as { plan: PlanInfo | null }
        if (data.plan) await loadOverview()
        else setPhase("picker")
      } catch {
        toast.error("加载失败，请刷新重试")
        setPhase("picker")
      }
    })()
  }, [loadOverview])

  async function deletePlan() {
    try {
      const res = await fetch("/api/study-plan", { method: "DELETE" })
      if (!res.ok) throw new Error()
      setOverview(null)
      setPhase("picker")
      toast.success("已删除学习计划")
    } catch {
      toast.error("删除失败")
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (phase === "picker") {
    return <CoursePicker onCreated={() => void loadOverview()} />
  }

  if (!overview) return null

  return (
    <Overview
      overview={overview}
      onRefresh={() => void loadOverview().catch(() => toast.error("刷新失败"))}
      onDeleted={deletePlan}
    />
  )
}

// ─── 选课器 ─────────────────────────────────────────────────────────────────

function CoursePicker({ onCreated }: { onCreated: () => void }) {
  const [courses, setCourses] = useState<CourseItem[] | null>(null)
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/study-plan/courses")
        const data = (await res.json()) as { items: CourseItem[] }
        setCourses(data.items)
      } catch {
        toast.error("课程列表加载失败")
        setCourses([])
      }
    })()
  }, [])

  async function createPlan(courseId: string) {
    setCreating(courseId)
    try {
      const res = await fetch("/api/study-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      })
      if (res.status === 409) {
        toast.error("你已有一份学习计划")
        return
      }
      if (!res.ok) throw new Error()
      toast.success("学习计划已创建")
      onCreated()
    } catch {
      toast.error("创建失败，请重试")
    } finally {
      setCreating(null)
    }
  }

  const filtered = (courses ?? []).filter((c) =>
    c.title.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">
        <div className="flex items-center gap-2.5">
          <GraduationCap className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-bold text-foreground/80">创建学习计划</h1>
          <span className="text-xs text-foreground/40">选一门课 · 逐单元听写 · 自动安排复习</span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索课程"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-sky-400/60"
          />
        </div>

        {courses === null ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">没有匹配的课程</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => void createPlan(c.id)}
                  disabled={creating !== null}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors",
                    "hover:border-sky-400/50 disabled:opacity-60"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{c.title}</span>
                    <span className="text-xs text-muted-foreground">{c.learnerCount} 人在学</span>
                  </span>
                  {creating === c.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── 概览 ───────────────────────────────────────────────────────────────────

const UNIT_BADGE: Record<UnitStatus, { label: string; cls: string }> = {
  empty: { label: "无词表", cls: "bg-muted text-muted-foreground" },
  new: { label: "未开始", cls: "bg-sky-500/15 text-sky-400" },
  learning: { label: "学习中", cls: "bg-amber-500/15 text-amber-400" },
  done: { label: "已学完", cls: "bg-emerald-500/15 text-emerald-400" },
}

function Overview({
  overview,
  onRefresh,
  onDeleted,
}: {
  overview: UnitsResponse
  onRefresh: () => void
  onDeleted: () => void
}) {
  const { plan, stats, units } = overview
  const [session, setSession] = useState<SessionState | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)

  async function startUnit(unit: UnitItem) {
    try {
      const res = await fetch(`/api/study-plan/session?mode=unit&lessonId=${unit.lessonId}`)
      if (!res.ok) throw new Error()
      const data = (await res.json()) as SessionResponse
      if (data.items.length === 0) {
        toast.success("这个单元的新词都学完了")
        onRefresh()
        return
      }
      setSession({ data, refresh: onRefresh })
    } catch {
      toast.error("加载练习失败")
    }
  }

  async function startReview() {
    try {
      const res = await fetch("/api/study-plan/session?mode=review")
      if (!res.ok) throw new Error()
      const data = (await res.json()) as SessionResponse
      if (data.items.length === 0) {
        toast("当前没有到期的单词")
        onRefresh()
        return
      }
      setSession({ data, refresh: onRefresh })
    } catch {
      toast.error("加载复习失败")
    }
  }

  if (session) {
    return <DictationSession state={session} onExit={() => setSession(null)} />
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">
        {/* 计划头 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <GraduationCap className="h-5 w-5 shrink-0 text-sky-400" />
              <h1 className="text-lg font-bold text-foreground/80 truncate">{plan.courseTitle}</h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.unitCount} 个单元 · 词表 {stats.totalWords} 词 · 已学 {stats.touchedWords} ·
              已掌握 {stats.masteredWords}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={onRefresh}
              title="刷新"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => (deleteArmed ? onDeleted() : setDeleteArmed(true))}
              onBlur={() => setDeleteArmed(false)}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs transition-colors",
                deleteArmed
                  ? "bg-red-500/15 text-red-400"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Trash2 className="h-4 w-4" />
              {deleteArmed ? "再点一次确认删除" : "换课程"}
            </button>
          </div>
        </div>

        {/* 到期复习入口 */}
        {stats.dueNow > 0 && (
          <button
            onClick={() => void startReview()}
            className="w-full flex items-center justify-between rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3.5 text-left transition-colors hover:bg-amber-500/15"
          >
            <span className="flex items-center gap-2.5">
              <Repeat className="h-5 w-5 text-amber-400" />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  {stats.dueNow} 个单词到期待复习
                </span>
                <span className="text-xs text-muted-foreground">按记忆曲线安排，今天该见的面</span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-amber-400" />
          </button>
        )}

        {/* 单元网格 */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {units.map((u) => {
            const badge = UNIT_BADGE[u.status]
            const clickable = u.status !== "empty"
            return (
              <button
                key={u.lessonId}
                onClick={() => clickable && void startUnit(u)}
                disabled={!clickable}
                className={cn(
                  "rounded-xl border border-border bg-card p-4 text-left transition-colors",
                  clickable && "hover:border-sky-400/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {u.title}
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", badge.cls)}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {u.touched}/{u.total} 词
                  </span>
                  {u.mastered > 0 && <span>掌握 {u.mastered}</span>}
                  {u.accuracy !== null && <span>正确率 {u.accuracy}%</span>}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-sky-400 transition-all"
                    style={{ width: u.total > 0 ? `${(u.touched / u.total) * 100}%` : "0%" }}
                  />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── 听写会话 ───────────────────────────────────────────────────────────────

interface SessionState {
  data: SessionResponse
  refresh: () => void
}

interface QueueEntry {
  word: SessionWord
  isRetry: boolean
}

function DictationSession({ state, onExit }: { state: SessionState; onExit: () => void }) {
  const { data } = state
  const [queue, setQueue] = useState<QueueEntry[]>(() => data.items.map((w) => ({ word: w, isRetry: false })))
  const [idx, setIdx] = useState(0)
  const [stage, setStage] = useState<"typing" | "revealed">("typing")
  const [input, setInput] = useState("")
  const [wasCorrect, setWasCorrect] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ended, setEnded] = useState(false)

  // 首次正确率：答错的词重排后再对不算（用 state，结束屏要在渲染期读它）
  const [firstTry, setFirstTry] = useState({ correct: 0, total: 0 })
  const requeued = useRef(new Set<string>())
  const [retryCount, setRetryCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const ttsHintShown = useRef(false)

  const current = queue[idx]

  const speak = useCallback(async (text: string) => {
    const ok = await globalSpeak(text, { count: 1 })
    // false = 浏览器自动播放策略拦截 —— 每轮只如实提示一次，别刷屏
    if (!ok && !ttsHintShown.current) {
      ttsHintShown.current = true
      toast("浏览器未允许自动播放，点击页面后重试")
    }
  }, [])

  // 换词即播 + 聚焦输入框
  useEffect(() => {
    if (ended || !current) return
    void speak(current.word.word)
    inputRef.current?.focus()
  }, [idx, ended, current, speak])

  const advance = useCallback(() => {
    setInput("")
    setStage("typing")
    setIdx((i) => {
      const next = i + 1
      if (next >= queue.length) {
        setEnded(true)
        return i
      }
      return next
    })
  }, [queue.length])

  async function submit() {
    if (!current || busy || stage !== "typing") return
    const answer = input.trim().toLowerCase()
    if (!answer) return
    const correct = answer === current.word.word.toLowerCase()
    setBusy(true)
    setWasCorrect(correct)

    // 进度入库；失败不拦流程——词下轮还会以新词身份出现，最多重学一次
    try {
      const res = await fetch("/api/study-plan/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: current.word.word,
          correct,
          lessonId: current.word.lessonId ?? data.unit?.lessonId ?? "",
        }),
      })
      if (!res.ok) toast.error("进度保存失败")
    } catch {
      toast.error("进度保存失败")
    }

    if (!current.isRetry) {
      setFirstTry((s) => ({ total: s.total + 1, correct: s.correct + (correct ? 1 : 0) }))
    }
    // 答错：亮答案 + 本轮末重排一次
    if (!correct && !requeued.current.has(current.word.word)) {
      requeued.current.add(current.word.word)
      setRetryCount((n) => n + 1)
      setQueue((q) => [...q, { word: current.word, isRetry: true }])
    }
    setStage("revealed")
    setBusy(false)
  }

  // ── 结束屏 ──────────────────────────────────────────────────────────────
  if (ended) {
    const accuracy =
      firstTry.total > 0 ? Math.round((firstTry.correct / firstTry.total) * 100) : null
    return (
      <div className="h-full overflow-y-auto scrollbar-none">
        <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5 text-center">
          <div className="mx-auto mt-10 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="h-8 w-8 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-foreground">本轮完成</h2>
          <p className="text-sm text-muted-foreground">
            {data.mode === "unit" ? "单元练习" : "到期复习"} · 共 {queue.length} 次作答
            {retryCount > 0 && ` · ${retryCount} 个词重排过`}
          </p>
          <div className="mx-auto max-w-xs rounded-xl border border-border bg-card p-5">
            <p className="text-3xl font-bold text-foreground">{accuracy === null ? "—" : `${accuracy}%`}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              首次正确率（{firstTry.correct}/{firstTry.total}）
            </p>
          </div>
          <div className="flex justify-center gap-2.5 pt-2">
            <button
              onClick={onExit}
              className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-400"
            >
              返回概览
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!current) return null

  const pair = current.word.phonetic
  const phonetic = pair.us || pair.uk ? (pair.us || pair.uk) : null

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">
        {/* 会话头 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {data.mode === "unit" ? (
              <BookOpen className="h-5 w-5 shrink-0 text-sky-400" />
            ) : (
              <Repeat className="h-5 w-5 shrink-0 text-amber-400" />
            )}
            <h1 className="truncate text-sm font-medium text-foreground/80">
              {data.mode === "unit" ? data.unit?.title : "到期复习"}
            </h1>
          </div>
          <button
            onClick={onExit}
            className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="结束本轮"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 进度条 */}
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-sky-400 transition-all"
              style={{ width: `${(idx / queue.length) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {idx + 1} / {queue.length}
          </span>
        </div>

        {/* 听写卡 */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (stage === "typing") void submit()
            else advance()
          }}
          className="rounded-xl border border-border bg-card p-6 space-y-4"
        >
          <div className="flex flex-col items-center gap-2 py-4">
            <button
              type="button"
              onClick={() => void speak(current.word.word)}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/15 text-sky-400 transition-colors hover:bg-sky-500/25"
              title="再听一遍"
            >
              <Volume2 className="h-7 w-7" />
            </button>
            {phonetic && <p className="text-sm text-muted-foreground">{phonetic}</p>}
          </div>

          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={stage === "revealed"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="听音拼词，回车提交"
            className="w-full rounded-lg border border-border bg-muted/40 px-4 py-3 text-center text-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-sky-400/60 disabled:opacity-70"
          />

          {stage === "revealed" && (
            <div
              className={cn(
                "rounded-lg px-4 py-3 text-center",
                wasCorrect ? "bg-emerald-500/10" : "bg-red-500/10"
              )}
            >
              {wasCorrect ? (
                <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-400">
                  <Check className="h-4 w-4" /> 正确
                </p>
              ) : (
                <>
                  <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-red-400">
                    <X className="h-4 w-4" /> 正确拼写
                  </p>
                  <p className="mt-1 text-lg font-bold tracking-wide text-foreground">{current.word.word}</p>
                  {current.word.translation && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{current.word.translation}</p>
                  )}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">本轮结束时再出现一次</p>
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || (stage === "typing" && !input.trim())}
            className={cn(
              "w-full rounded-lg py-2.5 text-sm font-medium transition-colors",
              stage === "typing"
                ? "bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-50"
                : "border border-border bg-muted text-foreground hover:bg-accent"
            )}
          >
            {busy ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : stage === "typing" ? (
              "提交"
            ) : (
              "下一个"
            )}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/home/dictionary" className="hover:text-foreground">
            查这个词的完整释义
          </Link>
        </p>
      </div>
    </div>
  )
}
