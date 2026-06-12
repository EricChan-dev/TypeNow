"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { animate } from "animejs"
import { useRouter } from "next/navigation"
import { X, CheckCircle2, RotateCcw, BookOpen } from "lucide-react"
import { CompletedSentence } from "@/components/home/learn/CompletedSentence"
import type { Word } from "@/types"
import { cn } from "@/lib/utils"

const TOKEN_RE = /[a-zA-Z\d'-]+|[.,!?;:'"()…—]/g

interface ReviewItem {
  reviewId: string
  sentenceId: string
  reviewCount: number
  consecutiveOk: number
  intervalDays: number
  english: string
  chinese: string
  words: Word[] | null
  chunks: Array<{ order: number; text: string; chinese: string }> | null
}

interface WordState {
  value: string
  status: "idle" | "active" | "done" | "error"
}

function getInputWords(words: Word[]): Word[] {
  return words.filter((w) => w.pos !== "标点")
}

function textToWords(text: string): Word[] {
  const tokens = text.match(TOKEN_RE) ?? []
  return tokens.map((t) => ({
    english: t,
    chinese: null,
    phonetic: null,
    pos: /^[a-zA-Z\d'-]+$/.test(t) ? "词" : "标点",
  }))
}

function playBuzz() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 220
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
    osc.start()
    osc.stop(ctx.currentTime + 0.18)
  } catch {}
}

const GRADE_OPTIONS: { label: string; desc: string; grade: number; color: string }[] = [
  { label: "再次巩固", desc: "答错/不确定", grade: 2, color: "border-red-500/40 text-red-400 hover:bg-red-500/10" },
  { label: "记住了", desc: "正确但费力", grade: 4, color: "border-violet-500/40 text-violet-400 hover:bg-violet-500/10" },
  { label: "很熟练", desc: "轻松正确", grade: 5, color: "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" },
]

