"use client"

/**
 * 指法跟打（第一期）：键位分区讲解 + 渐进式盲打关卡 + 本机最佳成绩。
 *
 * 数据与计分口径都在 src/lib/typing.ts（纯静态，不接数据库）；
 * 本组件只负责录入判定与展示：
 *   · 敲对才前进：错键不推进光标、只计错误数 —— 打字教学的正反馈来自「必须敲对」，
 *     允许跳过会让错误键位固化；
 *   · 大小写宽容：练习文本全部小写（第一期不练 Shift），用户开着大写锁定也不误判；
 *   · 计时从第一次击键开始，WPM 按标准 1 词=5 字符折算；
 *   · 最佳成绩记 localStorage（typenow_typing_best），wpm 或正确率更高才算刷新。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Keyboard, Play, RotateCcw, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  FINGER_COLORS,
  FINGER_LABELS,
  KEYBOARD_ROWS,
  TYPING_LESSONS,
  accuracyOf,
  computeWpm,
  fingerOfKey,
  isBetterScore,
  loadTypingBest,
  saveTypingBest,
  type FingerId,
  type TypingBest,
  type TypingDrill,
  type TypingLesson,
} from "@/lib/typing"

export function TypingClient() {
  const [bests, setBests] = useState<Record<string, TypingBest>>({})
  const [active, setActive] = useState<{ lesson: TypingLesson; drill: TypingDrill } | null>(null)

  useEffect(() => {
    // 最佳成绩只在客户端读：SSR 阶段没有 localStorage，挂载后再取
    setBests(loadTypingBest())
  }, [])

  if (active) {
    return (
      <DrillView
        lesson={active.lesson}
        drill={active.drill}
        best={bests[active.drill.id]}
        onBest={(best, prev) => {
          setBests(saveTypingBest(active.drill.id, best))
          return isBetterScore(best, prev)
        }}
        onExit={() => setActive(null)}
        onNext={(drill) => setActive({ lesson: active.lesson, drill })}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-6">
        <div className="flex items-center gap-2.5">
          <Keyboard className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-bold text-foreground/80">指法跟打</h1>
          <span className="text-xs text-foreground/40">5 关 · 从基准键位到整句盲打</span>
        </div>

        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground/70">
          把手指放回基准位：<b className="text-foreground">左手 ASDF、右手 JKL;</b>，食指摸到 F、J
          的凸点。每一关只练新键位，敲对才前进 —— 慢没有关系，<b className="text-foreground">准</b>才有速度。
        </p>

        {TYPING_LESSONS.map((lesson) => (
          <section key={lesson.id} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-foreground/60">{lesson.title}</h2>
              <span className="flex flex-wrap gap-1">
                {lesson.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground/70"
                  >
                    {k === " " ? "空格" : k}
                  </kbd>
                ))}
              </span>
            </div>
            <ul className="space-y-2">
              {lesson.drills.map((drill) => {
                const best = bests[drill.id]
                return (
                  <li key={drill.id}>
                    <button
                      type="button"
                      onClick={() => setActive({ lesson, drill })}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-sky-400/50 hover:bg-sky-400/5"
                    >
                      <Play className="h-4 w-4 shrink-0 text-sky-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{drill.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{drill.text}</span>
                      </span>
                      {best && (
                        <span className="shrink-0 text-right text-xs text-muted-foreground">
                          <span className="block text-sky-400">{best.wpm} WPM</span>
                          <span>正确率 {best.accuracy}%</span>
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

interface DrillViewProps {
  lesson: TypingLesson
  drill: TypingDrill
  best?: TypingBest
  /** 完成时落库；返回是否刷新了纪录（决定是否展示奖杯） */
  onBest: (best: TypingBest, prev: TypingBest | undefined) => boolean
  onExit: () => void
  onNext: (drill: TypingDrill) => void
}

