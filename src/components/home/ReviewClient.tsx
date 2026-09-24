"use client"

import { useState, useEffect, useRef, useCallback, type RefObject } from "react"
import { animate } from "animejs"
import { useRouter } from "next/navigation"
import { X, CheckCircle2, RotateCcw, BookOpen } from "lucide-react"
import { CompletedSentence } from "@/components/home/learn/CompletedSentence"
import { TypedChars } from "@/components/home/TypedChars"
import type { Word } from "@/types"
import { cn } from "@/lib/utils"
import { isTypingMatch, isTypingPrefix } from "@/lib/typing-compare"
import { alignWordsWithEnglish } from "@/lib/word-align"
import { classifyTypingKey, isEditableTarget } from "@/lib/typing-keys"
import { playBuzz, playTick } from "@/lib/sfx"

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
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const softKeyboardRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<"input" | "complete" | "grading">("input")
  const [wordStates, setWordStates] = useState<WordState[]>([])
  const [activeWordIndex, setActiveWordIndex] = useState(0)
  const [shakeWords, setShakeWords] = useState<Set<number>>(new Set())
  const [errorCount, setErrorCount] = useState(0)
  const errorCountRef = useRef(errorCount)
  errorCountRef.current = errorCount
  /** 本句已经记过错的词下标 —— 同一个词反复打错只算一次，错误数不随退格重打飙升。 */
  const mistakeWordsRef = useRef<Set<number>>(new Set())
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
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => {
        // 请求失败绝不能伪装成「今日暂无待复习内容」：只在确实拿到数组时认为成功
        if (Array.isArray(json?.items)) {
          setItems(json.items)
        } else {
          setLoadError(true)
        }
        setLoading(false)
      })
      .catch((e) => {
        console.error("[Review] 复习队列加载失败:", e)
        setLoadError(true)
        setLoading(false)
      })
  }, [reloadKey])

  const sentence = items[currentIdx]
  // words 以 english 的分词为骨架重建（标点必然与翻译一致），库里的 words 只补音标/词性
  const words: Word[] = alignWordsWithEnglish(sentence?.english, sentence?.words ?? null)
  const inputWords = getInputWords(words)

  // Reset word states when sentence changes
  useEffect(() => {
    if (!sentence) return
    setStatus("input")
    setErrorCount(0)
    mistakeWordsRef.current = new Set()
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

    // Persist the review attempt so home/archive stats include review practice
    await fetch("/api/practice/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sentenceId: item.sentenceId,
        mistakes: errorCountRef.current,
        isReview: true,
      }),
    }).catch(() => {})

    const next = currentIdxRef.current + 1
    if (next >= itemsRef.current.length) {
      setDone(true)
    } else {
      setCurrentIdx(next)
      setStatus("input")
    }
  }, [])

  /** 当前词打完了：标 done，然后决定是「下一格」还是「进评分」。 */
  const completeWord = useCallback((activeIdx: number, value: string, words: Word[]) => {
    setWordStates((prev) => {
      const ns = [...prev]
      ns[activeIdx] = { value, status: "done" }
      return ns
    })
    const isLast = activeIdx >= words.length - 1
    if (!isLast) {
      const nextIdx = activeIdx + 1
      setActiveWordIndex(nextIdx)
      setWordStates((prev) => {
        const ns = [...prev]
        ns[nextIdx] = { ...ns[nextIdx], status: "active" }
        return ns
      })
      return
    }
    // 全句零错误 → 直接判定已掌握，不必再问一遍「掌握得怎么样」。
    // 用 ref 判而不是 errorCountRef：后者要等这一轮渲染提交才会更新。
    if (mistakeWordsRef.current.size === 0) {
      submitGrade(5, true)
      const next = currentIdxRef.current + 1
      if (next >= itemsRef.current.length) setDone(true)
      else { setCurrentIdx(next); setStatus("input") }
      return
    }
    setStatus("grading")
  }, [submitGrade])

  /** 记一次错：出声、抖动、计数。计数按「词」去重，同一个词反复打错只算一次。 */
  const flagWrong = useCallback((activeIdx: number) => {
    playBuzz()
    if (!mistakeWordsRef.current.has(activeIdx)) {
      mistakeWordsRef.current.add(activeIdx)
      setErrorCount((c) => c + 1)
    }
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
  }, [])

  const handleInput = useCallback((e: KeyboardEvent) => {
    // 焦点在真实输入框里就放手（软键盘捕获框是唯一例外，手机全靠它带动键盘事件）。
    // 原先没有任何焦点守卫，设置弹窗里的输入框会被这里的按键逻辑抢走。
    const target = e.target as HTMLElement | null
    if (isEditableTarget({
      tagName: target?.tagName,
      isContentEditable: target?.isContentEditable,
      isSoftKeyboardInput: target === softKeyboardRef.current,
    })) return

    // 只有「逐词输入」阶段接管按键；评分阶段交给按钮（Enter 落在聚焦的按钮上）
    if (statusRef.current !== "input") return

    const action = classifyTypingKey(e)
    if (action === "ignore") return

    const ws = wordStatesRef.current
    const activeIdx = activeWordIndexRef.current
    // 必须与渲染用的是同一套对齐结果，否则输入格下标会和键盘处理错位
    const cur = itemsRef.current[currentIdxRef.current]
    const words = getInputWords(alignWordsWithEnglish(cur?.english, cur?.words ?? null))

    if (!words[activeIdx]) return

    const expected = words[activeIdx].english
    const currentVal = ws[activeIdx]?.value ?? ""

    if (action === "backspace") {
      e.preventDefault()
      if (currentVal.length === 0) return
      const newVal = currentVal.slice(0, -1)
      setWordStates((prev) => {
        const next = [...prev]
        // 状态必须跟着回退，否则删回正确前缀了还挂着红色
        next[activeIdx] = { value: newVal, status: isTypingPrefix(newVal, expected) ? "active" : "error" }
        return next
      })
      return
    }

    // 空格 = 确认当前词，与练习页统一。
    // 旧写法把空格当普通字符追加（`e.key.length === 1` 就收），于是「hel␣l」被
    // normalizeForTyping 折叠空白后必然判错，用户按正常习惯打空格每一下都记一次错。
    if (action === "confirm") {
      e.preventDefault()
      // 空着按空格什么都不做：不能算错，也不能前进
      if (!currentVal) return
      if (isTypingMatch(currentVal, expected)) {
        completeWord(activeIdx, currentVal, words)
      } else {
        setWordStates((prev) => {
          const ns = [...prev]
          ns[activeIdx] = { value: currentVal, status: "error" }
          return ns
        })
        flagWrong(activeIdx)
      }
      return
    }

    // 单字符输入（含标点/数字）：不再静默吞键，敲错立刻标红并可退格
    e.preventDefault()
    playTick()

    const next = currentVal + e.key
    const correctSoFar = isTypingPrefix(next, expected)
    const fullMatch = isTypingMatch(next, expected)

    if (fullMatch) {
      completeWord(activeIdx, next, words)
      return
    }

    setWordStates((prev) => {
      const ns = [...prev]
      ns[activeIdx] = { value: next, status: correctSoFar ? "active" : "error" }
      return ns
    })
    if (!correctSoFar) flagWrong(activeIdx)
  }, [completeWord, flagWrong])

  useEffect(() => {
    window.addEventListener("keydown", handleInput)
    return () => window.removeEventListener("keydown", handleInput)
  }, [handleInput])

  if (loading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <SoftKeyboardInput inputRef={softKeyboardRef} />
        <div className="text-foreground/40 text-sm">加载中…</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-5">
        <BookOpen className="h-12 w-12 text-foreground/20" />
        <p className="text-foreground/60 text-lg font-medium">复习队列加载失败</p>
        <p className="text-foreground/30 text-sm">网络或服务异常，你的复习进度没有丢失</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={() => {
              setLoadError(false)
              setLoading(true)
              setReloadKey((k) => k + 1)
            }}
            className="px-5 py-2 rounded-xl bg-accent text-primary-foreground text-sm font-semibold hover:bg-accent/90 transition-colors"
          >
            重新加载
          </button>
          <button
            onClick={() => router.push("/home/review")}
            className="px-5 py-2 rounded-xl border border-border text-foreground/70 text-sm font-semibold hover:bg-muted transition-colors"
          >
            返回主页
          </button>
        </div>
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
    <div
      className="fixed inset-0 bg-background flex flex-col select-none"
      onPointerDown={(e) => {
        if (e.pointerType === "touch") softKeyboardRef.current?.focus()
      }}
    >
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

      {/* Main content

          同样不能用 justify-center 居中（见 LearnClient 里的说明）：在 overflow-y-auto
          容器里会让超出部分滚不回来，长句的第一行会被永久裁掉。
          用 mt-auto / mb-auto 替代：装得下就居中，装不下就顶对齐并完整滚动。 */}
      <div className="flex-1 flex flex-col items-center px-8 py-10 overflow-y-auto gap-8">
        {/* Chinese hint */}
        <p className="mt-auto text-2xl font-semibold text-foreground/70 text-center max-w-2xl">
          {sentence.chinese}
        </p>

        {status === "grading" ? (
          /* Grading view */
          <div className="mb-auto flex flex-col items-center gap-8 w-full max-w-2xl">
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
          <div className="mb-auto flex flex-wrap justify-center items-end gap-x-4 gap-y-4 w-[88%] max-w-5xl">
            {words.map((word, i) => {
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

              const isPending = !ws || ws.status === "idle"

              return (
                <div
                  key={i}
                  className={cn("relative grid grid-cols-1 place-items-center gap-[5px]", isShaking && "animate-shake")}
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
                  {/* 宽度由不可见的期望单词撑开，不再按字数估（i/l 与 W/M 宽度差很大） */}
                  <div
                    className={cn(
                      "col-start-1 row-start-1 grid place-items-center h-16 text-6xl font-medium transition-colors",
                      ws?.status === "done" ? "text-foreground"
                        // 错词不再整格染红：由 TypedChars 标出「错在第几个字母」
                        : ws?.status === "error" ? "text-foreground"
                        : isActive ? "text-accent"
                        : "text-transparent"
                    )}
                  >
                    <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre px-1">
                      {word.english}
                    </span>
                    <span className="col-start-1 row-start-1 whitespace-pre px-1">
                      <TypedChars value={ws?.value || ""} expected={word.english} />
                    </span>
                  </div>
                  <div
                    data-underline={wsIdx}
                    className={cn(
                      "col-start-1 row-start-2 w-full h-[3px] transition-colors duration-150",
                      ws?.status === "error" ? "bg-red-500"
                        : ws?.status === "done" ? "bg-foreground/40"
                        : isActive ? "bg-accent shadow-[0_0_8px_var(--accent)]"
                        : "bg-foreground/20"
                    )}
                    style={{ clipPath: "polygon(0 0, 100% 0, calc(100% - 2px) 100%, 2px 100%)" }}
                  />
                  {/* 打错了就把正确拼写摆出来：答案是默认不给看的，
                      错词又不指出错在哪，用户只能退格硬猜。只在该词出错后显示，不提前剧透。
                      绝对定位：单词行是 items-end 对齐的，新增一行会把出错那个词顶高。 */}
                  {ws?.status === "error" && (
                    <span className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap px-1 text-xs font-medium text-emerald-400/80">
                      {word.english}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <SoftKeyboardInput inputRef={softKeyboardRef} />
    </div>
  )
}

/**
 * 移动端软键盘捕获框（与 LearnClient 里的同名组件一致）。
 *
 * 复习页同样只监听 document 的 keydown，页面上没有可见输入框。触摸设备必须有真实
 * input 才能唤起软键盘，且**不能是 readOnly**——iOS 对 readOnly 的 input 不弹键盘，
 * 这个组件的前身就是 readOnly，等于手机上完全敲不了字。
 */
function SoftKeyboardInput({
  inputRef,
}: {
  inputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <input
      ref={inputRef}
      className="fixed bottom-0 left-0 h-px w-px opacity-0 pointer-events-none"
      value=""
      onChange={() => {}}
      tabIndex={-1}
      aria-hidden
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
    />
  )
}