export function ReviewClient() {
  const router = useRouter()
  const [items, setItems] = useState<ReviewItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<"input" | "complete" | "grading">("input")
  const [wordStates, setWordStates] = useState<WordState[]>([])
  const [activeWordIndex, setActiveWordIndex] = useState(0)
  const [shakeWords, setShakeWords] = useState<Set<number>>(new Set())
  const [errorCount, setErrorCount] = useState(0)
  const errorCountRef = useRef(errorCount)
  errorCountRef.current = errorCount
  const [done, setDone] = useState(false)

  const statusRef = useRef(status)
  statusRef.current = status
  const wordStatesRef = useRef(wordStates)
  wordStatesRef.current = wordStates
  const activeWordIndexRef = useRef(activeWordIndex)
  activeWordIndexRef.current = activeWordIndex
  const currentIdxRef = useRef(currentIdx)
  currentIdxRef.current = currentIdx
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    fetch("/api/review/queue")
      .then((r) => r.json())
      .then((json) => {
        if (json.items) setItems(json.items)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const sentence = items[currentIdx]
  const words: Word[] = sentence?.words && sentence.words.length > 0
    ? sentence.words
    : textToWords(sentence?.english ?? "")
  const inputWords = getInputWords(words)

  // Reset word states when sentence changes
  useEffect(() => {
    if (!sentence) return
    setStatus("input")
    setErrorCount(0)
    setShakeWords(new Set())
    setActiveWordIndex(0)
    setWordStates(
      inputWords.map((_, i) => ({
        value: "",
        status: i === 0 ? "active" : "idle",
      }))
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, sentence?.sentenceId])

  const submitGrade = useCallback(async (grade: number, mastered?: boolean) => {
    const item = itemsRef.current[currentIdxRef.current]
    if (!item) return
    await fetch("/api/review/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mastered
        ? { sentenceId: item.sentenceId, mastered: true }
        : { sentenceId: item.sentenceId, grade }),
    }).catch(() => {})

    const next = currentIdxRef.current + 1
    if (next >= itemsRef.current.length) {
      setDone(true)
    } else {
      setCurrentIdx(next)
      setStatus("input")
    }
  }, [])

  const handleInput = useCallback((e: KeyboardEvent) => {
    if (statusRef.current === "grading" || statusRef.current === "complete") {
      if (e.key === "Enter" && statusRef.current === "grading") {
        // Grade buttons are shown; Enter is handled by button focus
      }
      return
    }

    const ws = wordStatesRef.current
    const activeIdx = activeWordIndexRef.current
    const words = getInputWords(itemsRef.current[currentIdxRef.current]?.words
      && itemsRef.current[currentIdxRef.current].words!.length > 0
        ? itemsRef.current[currentIdxRef.current].words!
        : textToWords(itemsRef.current[currentIdxRef.current]?.english ?? ""))

    if (!words[activeIdx]) return

    const expected = words[activeIdx].english
    const currentVal = ws[activeIdx]?.value ?? ""

    if (e.key === "Backspace") {
      e.preventDefault()
      if (currentVal.length === 0) return
      const newVal = currentVal.slice(0, -1)
      setWordStates((prev) => {
        const next = [...prev]
        next[activeIdx] = { value: newVal, status: newVal.length === 0 ? "active" : "error" }
        return next
      })
      return
    }

    if (e.key.length !== 1 || e.ctrlKey || e.metaKey) return
    e.preventDefault()

    const next = currentVal + e.key
    const correctSoFar = expected.toLowerCase().startsWith(next.toLowerCase())
    const fullMatch = next.toLowerCase() === expected.toLowerCase()

    if (fullMatch) {
      setWordStates((prev) => {
        const ns = [...prev]
        ns[activeIdx] = { value: next, status: "done" }
        return ns
      })
      const isLast = activeIdx >= words.length - 1
      if (isLast) {
        // Auto-mastery: zero errors on this sentence
        if (errorCountRef.current === 0) {
          submitGrade(5, true)
          const next = currentIdxRef.current + 1
          if (next >= itemsRef.current.length) setDone(true)
          else { setCurrentIdx(next); setStatus("input") }
          return
        }
        setStatus("grading")
      } else {
        const nextIdx = activeIdx + 1
        setActiveWordIndex(nextIdx)
        setWordStates((prev) => {
          const ns = [...prev]
          ns[activeIdx] = { value: next, status: "done" }
          ns[nextIdx] = { ...ns[nextIdx], status: "active" }
          return ns
        })
      }
    } else if (correctSoFar) {
      setWordStates((prev) => {
        const ns = [...prev]
        ns[activeIdx] = { value: next, status: "active" }
        return ns
      })
    } else {
      playBuzz()
      setErrorCount((c) => c + 1)
      setWordStates((prev) => {
        const ns = [...prev]
        ns[activeIdx] = { value: next, status: "error" }
        return ns
      })
      setShakeWords((prev) => {
        const s = new Set(prev)
        s.add(activeIdx)
        return s
      })
      setTimeout(() => {
        setShakeWords((prev) => {
          const s = new Set(prev)
          s.delete(activeIdx)
          return s
        })
      }, 500)
    }
  }, [])

  useEffect(() => {
    window.addEventListener("keydown", handleInput)
    return () => window.removeEventListener("keydown", handleInput)
  }, [handleInput])

  if (loading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-foreground/40 text-sm">加载中…</div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-5">
        <BookOpen className="h-12 w-12 text-foreground/20" />
        <p className="text-foreground/60 text-lg font-medium">今日暂无待复习内容</p>
        <p className="text-foreground/30 text-sm">完成练习后，句子会自动加入复习队列</p>
        <button
          onClick={() => router.push("/home/review")}
          className="mt-2 px-5 py-2 rounded-xl bg-accent text-primary-foreground text-sm font-semibold hover:bg-accent/90 transition-colors"
        >
          返回主页
        </button>
      </div>
    )
  }

  if (done) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-5">
        <div className="flex flex-col items-center gap-4">
          <CheckCircle2 className="h-14 w-14 text-emerald-400" />
          <p className="text-2xl font-black text-foreground">复习完成！</p>
          <p className="text-foreground/50 text-sm">本次复习 {items.length} 句</p>
        </div>
        <button
          onClick={() => router.push("/home/review")}
          className="mt-4 px-6 py-2.5 rounded-xl bg-accent text-primary-foreground text-sm font-semibold hover:bg-accent/90 transition-colors"
        >
          返回主页
        </button>
      </div>
    )
  }

  if (!sentence) return null

  const progressPercent = ((currentIdx) / items.length) * 100

  return (
    <div className="fixed inset-0 bg-background flex flex-col select-none">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
        <div className="flex items-center gap-3">
          <BookOpen className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-foreground/70">复习模式</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-foreground/40">{currentIdx + 1} / {items.length}</span>
          <button
            onClick={() => router.push("/home/review")}
            className="p-1.5 rounded-lg hover:bg-foreground/[0.06] transition-colors"
          >
            <X className="h-4 w-4 text-foreground/40" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-foreground/[0.06]">
        <div
          className="h-full bg-violet-500 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 overflow-y-auto gap-8">
        {/* Chinese hint */}
        <p className="text-2xl font-semibold text-foreground/70 text-center max-w-2xl">
          {sentence.chinese}
        </p>

        {status === "grading" ? (
          /* Grading view */
          <div className="flex flex-col items-center gap-8 w-full max-w-2xl">
            <CompletedSentence words={words} />
            <p className="text-base text-foreground/40">这道题掌握得怎么样？</p>
            <div className="flex gap-3 flex-wrap justify-center">
              {GRADE_OPTIONS.map((opt) => (
                <button
                  key={opt.grade}
                  onClick={() => submitGrade(opt.grade)}
                  className={cn(
                    "px-5 py-3 rounded-xl border text-sm font-semibold transition-all",
                    opt.color
                  )}
                >
                  <span className="block">{opt.label}</span>
                  <span className="block text-[11px] opacity-60 font-normal mt-0.5">{opt.desc}</span>
                </button>
              ))}
              <button
                onClick={() => submitGrade(5, true)}
                className="px-5 py-3 rounded-xl border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-sm font-semibold transition-all"
              >
                <span className="block">已掌握 ✓</span>
                <span className="block text-[11px] opacity-60 font-normal mt-0.5">移入已掌握</span>
              </button>
            </div>
            {errorCount > 0 && (
              <p className="text-xs text-foreground/30">本句错误 {errorCount} 次</p>
            )}
          </div>
        ) : (
          /* Word-mode input */
          <div className="flex flex-wrap justify-center items-end gap-x-4 gap-y-4 w-[88%] max-w-5xl">
            {words.map((word, i) => {
              const isInput = word.pos !== "标点"
              const wsIdx = inputWords.indexOf(word)
              const ws = isInput && wsIdx >= 0 ? wordStates[wsIdx] : null
              const isActive = isInput && wsIdx === activeWordIndex
              const isShaking = shakeWords.has(wsIdx)
              const underlineWidth = word.english.length * 38 + 20

              if (!isInput) {
                return (
                  <span key={i} className="text-xl font-medium text-foreground/70 self-end pb-1.5">
                    {word.english}
                  </span>
                )
              }

              const isPending = !ws || ws.status === "idle"

              return (
                <div
                  key={i}
                  className={cn("flex flex-col items-center gap-[5px]", isShaking && "animate-shake")}
                  onMouseEnter={(e) => {
                    if (!isPending) return
                    const ul = e.currentTarget.querySelector<HTMLElement>("[data-underline]")
                    if (ul) animate(ul, { scaleX: 1.1, scaleY: 2.0, duration: 180, ease: "out(2)" })
                  }}
                  onMouseLeave={(e) => {
                    if (!isPending) return
                    const ul = e.currentTarget.querySelector<HTMLElement>("[data-underline]")
                    if (ul) animate(ul, { scaleX: 1, scaleY: 1, duration: 180, ease: "out(2)" })
                  }}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center h-16 text-6xl font-medium transition-colors",
                      ws?.status === "done" ? "text-foreground"
                        : ws?.status === "error" ? "text-red-500"
                        : isActive ? "text-accent"
                        : "text-transparent"
                    )}
                    style={{ minWidth: underlineWidth }}
                  >
                    {ws?.value || ""}
                  </div>
                  <div
                    data-underline={wsIdx}
                    className={cn(
                      "h-[3px] transition-colors duration-150",
                      ws?.status === "error" ? "bg-red-500"
                        : ws?.status === "done" ? "bg-foreground/40"
                        : isActive ? "bg-accent shadow-[0_0_8px_var(--accent)]"
                        : "bg-foreground/20"
                    )}
                    style={{
                      width: underlineWidth,
                      clipPath: "polygon(0 0, 100% 0, calc(100% - 2px) 100%, 2px 100%)",
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Hidden input to capture keyboard on mobile */}
      <input
        className="opacity-0 absolute -bottom-10 left-0"
        autoFocus
        readOnly
        aria-hidden
      />
    </div>
  )
}
