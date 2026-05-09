"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ArrowLeft, BookOpen, ShoppingBag, Pause, Play, RotateCcw, Shuffle, Maximize, Minimize, Keyboard, List, Settings, Eye, EyeOff } from "lucide-react"
import type { Sentence, Word } from "@/types"
import { getMockSentencesByLesson } from "@/lib/mock-data/sentences"
import { mockCourses } from "@/lib/mock-data/courses"
import { TransitionOverlay } from "@/components/shared/TransitionOverlay"
import { TooltipButton } from "@/components/shared/TooltipButton"
import { OutlineModal } from "@/components/home/learn/OutlineModal"
import { SettingsModal } from "@/components/home/learn/SettingsModal"
import { CompletedSentence } from "@/components/home/learn/CompletedSentence"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"

function useDebounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  const lastCall = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  return useCallback(((...args: Parameters<T>) => {
    const now = Date.now()
    if (now - lastCall.current < delay) return
    lastCall.current = now
    fnRef.current(...args)
  }) as T, [delay])
}

type SentenceStatus = "input" | "complete"

interface WordState {
  value: string
  status: "idle" | "active" | "done" | "error"
}

// Web Audio API sound effects
let audioCtx: AudioContext | null = null
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    return audioCtx
  } catch { return null }
}

// 1. Character type & word confirm — crisp click
function playTick() {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  // Short high-freq sine for crisp attack
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = "sine"
  osc.frequency.setValueAtTime(2400, now)
  osc.frequency.exponentialRampToValueAtTime(1800, now + 0.02)
  gain.gain.setValueAtTime(0.3, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
  osc.start(now)
  osc.stop(now + 0.03)
}

// 2. Space/Enter error — sharp double beep
function playBuzz() {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  ;[800, 600].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "triangle"
    const t = now + i * 0.08
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.24, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    osc.start(t)
    osc.stop(t + 0.1)
  })
}

// 3. Sentence complete — bright ascending arpeggio
function playChime() {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  const notes = [880, 1109, 1319, 1760] // A5, C#6, E6, A6
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "sine"
    const t = now + i * 0.08
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(0.24, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    osc.start(t)
    osc.stop(t + 0.25)
  })
}

function getInputWords(words: Word[]): Word[] {
  return words.filter((w) => w.pos !== "标点")
}

interface ShortcutBadgeProps {
  keys: string[]
  label: string
  onClick: () => void
}

function ShortcutBadge({ keys, label, onClick }: ShortcutBadgeProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.02] px-2.5 py-1.5 text-xs hover:bg-white/[0.06] hover:border-white/25 transition-colors"
    >
      {keys.map((k, i) => (
        <span key={i}>
          <kbd className="rounded border border-white/20 bg-white/[0.04] px-1 py-0.5 text-[11px] text-white/80 font-medium">{k}</kbd>
          {i < keys.length - 1 && <span className="text-white/30 mx-0.5">+</span>}
        </span>
      ))}
      <span className="text-white/50 ml-0.5">{label}</span>
    </button>
  )
}

interface ShortcutItem {
  keys: string[]
  label: string
  action?: () => void
  disabled?: boolean
}

