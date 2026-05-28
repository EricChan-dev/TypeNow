"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { animate } from "animejs"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ArrowLeft, BookOpen, ShoppingBag, Pause, Play, RotateCcw, Shuffle, Maximize, Minimize, Keyboard, List, Settings, Eye, EyeOff } from "lucide-react"
import type { Sentence, Word } from "@/types"

// Tokenize text the same way as textToWords — shared by both helpers
const TOKEN_RE = /[a-zA-Z\d'-]+|[.,!?;:'"()…—]/g

function textToWords(text: string): Word[] {
  const tokens = text.match(TOKEN_RE) ?? []
  return tokens.map((t) => ({
    english: t,
    chinese: null,
    phonetic: null,
    pos: /^[a-zA-Z\d'-]+$/.test(t) ? "词" : "标点",
  }))
}

// Look up each token in the parent sentence's words array to get real phonetics/POS
function matchWordsFromParent(parentWords: Word[], chunkText: string): Word[] {
  const tokens = chunkText.match(TOKEN_RE) ?? []
  const result: Word[] = []
  let startIdx = 0
  for (const token of tokens) {
    let matched = false
    for (let i = startIdx; i < parentWords.length; i++) {
      if (parentWords[i].english.toLowerCase() === token.toLowerCase()) {
        result.push(parentWords[i])
        startIdx = i + 1
        matched = true
        break
      }
    }
    if (!matched) {
      result.push({
        english: token,
        chinese: null,
        phonetic: null,
        pos: /^[.,!?;:]$/.test(token) ? "标点" : "词",
      })
    }
  }
  return result
}

// Flatten DB sentences: if a sentence has chunks, emit one Sentence per chunk
function expandSentences(raw: Sentence[]): Sentence[] {
  return raw.flatMap((s) => {
    if (!s.chunks || s.chunks.length === 0) return [s]
    const parentWords = s.words ?? []
    return [...s.chunks]
      .sort((a, b) => a.order - b.order)
      .map((chunk) => ({
        id: `${s.id}_c${chunk.order}`,
        english: chunk.text,
        chinese: chunk.chinese,
        words_count: chunk.text.trim().split(/\s+/).length,
        category: s.category ?? "daily",
        difficulty: s.difficulty ?? 1,
        tags: s.tags ?? [],
        lesson_id: s.lesson_id,
        words: parentWords.length > 0
          ? matchWordsFromParent(parentWords, chunk.text)
          : textToWords(chunk.text),
        chunks: null,
      }))
  })
}

// ─── POS grouping for completion screen ──────────────────────────────────────
const POS_GROUPS: { label: string; match: string[] }[] = [
  { label: "名词",   match: ["名词"] },
  { label: "动词",   match: ["动词"] },
  { label: "形容词", match: ["形容词"] },
  { label: "副词",   match: ["副词"] },
  { label: "代词",   match: ["代词"] },
  { label: "介词",   match: ["介词"] },
  { label: "并列连词", match: ["并列连词", "连词"] },
  { label: "从属连词", match: ["从属连词"] },
  { label: "感叹词", match: ["感叹词"] },
  { label: "限定词", match: ["冠词", "限定词"] },
  { label: "助动词", match: ["助动词", "情态动词"] },
  { label: "专有名词", match: ["专有名词"] },
  { label: "人名",   match: ["人名"] },
  { label: "数词",   match: ["数词"] },
  { label: "助词",   match: ["助词", "不定式"] },
]

function groupByPos(words: Word[]): Array<{ label: string; words: Word[] }> {
  return POS_GROUPS
    .map((g) => ({
      label: g.label,
      words: words.filter((w) => g.match.includes(w.pos) && w.pos !== "标点"),
    }))
    .filter((g) => g.words.length > 0)
}

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

type ChunkStatus = "idle" | "active" | "done" | "error"

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
  const confettiContainerRef = useRef<HTMLDivElement>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showShuffleConfirm, setShowShuffleConfirm] = useState(false)
  const [transition, setTransition] = useState<{ show: boolean; message: string; onComplete?: () => void }>({ show: false, message: "" })
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Chunk mode state
  const [chunkInput, setChunkInput] = useState("")
  const [activeChunkIndex, setActiveChunkIndex] = useState(0)
  const [chunkStatuses, setChunkStatuses] = useState<ChunkStatus[]>([])
  const [shakeChunk, setShakeChunk] = useState(false)
  const pauseRef = useRef(false)
  pauseRef.current = isPaused
  const timerRef = useRef(timer)
  timerRef.current = timer
  const containerRef = useRef<HTMLDivElement>(null)

  const [courseTitle, setCourseTitle] = useState("课程学习")

  useEffect(() => {
    fetch(`/api/courses/${courseId}`)
      .then((r) => r.json())
      .then((json) => { if (json.data?.title) setCourseTitle(json.data.title) })
      .catch(() => {})
  }, [courseId])

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
  const chunkInputRef = useRef(chunkInput)
  chunkInputRef.current = chunkInput
  const activeChunkIndexRef = useRef(activeChunkIndex)
  activeChunkIndexRef.current = activeChunkIndex
  const chunkStatusesRef = useRef(chunkStatuses)
  chunkStatusesRef.current = chunkStatuses

  useEffect(() => {
    fetch(`/api/courses/sentences?lessonId=${lessonId}`)
      .then((r) => r.json())
      .then((json) => { if (json.sentences) setSentences(expandSentences(json.sentences as Sentence[])) })
      .catch(() => {})
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

  // Initialize word/chunk states for current sentence
  useEffect(() => {
    if (!sentence) return
    setStatus("input")
    globalSpeak(sentence.english)
    if (sentence.chunks && sentence.chunks.length > 0) {
      setChunkInput("")
      setActiveChunkIndex(0)
      setChunkStatuses(sentence.chunks.map((_, i) => i === 0 ? "active" : "idle"))
      setWordStates([])
      setActiveWordIndex(0)
    } else {
      const states: WordState[] = inputWords.map((_w, i) => ({
        value: "",
        status: i === 0 ? "active" : "idle",
      }))
      setWordStates(states)
      setActiveWordIndex(0)
      setChunkInput("")
      setActiveChunkIndex(0)
      setChunkStatuses([])
    }
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

  const confirmChunk = useCallback(() => {
    const st = statusRef.current
    if (st === "complete") return
    const chunks = sentencesRef.current[currentIndexRef.current]?.chunks
    if (!chunks || chunks.length === 0) return
    const activeIdx = activeChunkIndexRef.current
    const expected = chunks[activeIdx]?.text ?? ""
    const input = chunkInputRef.current.trim()

    if (input.toLowerCase() === expected.toLowerCase()) {
      playTick()
      const newStatuses = [...chunkStatusesRef.current]
      newStatuses[activeIdx] = "done"
      const isLast = activeIdx >= chunks.length - 1
      if (isLast) {
        setChunkStatuses(newStatuses)
        setStatus("complete")
        setShowConfetti(true)
        setTimeout(() => setShowConfetti(false), 2000)
        const s = sentencesRef.current[currentIndexRef.current]
        if (s) globalSpeak(s.english)
      } else {
        const nextIdx = activeIdx + 1
        newStatuses[nextIdx] = "active"
        setChunkStatuses(newStatuses)
        setActiveChunkIndex(nextIdx)
        setChunkInput("")
      }
    } else {
      playBuzz()
      const newStatuses = [...chunkStatusesRef.current]
      newStatuses[activeIdx] = "error"
      setChunkStatuses(newStatuses)
      setShakeChunk(true)
      setTimeout(() => {
        setShakeChunk(false)
        const fixed = [...chunkStatusesRef.current]
        fixed[activeChunkIndexRef.current] = "active"
        setChunkStatuses(fixed)
      }, 500)
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

      const currentSentence = sentencesRef.current[currentIndexRef.current]
      const isChunkMode = !!(currentSentence?.chunks && currentSentence.chunks.length > 0)

      if (isChunkMode) {
        const chunks = currentSentence!.chunks!
        const chunkIdx = activeChunkIndexRef.current
        const expectedChunk = chunks[chunkIdx]
        if (!expectedChunk) return

        if (/^[a-zA-Z\s',-]$/.test(e.key)) {
          e.preventDefault()
          playTick()
          setChunkInput((prev) => {
            if (prev.length >= expectedChunk.text.length + 5) return prev
            return prev + e.key
          })
          return
        }
        if (e.key === "Backspace") {
          e.preventDefault()
          playTick()
          setChunkInput((prev) => prev.slice(0, -1))
          return
        }
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault()
          confirmChunk()
          return
        }
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

  // Confetti burst with animejs
  // Fireworks: fast radial burst → slow gravity fall, 5 explosion points
  useEffect(() => {
    const container = confettiContainerRef.current
    if (!showConfetti || !container) return
    container.innerHTML = ""

    const colors = ["#f59e0b","#ef4444","#22c55e","#6366f1","#ec4899","#06b6d4","#f97316","#a855f7","#10b981","#fbbf24","#f43f5e","#fb923c"]
    const centers = [
      { x: 18, y: 48, t: 0 },
      { x: 40, y: 28, t: 160 },
      { x: 62, y: 58, t: 60 },
      { x: 78, y: 30, t: 280 },
      { x: 88, y: 52, t: 190 },
    ]
    const COUNT = 40
    let done = 0

    centers.forEach(({ x, y, t }) => {
      // Pre-compute per-particle burst vectors
      const txArr: number[] = []
      const tyArr: number[] = []
      const gravArr: number[] = []
      const els: HTMLDivElement[] = []

      for (let i = 0; i < COUNT; i++) {
        // Evenly spaced angles with small jitter for true radial burst
        const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.45
        const dist = 90 + Math.random() * 230
        txArr[i] = Math.cos(angle) * dist
        tyArr[i] = Math.sin(angle) * dist
        gravArr[i] = 220 + Math.random() * 180 // how far each falls after burst peak

        const isRibbon = Math.random() < 0.38
        const sz = isRibbon ? 0 : 5 + Math.random() * 8
        const color = colors[Math.floor(Math.random() * colors.length)]
        const el = document.createElement("div")
        el.style.cssText = [
          "position:absolute",
          `left:${x}%`,
          `top:${y}%`,
          `width:${isRibbon ? 2 + Math.random() * 3 : sz}px`,
          `height:${isRibbon ? 14 + Math.random() * 18 : sz * 0.5}px`,
          `background:${color}`,
          `border-radius:${isRibbon ? 1 : 3}px`,
          "opacity:0",
          "transform-origin:center",
          "will-change:transform,opacity",
        ].join(";")
        container.appendChild(el)
        els.push(el)
      }

      setTimeout(() => {
        // Phase 1 — fast radial burst outward (350ms, out(5))
        animate(els, {
          translateX: (_: Element, i: number) => txArr[i],
          translateY: (_: Element, i: number) => tyArr[i],
          rotate: () => Math.random() * 540 - 270,
          scale: [0.2, 1],
          opacity: [0, 1],
          duration: 350,
          ease: "out(5)",
          delay: (_: Element, i: number) => i * 4,
        })

        // Phase 2 — gravity fall (starts 280ms in, in(2) acceleration)
        setTimeout(() => {
          animate(els, {
            translateY: (_: Element, i: number) => tyArr[i] + gravArr[i],
            opacity: 0,
            scale: 0.08,
            duration: () => 950 + Math.random() * 450,
            ease: "in(2)",
            delay: (_: Element, i: number) => i * 3,
            onComplete: () => {
              done++
              if (done >= centers.length) container.innerHTML = ""
            },
          })
        }, 280)
      }, t)
    })
  }, [showConfetti])

  // Underline pop when active word changes
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-underline="${activeWordIndex}"]`)
    if (!el) return
    animate(el, {
      scaleY: [1, 2.2, 1],
      scaleX: [1, 1.06, 1],
      opacity: [0.6, 1, 1],
      duration: 280,
      ease: "out(3)",
    })
  }, [activeWordIndex])

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
          <div className="w-full max-w-2xl space-y-10">
            <CompletedSentence words={sentence.words || []} />

            {/* Full Chinese translation */}
            <p className="text-center text-2xl font-bold text-white/80">
              {sentence.chinese}
            </p>

            {/* POS groupings */}
            {(() => {
              const groups = groupByPos(sentence.words || [])
              if (groups.length === 0) return null
              return (
                <div className="flex flex-col gap-2 px-2">
                  {groups.map((g) => (
                    <div key={g.label} className="flex items-center gap-2 flex-wrap">
                      <span className="shrink-0 text-[11px] font-medium text-white/40 w-16 text-right">
                        {g.label}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {g.words.map((w, i) => (
                          <span
                            key={i}
                            className="rounded-md bg-white/[0.06] border border-white/10 px-2 py-0.5 text-sm text-white/80"
                          >
                            {w.english}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            <p className="text-center text-xl text-white/50 font-medium">
              按 Enter 继续下一句
            </p>
          </div>
        ) : sentence.chunks && sentence.chunks.length > 0 ? (
          /* Chunk Mode Input */
          <div className="w-full max-w-2xl space-y-8">
            {/* Current chunk Chinese hint */}
            <p className="text-center text-2xl font-medium text-foreground">
              {sentence.chunks[activeChunkIndex]?.chinese ?? sentence.chinese}
            </p>

            {/* Chunk progress row */}
            <div className="flex flex-wrap justify-center items-center gap-3">
              {sentence.chunks.map((chunk, i) => {
                const status = chunkStatuses[i]
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <div
                      className={`
                        min-h-[64px] flex items-center justify-center px-4 text-4xl font-medium transition-colors rounded-xl
                        ${status === "done"
                          ? "text-foreground"
                          : status === "error"
                            ? "text-red-500"
                            : status === "active"
                              ? "text-accent"
                              : "text-transparent"
                        }
                        ${i === activeChunkIndex && shakeChunk ? "animate-shake" : ""}
                      `}
                      style={{ minWidth: chunk.text.length * 28 + 24 }}
                    >
                      {status === "done"
                        ? chunk.text
                        : status === "active"
                          ? chunkInput || " "
                          : " "
                      }
                    </div>
                    <div
                      className={`h-[3px] rounded-full transition-all duration-200 ${
                        status === "error"
                          ? "bg-red-500"
                          : status === "done"
                            ? "bg-foreground/40"
                            : status === "active"
                              ? "bg-accent shadow-[0_0_6px_var(--accent)]"
                              : "bg-foreground/20"
                      }`}
                      style={{ width: chunk.text.length * 28 + 24 }}
                    />
                    <span className="text-xs text-white/30">{chunk.chinese}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Word Mode Input */
          <div className="w-[82%] max-w-4xl space-y-8">
            <p className="text-center text-4xl font-semibold text-foreground">
              {sentence.chinese}
            </p>

            <div className="flex flex-wrap justify-center items-end gap-x-4 gap-y-4">
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
                const isPending = !ws || ws.status === "idle"

                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center gap-[5px] ${isShaking ? "animate-shake" : ""}`}
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
                      data-underline={wsIdx}
                      className={`h-[3px] transition-colors duration-150 ${
                        ws?.status === "error"
                          ? "bg-red-500"
                          : ws?.status === "done"
                            ? "bg-foreground/40"
                            : isActive
                              ? "bg-accent shadow-[0_0_8px_var(--accent)]"
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

      {/* Confetti — particles injected imperatively by animejs effect */}
      <div
        ref={confettiContainerRef}
        className="fixed inset-0 z-40 pointer-events-none overflow-hidden"
      />

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