function DrillView({ lesson, drill, best, onBest, onExit, onNext }: DrillViewProps) {
  const [cursor, setCursor] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [wrong, setWrong] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [done, setDone] = useState(false)
  const [missFlash, setMissFlash] = useState(false)
  /** 完成时刻的定格成绩：不依赖 250ms 节拍的 now（会少算零头），并锁定「是否新纪录」 */
  const [finalStats, setFinalStats] = useState<{ wpm: number; accuracy: number; seconds: number; isRecord: boolean } | null>(null)
  const missTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const target = drill.text[cursor] ?? ""
  const targetFinger: FingerId | null = fingerOfKey(target.toLowerCase())
  const elapsed = startedAt && !done ? Math.max(now - startedAt, 0) : 0
  const wpm = computeWpm(correct, elapsed)
  const accuracy = accuracyOf(correct, correct + wrong)

  const finish = useCallback(
    (finalCorrect: number, finalWrong: number, finalMs: number) => {
      const best0: TypingBest = { wpm: computeWpm(finalCorrect, finalMs), accuracy: accuracyOf(finalCorrect, finalCorrect + finalWrong) }
      // isRecord 用落库前的旧成绩判定：state 更新后 best prop 会变成本次成绩，再比就是自己比自己
      const isRecord = onBest(best0, best)
      setFinalStats({ ...best0, seconds: Math.round(finalMs / 1000), isRecord })
      setDone(true)
    },
    [best, onBest],
  )

  // 计时节拍：只在练习进行中走表
  useEffect(() => {
    if (!startedAt || done) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [startedAt, done])

  // 录入判定：错键不前进，靠「必须敲对」建立正确键位记忆
  useEffect(() => {
    if (done) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // 修饰键与功能键（key 长度>1）不算击键；空格是唯一要接的多余长度键
      if (e.key.length > 1 && e.key !== " ") return
      e.preventDefault()
      const start = startedAt ?? Date.now()
      if (!startedAt) setStartedAt(start)
      const ms = Math.max(Date.now() - start, 1)
      if (e.key.toLowerCase() === target.toLowerCase()) {
        const nextCorrect = correct + 1
        setCorrect(nextCorrect)
        if (cursor + 1 >= drill.text.length) {
          finish(nextCorrect, wrong, ms)
        } else {
          setCursor(cursor + 1)
        }
      } else {
        const nextWrong = wrong + 1
        setWrong(nextWrong)
        setMissFlash(true)
        if (missTimer.current) clearTimeout(missTimer.current)
        missTimer.current = setTimeout(() => setMissFlash(false), 180)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [cursor, correct, wrong, startedAt, done, target, drill.text.length, finish])

  useEffect(() => () => {
    if (missTimer.current) clearTimeout(missTimer.current)
  }, [])

  const reset = () => {
    setCursor(0)
    setCorrect(0)
    setWrong(0)
    setStartedAt(null)
    setNow(0)
    setDone(false)
    setMissFlash(false)
    setFinalStats(null)
  }

  const nextDrill = lesson.drills[lesson.drills.findIndex((d) => d.id === drill.id) + 1]

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          全部关卡
        </button>

        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground/80">{drill.title}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {lesson.title}
              {drill.tip ? ` · ${drill.tip}` : ""}
            </p>
          </div>
          {!done && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重来
            </button>
          )}
        </div>

        {/* 实时成绩条 */}
        <div className="grid grid-cols-3 gap-2.5">
          <StatCard label="速度" value={startedAt ? `${wpm} WPM` : "—"} />
          <StatCard label="正确率" value={startedAt ? `${accuracy}%` : "—"} />
          <StatCard label="用时" value={startedAt ? `${Math.round(elapsed / 1000)}s` : "—"} />
        </div>

        {done && finalStats ? (
          <ResultCard
            wpm={finalStats.wpm}
            accuracy={finalStats.accuracy}
            seconds={finalStats.seconds}
            isRecord={finalStats.isRecord}
            hasNext={Boolean(nextDrill)}
            onRetry={reset}
            onNext={nextDrill ? () => onNext(nextDrill) : undefined}
          />
        ) : (
          <>
            {/* 目标文本：逐字上色，敲对变暗、当前字高亮、未到字浅 */}
            <div className="rounded-xl border border-border bg-card px-4 py-4">
              <p className="whitespace-pre-wrap break-words font-mono text-lg leading-relaxed tracking-wide">
                {drill.text.split("").map((ch, i) => (
                  <span
                    key={i}
                    className={cn(
                      i < cursor && "text-foreground/45",
                      i === cursor && "rounded bg-sky-400/20 text-foreground",
                      i > cursor && "text-foreground/35",
                    )}
                  >
                    {ch}
                  </span>
                ))}
              </p>
            </div>

            {/* 手指提示：下一个键 + 该用哪根手指 */}
            <div className="flex items-center justify-center gap-2.5">
              <span className="text-sm text-muted-foreground">下一个键</span>
              <kbd className="min-w-9 rounded-lg border-2 px-2.5 py-1 text-center font-mono text-base font-bold text-foreground"
                style={{ borderColor: targetFinger ? FINGER_COLORS[targetFinger] : undefined }}
              >
                {target === " " ? "空格" : target}
              </kbd>
              <span
                className="inline-flex items-center gap-1.5 text-sm font-medium"
                style={{ color: targetFinger ? FINGER_COLORS[targetFinger] : undefined }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: targetFinger ? FINGER_COLORS[targetFinger] : undefined }}
                />
                {targetFinger ? FINGER_LABELS[targetFinger] : "—"}
              </span>
            </div>

            <KeyboardView target={target.toLowerCase()} miss={missFlash} />
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-center">
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function ResultCard({
  wpm,
  accuracy,
  seconds,
  isRecord,
  hasNext,
  onRetry,
  onNext,
}: {
  wpm: number
  accuracy: number
  seconds: number
  isRecord: boolean
  hasNext: boolean
  onRetry: () => void
  onNext?: () => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-6 text-center">
      {isRecord && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-400">
          <Trophy className="h-3.5 w-3.5" />
          新纪录
        </p>
      )}
      <p className="text-3xl font-bold text-foreground">{wpm} WPM</p>
      <p className="mt-1 text-sm text-muted-foreground">
        正确率 {accuracy}% · 用时 {seconds}s
      </p>
      <div className="mt-5 flex items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <RotateCcw className="h-4 w-4" />
          再练一次
        </button>
        {hasNext && onNext && (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-400/15 px-4 py-2 text-sm font-medium text-sky-400 transition-colors hover:bg-sky-400/25"
          >
            <Play className="h-4 w-4" />
            下一关
          </button>
        )}
      </div>
    </div>
  )
}

/** 键盘可视化：每键底部标手指色，当前目标键高亮，敲错时红闪 */
function KeyboardView({ target, miss }: { target: string; miss: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="space-y-1.5">
        {KEYBOARD_ROWS.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-1.5">
            {row.map((k) => {
              const finger = fingerOfKey(k)
              const isTarget = k === target
              return (
                <kbd
                  key={k}
                  className={cn(
                    "relative flex h-9 min-w-9 items-end justify-center rounded-md border border-border pb-1 font-mono text-xs text-foreground/70 transition-colors sm:h-10 sm:min-w-10",
                    isTarget && !miss && "border-transparent bg-sky-400/20 text-foreground",
                    isTarget && miss && "border-transparent bg-red-400/40 text-foreground",
                  )}
                  style={finger ? { borderBottom: `3px solid ${FINGER_COLORS[finger]}` } : undefined}
                >
                  {k}
                </kbd>
              )
            })}
          </div>
        ))}
        <div className="flex justify-center gap-1.5">
          <kbd
            className={cn(
              "flex h-9 items-end justify-center rounded-md border border-border pb-1 font-mono text-[11px] text-foreground/70 transition-colors sm:h-10",
              "w-48 sm:w-64",
              target === " " && !miss && "border-transparent bg-sky-400/20 text-foreground",
              target === " " && miss && "border-transparent bg-red-400/40 text-foreground",
            )}
            style={{ borderBottom: `3px solid ${FINGER_COLORS.th}` }}
          >
            空格
          </kbd>
        </div>
      </div>
      {/* 手指颜色图例：8 指 + 拇指 */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {(Object.keys(FINGER_LABELS) as FingerId[]).map((f) => (
          <span key={f} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: FINGER_COLORS[f] }} />
            {FINGER_LABELS[f]}
          </span>
        ))}
      </div>
    </div>
  )
}