export function LearnClient({
  courseId,
  lessonId,
}: {
  courseId: string
  lessonId: string
}) {
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [status, setStatus] = useState<SentenceStatus>("input")
  const [wordStates, setWordStates] = useState<WordState[]>([])
  const [activeWordIndex, setActiveWordIndex] = useState(0)
  const [shakeWords, setShakeWords] = useState<Set<number>>(new Set())
  const [timer, setTimer] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showBackModal, setShowBackModal] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showShuffleConfirm, setShowShuffleConfirm] = useState(false)
  const [transition, setTransition] = useState<{ show: boolean; message: string; onComplete?: () => void }>({ show: false, message: "" })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const pauseRef = useRef(false)
  pauseRef.current = isPaused
  const timerRef = useRef(timer)
  timerRef.current = timer
  const containerRef = useRef<HTMLDivElement>(null)

  const course = mockCourses.find((c) => c.id === courseId)
  const courseTitle = course?.title || "课程学习"

  // Refs for keyboard handler to avoid re-binding
  const statusRef = useRef(status)
  statusRef.current = status
  const wordStatesRef = useRef(wordStates)
  wordStatesRef.current = wordStates
  const activeWordIndexRef = useRef(activeWordIndex)
  activeWordIndexRef.current = activeWordIndex
  const currentIndexRef = useRef(currentIndex)
  currentIndexRef.current = currentIndex
  const sentencesRef = useRef(sentences)
  sentencesRef.current = sentences

  // Load sentences (sync mock for now, future: fetch from API)
  useEffect(() => {
    setSentences(getMockSentencesByLesson(lessonId))
  }, [lessonId])

  const sentence = sentences[currentIndex]
  const inputWords = useMemo(
    () => sentence ? getInputWords(sentence.words || []) : [],
    [sentence],
  )

  const isFinished = useMemo(
    () => currentIndex >= sentences.length - 1 && status === "complete",
    [currentIndex, sentences.length, status],
  )
  const completedCount = useMemo(
    () => currentIndex + (status === "complete" ? 1 : 0),
    [currentIndex, status],
  )
  const progressPercent = useMemo(
    () => sentences.length > 0 ? (completedCount / sentences.length) * 100 : 0,
    [completedCount, sentences.length],
  )
  const timerStr = useMemo(
    () => `${String(Math.floor(timer / 3600)).padStart(2, "0")}:${String(Math.floor((timer % 3600) / 60)).padStart(2, "0")}:${String(timer % 60).padStart(2, "0")}`,
    [timer],
  )

  // Initialize word states for current sentence
  useEffect(() => {
    if (!sentence) return
    const states: WordState[] = inputWords.map((_w, i) => ({
      value: "",
      status: i === 0 ? "active" : "idle",
    }))
    setWordStates(states)
    setActiveWordIndex(0)
    setStatus("input")
    // Read sentence aloud on enter
    globalSpeak(sentence.english)
  }, [sentence?.id])

  const goNext = useCallback(() => {
    const idx = currentIndexRef.current
    const all = sentencesRef.current
    if (idx < all.length - 1) {
      setCurrentIndex(idx + 1)
    }
  }, [])

  const goPrev = useCallback(() => {
    const idx = currentIndexRef.current
    if (idx > 0) {
      setCurrentIndex(idx - 1)
    }
  }, [])

  const confirmWord = useCallback(() => {
    const st = statusRef.current
    if (st === "complete") return
    const wStates = wordStatesRef.current
    const activeIdx = activeWordIndexRef.current
    const words = getInputWords(sentencesRef.current[currentIndexRef.current]?.words || [])
    if (!words.length || !words[activeIdx]) return

    const currentVal = wStates[activeIdx]?.value || ""
    const expected = words[activeIdx].english

    if (currentVal.toLowerCase() === expected.toLowerCase()) {
      playTick()
      setWordStates((prev) => {
        const next = [...prev]
        next[activeIdx] = { value: currentVal, status: "done" }
        return next
      })
      const isLastWord = activeIdx >= words.length - 1
      if (isLastWord) {
        setStatus("complete")
        setShowConfetti(true)
        setTimeout(() => setShowConfetti(false), 2000)
        const s = sentencesRef.current[currentIndexRef.current]
        if (s) globalSpeak(s.english)
      } else {
        const nextIdx = activeIdx + 1
        setActiveWordIndex(nextIdx)
        setWordStates((prev) => {
          const next = [...prev]
          next[nextIdx] = { ...next[nextIdx], status: "active" }
          return next
        })
      }
    } else {
      playBuzz()
      setWordStates((prev) => {
        const next = [...prev]
        next[activeIdx] = { value: currentVal, status: "error" }
        return next
      })
      setShakeWords((prev) => new Set(prev).add(activeIdx))
      setTimeout(() => setShakeWords((prev) => { const next = new Set(prev); next.delete(activeIdx); return next }), 500)
    }
  }, [])

  const submitAll = useCallback(() => {
    const st = statusRef.current
    if (st === "complete") return
    const wStates = wordStatesRef.current
    const words = getInputWords(sentencesRef.current[currentIndexRef.current]?.words || [])
    if (!words.length) return

    let hasError = false
    const newStates: WordState[] = wStates.map((ws, i) => {
      const expected = words[i]?.english || ""
      if (ws.status === "done") return ws
      const val = ws.value || ""
      if (val.toLowerCase() === expected.toLowerCase()) {
        return { value: val, status: "done" }
      }
      hasError = true
      return { value: val, status: "error" }
    })
    setWordStates(newStates)
    if (hasError) {
      playBuzz()
      const firstError = newStates.findIndex((s) => s.status === "error")
      const errorIndices = newStates.reduce<number[]>((acc, s, i) => {
        if (s.status === "error") acc.push(i)
        return acc
      }, [])
      setShakeWords((prev) => {
        const next = new Set(prev)
        errorIndices.forEach((i) => next.add(i))
        return next
      })
      setTimeout(() => {
        setShakeWords((prev) => {
          const next = new Set(prev)
          errorIndices.forEach((i) => next.delete(i))
          return next
        })
      }, 500)
      if (firstError >= 0) setActiveWordIndex(firstError)
    } else {
      playChime()
      setStatus("complete")
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 2000)
      const s = sentencesRef.current[currentIndexRef.current]
      if (s) globalSpeak(s.english)
    }
  }, [])

  // Debounced wrappers for button clicks
  const debouncedConfirmWord = useDebounce(confirmWord, 1000)
  const debouncedSubmitAll = useDebounce(submitAll, 1000)
  const debouncedGoNext = useDebounce(goNext, 1000)
  const debouncedGoPrev = useDebounce(goPrev, 1000)
  const debouncedTogglePause = useDebounce(() => {
    setIsPaused((prev) => {
      if (!prev) setShowLeaveModal(true)
      else setShowLeaveModal(false)
      return !prev
    })
  }, 1000)
  const debouncedToggleAnswer = useDebounce(() => setShowAnswer((v) => !v), 1000)

  // Keyboard handler (stable ref, no re-binding)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const st = statusRef.current
      const activeIdx = activeWordIndexRef.current
      const words = getInputWords(sentencesRef.current[currentIndexRef.current]?.words || [])

      if (st === "complete") {
        if (e.key === "Enter") {
          e.preventDefault()
          const idx = currentIndexRef.current
          if (idx < sentencesRef.current.length - 1) setCurrentIndex(idx + 1)
        }
        return
      }

      // Ctrl+' — pronounce
      if (e.ctrlKey && e.key === "'") {
        e.preventDefault()
        const s = sentencesRef.current[currentIndexRef.current]
        if (s) globalSpeak(s.english)
        return
      }

      // Ctrl+; — toggle show answer
      if (e.ctrlKey && e.key === ";") {
        e.preventDefault()
        setShowAnswer((prev) => !prev)
        return
      }

      // Shift+→ — next sentence
      if (e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault()
        const idx = currentIndexRef.current
        if (idx < sentencesRef.current.length - 1) setCurrentIndex(idx + 1)
        return
      }

      // Shift+← — previous sentence
      if (e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault()
        const idx = currentIndexRef.current
        if (idx > 0) setCurrentIndex(idx - 1)
        return
      }

      // Ctrl+P — toggle pause (same as top-right pause button)
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault()
        debouncedTogglePause()
        return
      }

      // Ctrl+1 — open outline
      if (e.ctrlKey && e.key === "1") {
        e.preventDefault()
        setShowOutline(true)
        return
      }

      if (!words.length) return
      const activeWord = words[activeIdx]
      if (!activeWord) return

      // Letter input
      if (/^[a-zA-Z'-]$/.test(e.key)) {
        e.preventDefault()
        playTick()
        setWordStates((prev) => {
          const cur = prev[activeIdx]
          if (cur.value.length >= activeWord.english.length) return prev
          const next = [...prev]
          next[activeIdx] = { value: cur.value + e.key, status: "active" }
          return next
        })
        return
      }

      // Backspace
      if (e.key === "Backspace") {
        e.preventDefault()
        playTick()
        setWordStates((prev) => {
          const cur = prev[activeIdx]
          if (cur.value.length === 0) return prev
          const next = [...prev]
          next[activeIdx] = { value: cur.value.slice(0, -1), status: "active" }
          return next
        })
        return
      }

      // Space: validate current word
      if (e.key === " ") {
        e.preventDefault()
        confirmWord()
        return
      }

      // Enter: validate all
      if (e.key === "Enter") {
        e.preventDefault()
        submitAll()
        return
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (!pauseRef.current) setTimer((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Visibility change — pause timer + show leave modal (disabled in dev)
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return
    function handleVisibility() {
      if (document.hidden) {
        setIsPaused(true)
        setShowLeaveModal(true)
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [])

  // Fullscreen change listener
  useEffect(() => {
    function handleFS() { setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener("fullscreenchange", handleFS)
    document.addEventListener("webkitfullscreenchange", handleFS)
    return () => {
      document.removeEventListener("fullscreenchange", handleFS)
      document.removeEventListener("webkitfullscreenchange", handleFS)
    }
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }

  // Focus container so keyboard events work
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  if (!sentence) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    )
  }

  function doReset() {
    setTransition({ show: true, message: "正在重置进度…", onComplete: () => {
      setCurrentIndex(0)
      setStatus("input")
      setTimer(0)
      setIsPaused(false)
      setTransition({ show: false, message: "" })
      const s = sentencesRef.current[0]
      if (s) globalSpeak(s.english)
    }})
  }

  function doShuffle() {
    setTransition({ show: true, message: "正在打乱顺序…", onComplete: () => {
      const shuffled = [...sentencesRef.current].sort(() => Math.random() - 0.5)
      setSentences(shuffled)
      setCurrentIndex(0)
      setStatus("input")
      setTransition({ show: false, message: "" })
      const s = shuffled[0]
      if (s) globalSpeak(s.english)
    }})
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="h-full flex flex-col outline-none"
    >
      {/* === Layer 1: Action Bar === */}
      <div className="flex items-center justify-between shrink-0 px-5 py-3">
        {/* Left: back + course title + progress */}
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => setShowBackModal(true)}
            className="inline-flex items-center gap-1.5 text-lg text-white hover:text-white/80 transition-colors shrink-0"
          >
            <ArrowLeft className="h-6 w-6" />
            返回
          </button>
          <span className="text-lg text-white truncate">{courseTitle}</span>
          <span className="text-sm text-white/50 shrink-0">{currentIndex + 1}/{sentences.length}</span>
        </div>

        {/* Right: action icons */}
        <div className="flex items-center gap-2 shrink-0">
          <TooltipButton
            label={showAnswer ? "隐藏答案" : "显示答案"}
            onClick={debouncedToggleAnswer}
          >
            {showAnswer ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />}
          </TooltipButton>
          <TooltipButton label="快捷键" onClick={() => setShowShortcuts(true)}><Keyboard className="h-6 w-6" /></TooltipButton>
          <TooltipButton label="设置" onClick={() => setShowSettings(true)}><Settings className="h-6 w-6" /></TooltipButton>
          <TooltipButton label="暂停" onClick={debouncedTogglePause}><Pause className="h-6 w-6" /></TooltipButton>
          <TooltipButton label="重置进度" onClick={() => setShowResetConfirm(true)}><RotateCcw className="h-6 w-6" /></TooltipButton>
          <TooltipButton label="打乱顺序" onClick={() => setShowShuffleConfirm(true)}><Shuffle className="h-6 w-6" /></TooltipButton>
          <TooltipButton label="内容大纲" onClick={() => setShowOutline(true)}><List className="h-6 w-6" /></TooltipButton>
          <TooltipButton label={isFullscreen ? "退出全屏" : "全屏"} onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize className="h-6 w-6" /> : <Maximize className="h-6 w-6" />}
          </TooltipButton>
        </div>
      </div>

      {/* === Layer 2: Progress Bar === */}
      <div className="shrink-0 px-5 pb-2">
        <div className="h-2 rounded-full border border-white/20 bg-transparent overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* === Layer 3: Timer === */}
      <div className="shrink-0 px-5 pb-2 flex items-center gap-3">
        <span className="text-4xl font-bold text-white/70 font-mono">{timerStr}</span>
        {isPaused && <span className="text-base text-amber-400/60">已暂停</span>}
      </div>

      {/* Answer Preview (below timer, centered) */}
      {showAnswer && status === "input" && (
        <div className="shrink-0 px-5 pb-4 flex justify-center">
          <div className="rounded-2xl border border-accent/20 bg-accent/[0.02] px-6 py-4 max-w-2xl w-full">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Eye className="h-3.5 w-3.5 text-accent/50" />
              <span className="text-[11px] font-medium text-accent/50 uppercase tracking-wide">答案预览</span>
            </div>
            <CompletedSentence words={sentence.words || []} small />
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 overflow-y-auto">
        {isFinished ? (
          <div className="text-center space-y-4">
            <p className="text-xl font-bold text-foreground">课程完成！</p>
            <p className="text-sm text-muted-foreground">
              你已完成本课所有 {sentences.length} 个句子
            </p>
            <Link
              href={`/home/store/${courseId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition-colors"
            >
              返回课程
            </Link>
          </div>
        ) : status === "complete" ? (
          /* Completed Sentence Display */
          <div className="w-full max-w-2xl space-y-12">
            <CompletedSentence words={sentence.words || []} />

            {/* Full Chinese translation */}
            <p className="text-center text-2xl font-bold text-white/80 mt-10">
              {sentence.chinese}
            </p>

            <p className="text-center text-2xl text-white/80 font-medium">
              按 Enter 继续下一句
            </p>
          </div>
        ) : (
          /* Input Mode */
          <div className="w-full max-w-2xl space-y-8">
            <p className="text-center text-2xl font-medium text-foreground">
              {sentence.chinese}
            </p>

            <div className="flex flex-wrap justify-center items-end gap-x-3 gap-y-4">
              {(sentence.words || []).map((word, i) => {
                const isInput = word.pos !== "标点"
                const wsIdx = inputWords.indexOf(word)
                const ws = isInput && wsIdx >= 0 ? wordStates[wsIdx] : null
                const isActive = isInput && wsIdx === activeWordIndex
                const isShaking = shakeWords.has(wsIdx)

                if (!isInput) {
                  return (
                    <span key={i} className="text-xl font-medium text-foreground/70 self-end pb-1.5">
                      {word.english}
                    </span>
                  )
                }

                // Width based on expected word length: font-6xl ~60px, avg char ~38px + buffer
                const underlineWidth = word.english.length * 38 + 20

                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center gap-[5px] ${isShaking ? "animate-shake" : ""}`}
                  >
                    <div
                      className={`
                        flex items-center justify-center h-16 text-6xl font-medium transition-colors
                        ${ws?.status === "done"
                          ? "text-foreground"
                          : ws?.status === "error"
                            ? "text-red-500"
                            : isActive
                              ? "text-accent"
                              : "text-transparent"
                        }
                      `}
                      style={{ minWidth: underlineWidth }}
                    >
                      {ws?.value || ""}
                    </div>
                    <div
                      className={`h-[3px] transition-all duration-200 ${
                        ws?.status === "error"
                          ? "bg-red-500"
                          : ws?.status === "done"
                            ? "bg-foreground/40"
                            : isActive
                              ? "bg-accent shadow-[0_0_6px_var(--accent)]"
                              : "bg-foreground/20"
                      }`}
                      style={{
                        width: underlineWidth,
                        clipPath: "polygon(0 0, 100% 0, calc(100% - 2px) 100%, 2px 100%)",
                      }}
                    />
                  </div>
                )
              })}
            </div>

          </div>
        )}
      </div>

      {/* Confetti */}
      {showConfetti && (
        <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
          {Array.from({ length: 40 }).map((_, i) => {
            const colors = ["#f59e0b", "#ef4444", "#22c55e", "#6366f1", "#ec4899", "#06b6d4", "#f97316"]
            const color = colors[i % colors.length]
            const left = 35 + Math.random() * 30
            const delay = Math.random() * 0.3
            const size = 6 + Math.random() * 8
            const angle = Math.random() * Math.PI * 2
            const distance = 200 + Math.random() * 400
            const tx = Math.cos(angle) * distance
            const ty = Math.sin(angle) * distance - 200
            const rot = Math.random() * 720 - 360
            const name = `cf-${i}`
            return (
              <React.Fragment key={i}>
                <style>{`@keyframes ${name} { 0% { transform: translate(0,0) rotate(0deg) scale(1); opacity:1 } 100% { transform: translate(${tx}px,${ty}px) rotate(${rot}deg) scale(0); opacity:0 } }`}</style>
                <div
                  className="absolute rounded-sm"
                  style={{
                    left: `${left}%`,
                    top: "50%",
                    width: size,
                    height: size * 0.6,
                    backgroundColor: color,
                    animation: `${name} 1.2s ease-out ${delay}s forwards`,
                  }}
                />
              </React.Fragment>
            )
          })}
        </div>
      )}

      {/* Shortcut Drawer */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowShortcuts(false)} />
          <div className="relative w-[380px] h-full bg-[#0f0f0f] border-l border-white/10 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="text-base font-bold text-white">快捷键</h2>
              <button onClick={() => setShowShortcuts(false)} className="p-1 rounded text-white/40 hover:text-white transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-4 py-4 space-y-1">
              {([
                { keys: ["Ctrl", "'"], label: "播放声音", action: () => { const s = sentencesRef.current[currentIndexRef.current]; if (s) globalSpeak(s.english) } },
                { keys: ["Ctrl", ";"], label: "显示/隐藏答案" },
                { keys: ["Ctrl", "P"], label: "暂停/继续" },
                { keys: ["Ctrl", "1"], label: "查看课程大纲" },
                { keys: ["Space"], label: "确认当前单词" },
                { keys: ["Enter"], label: "提交整句" },
                { keys: ["Backspace"], label: "删除字符" },
                { keys: ["Ctrl", "M"], label: "标记掌握", disabled: true },
                { keys: ["Ctrl", "N"], label: "添加到生词本", disabled: true },
              ] as ShortcutItem[]).map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${
                    item.disabled ? "opacity-30" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span className="text-sm text-white/70">{item.label}</span>
                  <span className="inline-flex items-center gap-1">
                    {item.keys.map((k, j) => (
                      <span key={j}>
                        <kbd className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-white/60 font-medium">{k}</kbd>
                        {j < item.keys.length - 1 && <span className="text-white/20 mx-0.5">+</span>}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Outline Modal */}
      {showOutline && (
        <OutlineModal
          sentences={sentences}
          currentIndex={currentIndex}
          onClose={() => setShowOutline(false)}
          onJumpTo={(i) => { setCurrentIndex(i); setShowOutline(false) }}
        />
      )}

      {/* Transition Overlay */}
      <TransitionOverlay
        show={transition.show}
        message={transition.message}
        onComplete={transition.onComplete}
      />

      {/* Reset Confirm Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl bg-[#1a1a1a] border border-white/10 p-8 text-center max-w-sm mx-4 shadow-2xl">
            <p className="text-lg font-bold text-white">确认重置</p>
            <p className="mt-3 text-sm text-white/60">重置后当前进度和计时器将归零，确定要重置吗？</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button onClick={() => setShowResetConfirm(false)} className="rounded-xl border border-white/10 px-6 py-2.5 text-sm text-white/60 hover:bg-white/5 transition-colors">取消</button>
              <button onClick={() => { setShowResetConfirm(false); doReset() }} className="rounded-xl bg-red-500/80 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-500 transition-colors">确认重置</button>
            </div>
          </div>
        </div>
      )}

      {/* Shuffle Confirm Modal */}
      {showShuffleConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl bg-[#1a1a1a] border border-white/10 p-8 text-center max-w-sm mx-4 shadow-2xl">
            <p className="text-lg font-bold text-white">确认打乱</p>
            <p className="mt-3 text-sm text-white/60">打乱后句子顺序将随机排列，并从头开始，确定要打乱吗？</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button onClick={() => setShowShuffleConfirm(false)} className="rounded-xl border border-white/10 px-6 py-2.5 text-sm text-white/60 hover:bg-white/5 transition-colors">取消</button>
              <button onClick={() => { setShowShuffleConfirm(false); doShuffle() }} className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition-colors">确认打乱</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl bg-[#1a1a1a] border border-white/10 p-8 text-center max-w-sm mx-4 shadow-2xl">
            <p className="text-lg font-bold text-white">暂停学习</p>
            <p className="mt-3 text-sm text-white/60 leading-relaxed">
              快点回来吧，你的英语能力正在蓄势待发！
            </p>
            <button
              onClick={() => {
                setShowLeaveModal(false)
                setIsPaused(false)
                const s = sentencesRef.current[currentIndexRef.current]
                if (s) globalSpeak(s.english)
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition-colors"
            >
              <Play className="h-4 w-4" />
              继续学习
            </button>
          </div>
        </div>
      )}

      {/* Back Modal */}
      {showBackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl bg-[#1a1a1a] border border-white/10 p-8 text-center max-w-sm mx-4 shadow-2xl">
            <p className="text-lg font-bold text-white">确认返回</p>
            <div className="mt-5 space-y-2.5">
              <Link
                href="/home/store"
                className="block w-full rounded-xl border border-white/10 px-5 py-2.5 text-sm text-white/70 hover:bg-white/5 transition-colors"
              >
                <ShoppingBag className="h-4 w-4 inline mr-2" />
                返回课程列表
              </Link>
              <Link
                href={`/home/store/${courseId}`}
                className="block w-full rounded-xl border border-white/10 px-5 py-2.5 text-sm text-white/70 hover:bg-white/5 transition-colors"
              >
                <BookOpen className="h-4 w-4 inline mr-2" />
                返回课程详情
              </Link>
              <button
                onClick={() => setShowBackModal(false)}
                className="block w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition-colors"
              >
                留下继续学习
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <div className="flex items-center justify-center gap-8 shrink-0 px-6 py-4">
        <button
          onClick={debouncedGoPrev}
          disabled={currentIndex === 0}
          className="flex items-center gap-1 text-sm text-white hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="h-8 w-8" />
          上一句
        </button>

        {/* Keyboard shortcuts */}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <ShortcutBadge keys={["Ctrl", "'"]} label="发音" onClick={() => { const s = sentencesRef.current[currentIndexRef.current]; if (s) globalSpeak(s.english) }} />
          <ShortcutBadge keys={["Ctrl", ";"]} label={showAnswer ? "隐藏答案" : "显示答案"} onClick={debouncedToggleAnswer} />
          <ShortcutBadge keys={["Ctrl", "P"]} label={isPaused ? "继续" : "暂停"} onClick={debouncedTogglePause} />
          <ShortcutBadge keys={["Space"]} label="确认" onClick={debouncedConfirmWord} />
          <ShortcutBadge keys={["Enter"]} label="提交" onClick={debouncedSubmitAll} />
        </div>

        <button
          onClick={debouncedGoNext}
          className="flex items-center gap-1 text-sm text-white hover:text-white/70 transition-colors"
        >
          下一句
          <ChevronRight className="h-8 w-8" />
        </button>
      </div>
    </div>
  )
}
