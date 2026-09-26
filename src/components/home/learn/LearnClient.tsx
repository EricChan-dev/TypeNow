"use client"

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, Fragment, type RefObject } from "react"
import { animate } from "animejs"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ArrowLeft, BookOpen, ShoppingBag, Pause, Play, RotateCcw, Shuffle, Maximize, Minimize, Keyboard, List, Settings, Eye, EyeOff, Volume2 } from "lucide-react"
import type { Sentence, Word } from "@/types"
import { isTypingMatch, isTypingPrefix } from "@/lib/typing-compare"
import { classifyTypingKey, isEditableTarget } from "@/lib/typing-keys"
import { TypedChars } from "@/components/home/TypedChars"
import { findNextLesson } from "@/lib/course-nav"
import { playTick, playBuzz, playChime } from "@/lib/sfx"
import {
  dismissDesktopNotice,
  getDesktopNoticeServerSnapshot,
  getDesktopNoticeSnapshot,
  subscribeDesktopNotice,
} from "@/lib/desktop-only"

import { alignWordsWithEnglish } from "@/lib/word-align"

// Flatten DB sentences: if a sentence has chunks, emit one Sentence per chunk
function expandSentences(raw: Sentence[]): Sentence[] {
  return raw.flatMap((s) => {
    if (!s.chunks || s.chunks.length === 0) {
      // words 以 english 的分词为骨架重建：导入的 words 普遍缺标点，
      // 直接用会让练习页那行的标点与翻译对不上。
      const normalized: Sentence = { ...s, words: alignWordsWithEnglish(s.english, s.words) }
      return [normalized]
    }
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
        words: alignWordsWithEnglish(chunk.text, parentWords),
        chunks: null,
      }))
  })
}

// ─── POS grouping for completion screen ──────────────────────────────────────

import { TransitionOverlay } from "@/components/shared/TransitionOverlay"
import { TooltipButton } from "@/components/shared/TooltipButton"
import { OutlineModal } from "@/components/home/learn/OutlineModal"
import { SettingsModal } from "@/components/home/learn/SettingsModal"
import { CompletedSentence } from "@/components/home/learn/CompletedSentence"
import { SentenceFeedback, type FeedbackVariant } from "@/components/home/learn/SentenceFeedback"
import { VoicePanel } from "@/components/home/learn/VoicePanel"
import { SentenceTreeModal } from "@/components/home/learn/DependencyTree"
import { SentenceExplainModal } from "@/components/home/learn/SentenceExplainModal"
import { WordDetailPopover } from "@/components/home/learn/WordDetailPopover"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import { baseSentenceId } from "@/lib/sentence-id"
import { decideResume } from "@/lib/practice-session"
import { toast } from "sonner"
import { TRIAL_DAYS } from "@/lib/trial-days"
import { trackLessonStart, trackPracticeComplete, trackPaywallShown, trackTrialClaimed } from "@/lib/analytics"

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

// 音效已统一到 @/lib/sfx：那里收敛了原来散在本页与 ReviewClient 的两套实现
// （同一个产品里「错了」的声音却不一样），并加上了可持久化的总开关。

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
      className="inline-flex items-center gap-1 rounded-lg border border-foreground/30 bg-foreground/[0.06] px-2.5 py-1.5 text-xs hover:bg-foreground/[0.12] hover:border-foreground/50 transition-colors"
    >
      {keys.map((k, i) => (
        <span key={i}>
          <kbd className="rounded border border-foreground/30 bg-foreground/[0.08] px-1 py-0.5 text-[11px] text-foreground font-medium">{k}</kbd>
          {i < keys.length - 1 && <span className="text-foreground/60 mx-0.5">+</span>}
        </span>
      ))}
      <span className="text-foreground/70 ml-0.5">{label}</span>
    </button>
  )
}

interface ShortcutItem {
  keys: string[]
  label: string
  action?: () => void
  disabled?: boolean
}

/**
 * 移动端软键盘捕获框（尽全力而为，不是承诺）。
 *
 * 练习页的输入**完全**依赖 document 上的 keydown，页面上没有任何可见输入框；
 * 而触摸设备没有物理键盘，一个 div 即使拿到了焦点也唤不起软键盘。
 * 这个 input 的作用只是把软键盘叫出来，让 keydown 有机会发生。
 *
 * 产品口径是 **PC 优先**：软键盘能否吐出可用的 keydown 取决于各家输入法，
 * 实测并不可靠；彻底修好需要把输入层改成 beforeinput/input 事件差分，
 * 工作量大且收益不确定，因此不做。触屏设备上由 Layer 2.4 的提示引导用户换电脑。
 * 保留这个捕获框是因为它对部分 Android 输入法确实有效，且成本为零——
 * 拿掉只会让本就能用的场景也一起失效。
 *
 * 两个坑：
 *   1. 必须是「可编辑」的 input。readOnly 的 input 在 iOS 上**不会**唤起软键盘
 *      （ReviewClient 原来的移动端 input 就是 readOnly，等于没生效）；
 *   2. 值恒为空，避免未处理的按键把字符堆进输入框里。
 * 键盘事件依旧由 document 上的 keydown 统一处理，这里只负责把键盘叫出来。
 * 由父级在 touch 的 pointerdown 上调用 focus()——必须在用户手势的调用栈里。
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

/**
 * 「这课没得练 / 加载失败」的兜底画面。
 *
 * 存在的理由：练习页原来只用 `!sentence` 一个条件就返回「正在加载课程内容…」的开场
 * 动画，于是接口报错（403/404/500，响应体里没有 sentences）和空课时都会**永远**停在
 * 那个画面上——进度条走满、转圈不停、没有任何文字说明，用户只能刷新或退出。
 */
function LearnClientMessage({
  title,
  description,
  courseId,
  onRetry,
}: {
  title: string
  description: string
  courseId: string
  onRetry?: () => void
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 px-6 py-20 text-center">
      <div className="w-14 h-14 rounded-2xl border border-border bg-muted flex items-center justify-center">
        <BookOpen className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground max-w-md">{description}</p>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Link
          href={`/home/store/${courseId}`}
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          返回课程详情
        </Link>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 transition-colors"
          >
            重新加载
          </button>
        )}
      </div>
    </div>
  )
}

export function LearnClient({
  courseId,
  lessonId,
}: {
  courseId: string
  lessonId: string
}) {
  const [sentences, setSentences] = useState<Sentence[]>([])
  /** 加载态：以前只有「取到句子」和「没取到句子」两种，空课时与接口报错都表现为无限加载。 */
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading")
  /**
   * 非会员试学状态。接口只下发每课前 FREE_TRIAL_SENTENCES 句，
   * truncated 表示「本课还有更多句子被挡住了」——练完这几句不能再显示
   * 「你已完成本课全部 N 个句子」，那是假话，要改为付费引导。
   */
  const [trial, setTrial] = useState<{ limit: number; truncated: boolean } | null>(null)
  /**
   * 是否还能领体验会员（非会员且从未领过）。为 true 时试学墙的主按钮是
   * 「免费领取 5 天体验会员」，否则才是「开通会员」——两句引导的转化含义完全不同，
   * 对着没领过的人直接要钱会白白损失一次免费体验带来的留存。
   */
  const [trialAvailable, setTrialAvailable] = useState(false)
  const [claimingTrial, setClaimingTrial] = useState(false)
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
  const [showCompletionModal, setShowCompletionModal] = useState(false)
  const [errorCount, setErrorCount] = useState(0)
  const consecutivePerfectRef = useRef(0)
  const sentenceHasErrorRef = useRef(false)
  // 当前句累计错误次数 —— 写入 practice_records 并按 10/6/2 折算 score
  const sentenceMistakesRef = useRef(0)
  const sentenceStartTimeRef = useRef(Date.now())
  const [feedback, setFeedback] = useState<{ trigger: number; variant: FeedbackVariant; streak: number; earned: number }>({ trigger: 0, variant: "great", streak: 0, earned: 0 })
  const loadingBarRef = useRef<HTMLDivElement>(null)
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
  // 手机上必须有真实 input 才能唤起软键盘（详见渲染处的注释）
  const softKeyboardRef = useRef<HTMLInputElement>(null)

  const [courseTitle, setCourseTitle] = useState("课程学习")

  useEffect(() => {
    fetch(`/api/courses/${courseId}`)
      .then((r) => r.json())
      .then((json) => { if (json.data?.title) setCourseTitle(json.data.title) })
      .catch((e) => { console.error(e) })
  }, [courseId])

  // Record study time locally and persist to backend
  useEffect(() => {
    try {
      const histKey = "typenow_study_history"
      const history = JSON.parse(localStorage.getItem(histKey) || "{}")
      history[courseId] = Date.now()
      localStorage.setItem(histKey, JSON.stringify(history))
    } catch {}
    // Persist to backend (fire-and-forget)
    fetch("/api/user/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, sentenceCount: 0 }),
    }).catch((e) => { console.error(e) })
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

  // 错句追踪：记本次练习中出过错的句子 id，完成弹窗据此提供「再练错句」。
  // 存 id 而不是下标 —— 打乱顺序（doShuffle）之后下标就失效了。
  const errorSentenceIdsRef = useRef<Set<string>>(new Set())
  /**
   * 错句数量。渲染里必须读 state 而不是 ref：ref 存在只代表写过了，
   * 不代表 React 会重渲染 —— 完成弹窗上的「再练错句 (N)」会停在旧数字上。
   */
  const [errorSentenceCount, setErrorSentenceCount] = useState(0)
  /** 进入课时时的完整句子表，「再练错句」之后要能还原回来。 */
  const fullSentencesRef = useRef<Sentence[]>([])
  const [isErrorRun, setIsErrorRun] = useState(false)
  /** 下一课，用于完成弹窗的「继续下一课」。 */
  const [nextLesson, setNextLesson] = useState<{ id: string; title?: string } | null>(null)

  /** 依存句子树（Ctrl+2）与句子解析（Ctrl+/）两个讲解弹窗。 */
  const [showTree, setShowTree] = useState(false)
  const [showExplain, setShowExplain] = useState(false)

  /**
   * 本次练习里已经「做完过」的句子 id。
   *
   * 用途：语法树 / 句子解析会直接把英文原句摆出来，是剧透。已完成的句子
   * 再看不该被拦一道「仍要查看？」，但那道拦截又不能只看当前状态 ——
   * 用户用 Shift+← 回头翻已经做完的句子时 status 会变回 input，
   * 只认 status 就会给一句自己刚打完的句子弹剧透确认，很蠢。
   * 所以按句子累计记下来，回看时仍然算「已揭示」。
   */
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())

  /**
   * 首句自动发音被浏览器拦下（没有用户手势就说不了话）。
   * 置真后渲染一个「点击开启发音」的小按钮，让用户用一次点击把音频解锁。
   */
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false)

  /**
   * 本次进入课时被恢复到了第 N 句（1 基，给人看的）。
   * null = 没有可恢复的进度。用户关掉或点「从头开始」后清空。
   */
  const [resumeNotice, setResumeNotice] = useState<number | null>(null)

  /**
   * 输入是否应当被冻结：暂停中，或任何弹窗 / 过渡层打开时。
   *
   * 原先的键盘处理对这两件事完全不设防 —— 暂停弹窗、设置弹窗、重置确认框
   * 开着时，敲字母照样打进题目，空格照样触发确认；设置面板里的 range 输入
   * 也会被 document 上的监听抢走按键。
   */
  const inputBlocked =
    isPaused || transition.show || showLeaveModal || showBackModal || showSettings ||
    showOutline || showShortcuts || showResetConfirm || showShuffleConfirm || showCompletionModal ||
    showTree || showExplain
  const inputBlockedRef = useRef(false)
  inputBlockedRef.current = inputBlocked

  // 查出「下一课」。接口已按 sort_order 升序返回，顺序口径以它为准（见 course-nav）。
  useEffect(() => {
    fetch(`/api/courses/${courseId}/lessons`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (Array.isArray(json?.data)) {
          setNextLesson(findNextLesson(json.data as Array<{ id: string; title?: string }>, lessonId))
        }
      })
      .catch((e) => { console.error(e) })
  }, [courseId, lessonId])

  // 触屏设备上提示改用电脑。
  //
  // 用订阅式读值而不是在 effect 里 setState，理由与 sfx 开关相同：
  // 服务端不知道设备形态，先渲染再撤掉会让提示条闪一下；订阅还能在
  // 用户在平板上插上鼠标/键盘时（(hover: none) 变 false）自动收起提示。
  const showDesktopNotice = useSyncExternalStore(
    subscribeDesktopNotice,
    getDesktopNoticeSnapshot,
    getDesktopNoticeServerSnapshot,
  )

  useEffect(() => {
    // 进入练习页 = 漏斗里「真的开始学」的那一步。这个 effect 在切换课时时会重跑，
    // 正好对应「开始练另一课」，不需要额外去重。
    trackLessonStart(courseId, lessonId)
    fetch(`/api/courses/sentences?lessonId=${lessonId}`)
      .then((r) => r.json())
      .then((json) => {
        // 必须区分「还在加载」「接口报错」「这课确实没有可练的句子」。
        // 以前只判断 json.sentences 存不存在就 setSentences，于是：
        //   接口 403/404/500（响应体里没有 sentences）→ 数组永远是空的 →
        //   页面永远停在「正在加载课程内容…」，用户看不到任何原因；
        //   空课时（线上真实存在，夹具里就有「空课时」）→ 同样是无限加载。
        if (Array.isArray(json?.sentences)) {
          const expanded = expandSentences(json.sentences as Sentence[])
          setTrial(json?.trial ?? null)
          setTrialAvailable(!!json?.trialAvailable)
          // 记下完整句子表：「再练错句」会临时把 sentences 收窄成错句子集，
          // 不能因此丢掉整节课。
          fullSentencesRef.current = expanded
          setSentences(expanded)
          setLoadState("ready")

          // 恢复上次练到的位置。
          // 「恢复到第几句」的判定全在 lib/practice-session（纯函数、有单测），
          // 这里只负责把结果套到界面上：越界一律夹回可用下标，
          // 绝不让恢复反而把用户送进一个读不到句子的空屏。
          fetch(`/api/practice/sessions?lessonId=${lessonId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((res) => {
              const decision = decideResume(res?.session, expanded.length)
              if (!decision.restored) return
              setCurrentIndex(decision.index)
              setResumeNotice(decision.index)
            })
            .catch((e) => { console.error(e) })
        } else {
          setLoadState("error")
        }
      })
      .catch((e) => { console.error(e); setLoadState("error") })
    // courseId 也是这个 effect 的输入（埋点要带上它），所以必须列进依赖，
    // 否则换课程时不会重新上报 lesson_start。
  }, [lessonId, courseId])

  /**
   * 领取体验会员（5 天）。
   *
   * 服务端是条件更新（trial_claimed_at IS NULL），天然幂等：重复点击、并发请求
   * 只有一次成功，所以这里不需要防抖式的本地锁，`claimingTrial` 只用于按钮态。
   * 成功后整页 reload —— 会员状态散落在开场画面、付费墙、进度等处的服务端数据里，
   * 局部 setState 很容易漏掉某一处，刷新一次最省心也不会有不一致。
   */
  const claimTrialMembership = useCallback(async () => {
    if (claimingTrial) return
    setClaimingTrial(true)
    try {
      const res = await fetch("/api/trial/claim", { method: "POST" })
      if (res.ok) {
        // 埋点必须在 reload 之前发出。track() 用的是 keepalive，
        // 刷新不会掐断这次上报。
        trackTrialClaimed(TRIAL_DAYS)
        toast.success(`已领取 ${TRIAL_DAYS} 天体验会员`)
        window.location.reload()
        return
      }
      const data = await res.json().catch(() => null)
      toast.error(data?.error ?? "领取失败，请稍后再试")
    } catch {
      toast.error("网络异常，请稍后再试")
    }
    setClaimingTrial(false)
  }, [claimingTrial])

  /**
   * 付费墙曝光。试学墙是这次新加的转化节点，必须能看到「露出多少次、
   * 其中可领取的占多少」——否则无法判断它到底拦住了人还是转化了人。
   */
  useEffect(() => {
    if (showCompletionModal && trial?.truncated) {
      trackPaywallShown(trialAvailable ? "trial_available" : "trial_end")
    }
  }, [showCompletionModal, trial?.truncated, trialAvailable])

  // 开场进度条的装饰动画。
  //
  // 注意：它**不**决定用户要等多久。练习内容什么时候出现只看 `sentence`
  // 有没有值（见下面 `if (!sentence)` 的开场画面），数据一到就直接进练习页，
  // 这条动画连播都没播完也照进不误。下面那段「至少显示 2 秒」只是把进度条
  // 数字补到 100% 好看，不构成任何等待。别再把它当成加载闸门来改。
  const loadingStartRef = useRef(Date.now())
  const [loadingPercent, setLoadingPercent] = useState(0)
  const loadingAnimRef = useRef<ReturnType<typeof animate> | null>(null)
  useEffect(() => {
    loadingStartRef.current = Date.now()
    const bar = loadingBarRef.current
    if (!bar) return
    let val = { pct: 0 }
    setLoadingPercent(0)
    loadingAnimRef.current = animate(val, {
      pct: 100,
      duration: 2200,
      ease: "out(2)",
      onUpdate: () => setLoadingPercent(Math.round(val.pct)),
    })
    return () => { loadingAnimRef.current = null }
  }, [])
  // 数据到了就把进度条补满，但补满的过程不超过 2 秒（纯视觉收尾）
  useEffect(() => {
    if (sentences.length === 0) return
    const elapsed = Date.now() - loadingStartRef.current
    const remaining = Math.max(0, 2000 - elapsed)
    const finish = () => {
      setLoadingPercent(100)
      loadingAnimRef.current = null
    }
    if (remaining > 0) {
      setTimeout(finish, remaining)
    } else {
      finish()
    }
  }, [sentences])

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

  // Update backend progress whenever a sentence is completed
  useEffect(() => {
    if (completedCount === 0) return
    fetch("/api/user/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, sentenceCount: completedCount }),
    }).catch((e) => { console.error(e) })
  }, [completedCount, courseId])

  // Enqueue current sentence for spaced-repetition review when completed
  useEffect(() => {
    if (status !== "complete") return
    const s = sentencesRef.current[currentIndexRef.current]
    if (!s?.id) return
    const parentId = baseSentenceId(s.id)
    fetch("/api/review/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentenceId: parentId }),
    }).catch((e) => { console.error(e) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  /**
   * 上报练习进度，供下次进入时恢复（配合上面的 GET /api/practice/sessions）。
   *
   * 只在「整节课、按原顺序」的练习里上报。判据是数组同一性：
   * 只有完整课时的 sentences 与 fullSentencesRef.current 是同一个对象，
   * 「再练错句」会换成错句子集、打乱会换成新数组，两者的下标都跟原课对不上，
   * 拿它们上报会把用户的真实进度覆盖成一个错位的位置。
   */
  useEffect(() => {
    if (status !== "complete") return
    if (sentencesRef.current !== fullSentencesRef.current) return
    const idx = currentIndexRef.current
    const total = sentencesRef.current.length
    if (total === 0) return
    fetch("/api/practice/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId,
        courseId,
        // current_index 的语义是「下一句要练的下标」，不是「已练句数」
        currentIndex: idx + 1,
        sentenceCount: total,
        mistakeCount: sentenceMistakesRef.current,
        elapsedSeconds: timerRef.current,
        state: idx >= total - 1 ? "completed" : "active",
      }),
    }).catch((e) => { console.error(e) })
  }, [status, lessonId, courseId])

  // Persist the practice attempt. This is the only writer of practice_records,
  // which /api/home/stats and /api/archive/stats aggregate.
  useEffect(() => {
    if (status !== "complete") return
    const s = sentencesRef.current[currentIndexRef.current]
    if (!s?.id) return
    const parentId = baseSentenceId(s.id)
    const userInput = wordStatesRef.current
      .map((w) => w?.value ?? "")
      .join(" ")
      .trim()
    fetch("/api/practice/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sentenceId: parentId,
        mistakes: sentenceMistakesRef.current,
        userInput: userInput || null,
      }),
    }).catch((e) => { console.error(e) })
  }, [status])

  // Earn diamonds when a sentence is completed
  useEffect(() => {
    if (status !== "complete") return
    const s = sentencesRef.current[currentIndexRef.current]
    if (!s?.id) return
    const parentId = baseSentenceId(s.id)

    const isPerfect = !sentenceHasErrorRef.current
    const newStreak = isPerfect ? consecutivePerfectRef.current + 1 : 0
    consecutivePerfectRef.current = newStreak
    const durationSeconds = Math.max(1, Math.round((Date.now() - sentenceStartTimeRef.current) / 1000))

    let earned = 5
    let variant: FeedbackVariant = "great"
    if (isPerfect) {
      if (newStreak >= 2) { earned = 5 + Math.min(newStreak, 20); variant = "combo" }
      else { variant = "perfect" }
    }
    setFeedback((p) => ({ trigger: p.trigger + 1, variant, streak: newStreak, earned }))

    fetch("/api/diamonds/earn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sentence", refId: parentId, streak: newStreak, perfect: isPerfect, durationSeconds }),
    }).catch((e) => { console.error(e) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  const progressPercent = useMemo(
    () => sentences.length > 0 ? (completedCount / sentences.length) * 100 : 0,
    [completedCount, sentences.length],
  )
  const timerStr = useMemo(
    () => `${String(Math.floor(timer / 3600)).padStart(2, "0")}:${String(Math.floor((timer % 3600) / 60)).padStart(2, "0")}:${String(timer % 60).padStart(2, "0")}`,
    [timer],
  )
  const score = useMemo(() => {
    const base = sentences.length * 500
    const penalty = errorCount * 30 + Math.floor(timer / 5)
    return Math.max(100, base - penalty)
  }, [sentences.length, errorCount, timer])

  /**
   * 练完一句的上报 —— 漏斗里最关键的转化点。
   *
   * 必须放在 `score` 声明**之后**：先前把它塞进上面那个 review/enqueue 的 effect 里，
   * 那里在 score 之前就引用了它，触发 react-hooks/immutability 的
   * 「Cannot access variable before it is declared」并让 React Compiler 直接跳过
   * 整个组件（Compilation Skipped），是实打实的错误而不是风格问题。
   *
   * 数据库的 practice_records 是这一指标的权威口径；埋点额外回答
   * 「进了练习页却一句没练完」那部分流失。
   */
  useEffect(() => {
    if (status !== "complete") return
    trackPracticeComplete(score, currentIndexRef.current + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Initialize word/chunk states for current sentence
  useEffect(() => {
    if (!sentence) return
    sentenceHasErrorRef.current = false
    sentenceMistakesRef.current = 0
    sentenceStartTimeRef.current = Date.now()
    setStatus("input")
    // globalSpeak 现在会回报「声音到底有没有真的放出来」。
    // 浏览器在用户还没交互过之前会拦掉自动播放，拦掉了也不报错、只是静音，
    // 于是首句（以及每次切句）都可能悄无声息。这里把结果接住，
    // 失败就亮出「点击开启发音」，让用户用一次点击把音频通道解锁。
    globalSpeak(sentence.english).then((played) => {
      if (!played) setNeedsAudioGesture(true)
    }).catch((e) => { console.error(e) })
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

  /**
   * 做完一句就把它记进「已揭示」。
   *
   * 只增不减：用户 Shift+← 回头翻时 status 会重置成 input，
   * 但这一句的答案他早就看过、也是他自己打出来的，
   * 再看语法树 / 句子解析不该被拦「仍要查看？」。
   */
  useEffect(() => {
    if (status !== "complete") return
    const id = sentencesRef.current[currentIndexRef.current]?.id
    if (!id) return
    setRevealedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [status])

  /** 该句英文是否已经摊开过（决定讲解类弹窗要不要先拦一道剧透确认）。 */
  const isRevealed = useMemo(() => {
    if (!sentence) return false
    return status === "complete" || revealedIds.has(sentence.id) || showAnswer
  }, [sentence, status, revealedIds, showAnswer])

  /** 用户在按钮里点的「开启发音」：这是合法手势，重播一次并撤掉提示。 */
  const unlockAudio = useCallback(() => {
    const s = sentencesRef.current[currentIndexRef.current]
    if (!s) return
    globalSpeak(s.english).then((played) => {
      if (played) setNeedsAudioGesture(false)
    }).catch((e) => { console.error(e) })
  }, [])

  /**
   * 把某个词加进生词本（Ctrl+N，以及词详情浮层里的按钮走同一个接口）。
   *
   * 带的是**原句 id**：分块展开出来的 `xxx_c0` 在库里不存在，
   * 拿它当来源会写出一个悬空外键。
   */
  const addWordToWordbook = useCallback(async (word: string | undefined) => {
    const trimmed = word?.trim()
    if (!trimmed) {
      toast("先把光标停在要收藏的单词上")
      return
    }
    const s = sentencesRef.current[currentIndexRef.current]
    try {
      const res = await fetch("/api/wordbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: trimmed, sourceSentenceId: s?.id ? baseSentenceId(s.id) : null }),
      })
      if (res.ok) toast.success(`已加入生词本：${trimmed}`)
      else toast.error("加入生词本失败，请稍后再试")
    } catch (e) {
      console.error(e)
      toast.error("加入生词本失败，请检查网络")
    }
  }, [])

  /**
   * 标记当前句已掌握（Ctrl+M，以及答对后的「已掌握 ✓」按钮共用一个实现）。
   *
   * `/api/review/complete` 在句子不在复习队列里时回 404 —— 这是完全正常的
   * （一节课里的句子只有部分会被排进复习）。所以 404 不当失败处理：
   * 用户的意思是「这句我会了，别再来烦我」。
   *
   * `skip=true` 时顺手跳到下一句（给 Ctrl+M 用）；按钮走 `skip=false`，
   * 保持它原本「只标记、不跳转」的行为，免得用户还没看清完成页就被推走。
   */
  const markCurrentMastered = useCallback(async (skip: boolean) => {
    const s = sentencesRef.current[currentIndexRef.current]
    if (s?.id) {
      try {
        const res = await fetch("/api/review/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentenceId: baseSentenceId(s.id), mastered: true }),
        })
        if (res.status === 404) toast("这句不在复习队列里，已跳过")
        else if (!res.ok) toast.error("标记失败，请稍后再试")
        else toast.success("已标记掌握")
      } catch (e) {
        console.error(e)
        toast.error("标记失败，请检查网络")
      }
    }
    if (skip) {
      const idx = currentIndexRef.current
      if (idx < sentencesRef.current.length - 1) setCurrentIndex(idx + 1)
    }
  }, [])

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

  /** 记下「本句出过错」，供完成弹窗的「再练错句」使用。 */
  const markSentenceError = useCallback(() => {
    const s = sentencesRef.current[currentIndexRef.current]
    if (!s?.id) return
    errorSentenceIdsRef.current.add(s.id)
    setErrorSentenceCount(errorSentenceIdsRef.current.size)
  }, [])

  /** 清空错句记录（重置、重练整课时都走这里，避免两处各写一遍）。 */
  const clearErrorSentences = useCallback(() => {
    errorSentenceIdsRef.current = new Set()
    setErrorSentenceCount(0)
  }, [])

  const confirmWord = useCallback(() => {
    if (inputBlockedRef.current) return
    const st = statusRef.current
    if (st === "complete") return
    const wStates = wordStatesRef.current
    const activeIdx = activeWordIndexRef.current
    const words = getInputWords(sentencesRef.current[currentIndexRef.current]?.words || [])
    if (!words.length || !words[activeIdx]) return

    const currentVal = wStates[activeIdx]?.value || ""
    const expected = words[activeIdx].english

    // 空词上按空格不该记错：isTypingMatch("") 恒为 false，原先连按几下空格
    // 就会在「什么都没敲」的情况下扣失误、拿不到满分。两页统一忽略。
    if (!currentVal.trim()) return

    if (isTypingMatch(currentVal, expected)) {
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
      sentenceHasErrorRef.current = true
      sentenceMistakesRef.current += 1
      markSentenceError()
      setErrorCount((c) => c + 1)
      setWordStates((prev) => {
        const next = [...prev]
        next[activeIdx] = { value: currentVal, status: "error" }
        return next
      })
      setShakeWords((prev) => new Set(prev).add(activeIdx))
      setTimeout(() => setShakeWords((prev) => { const next = new Set(prev); next.delete(activeIdx); return next }), 500)
    }
  }, [markSentenceError])

  const submitAll = useCallback(() => {
    if (inputBlockedRef.current) return
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
      // 与 confirmWord 同一口径（normalizeForTyping），不再用裸 toLowerCase：
      // 两处判定不一致时，会出现「按空格算对、按回车算错」这种自相矛盾。
      if (isTypingMatch(val, expected)) {
        return { value: val, status: "done" }
      }
      hasError = true
      return { value: val, status: "error" }
    })
    setWordStates(newStates)
    if (hasError) {
      playBuzz()
      sentenceHasErrorRef.current = true
      markSentenceError()
      // 只累计「本次新出现的」错误词，避免重复提交时重复计数
      sentenceMistakesRef.current += newStates.filter(
        (s, i) => s.status === "error" && wStates[i]?.status !== "error"
      ).length
      setErrorCount((c) => c + newStates.filter((s) => s.status === "error").length)
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
  }, [markSentenceError])

  const confirmChunk = useCallback(() => {
    if (inputBlockedRef.current) return
    const st = statusRef.current
    if (st === "complete") return
    const chunks = sentencesRef.current[currentIndexRef.current]?.chunks
    if (!chunks || chunks.length === 0) return
    const activeIdx = activeChunkIndexRef.current
    const expected = chunks[activeIdx]?.text ?? ""
    const input = chunkInputRef.current.trim()

    if (isTypingMatch(input, expected)) {
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
      sentenceHasErrorRef.current = true
      sentenceMistakesRef.current += 1
      markSentenceError()
      setErrorCount((c) => c + 1)
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
  }, [markSentenceError])

  // Debounced wrappers for button clicks
  const debouncedConfirmWord = useDebounce(confirmWord, 300)
  const debouncedSubmitAll = useDebounce(submitAll, 300)
  const debouncedGoNext = useDebounce(goNext, 300)
  const debouncedGoPrev = useDebounce(goPrev, 300)
  const debouncedTogglePause = useDebounce(() => {
    setIsPaused((prev) => {
      if (!prev) setShowLeaveModal(true)
      else setShowLeaveModal(false)
      return !prev
    })
  }, 300)
  const debouncedToggleAnswer = useDebounce(() => setShowAnswer((v) => !v), 300)

  // Keyboard handler (stable ref, no re-binding)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+P 必须在守卫之前：暂停后正是靠它恢复。若一并被挡住，
      // 用户就只能去点「继续学习」按钮，键盘用户被锁在暂停态里。
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault()
        debouncedTogglePause()
        return
      }

      // 三重守卫：焦点在真实输入框里 / 暂停中 / 有任何弹窗或过渡层开着 —— 都不接管按键。
      // 原先完全没有守卫，于是暂停弹窗、设置弹窗、重置确认框开着的时候，
      // 敲字母照样打进题目、空格照样触发确认；设置面板里的 range 输入也会被抢键。
      const target = e.target as HTMLElement | null
      if (isEditableTarget({
        tagName: target?.tagName,
        isContentEditable: target?.isContentEditable,
        isSoftKeyboardInput: target === softKeyboardRef.current,
      })) return
      if (inputBlockedRef.current) return

      const st = statusRef.current
      const activeIdx = activeWordIndexRef.current
      const words = getInputWords(sentencesRef.current[currentIndexRef.current]?.words || [])

      // Ctrl+1 / Ctrl+2 / Ctrl+/ —— 三个「看讲解」的入口。
      // 必须放在下面 `st === "complete"` 的提前 return 之前：句子做完之后
      // 正是最想回头看语法树、看句子解析的时候，放在后面等于做完就看不到了。
      if (e.ctrlKey && e.key === "1") {
        e.preventDefault()
        setShowOutline(true)
        return
      }

      // Ctrl+2 — 依存语法树
      if (e.ctrlKey && e.key === "2") {
        e.preventDefault()
        if (!sentencesRef.current[currentIndexRef.current]?.dependencyAnalysis) {
          toast("这句还没有语法树数据")
          return
        }
        setShowTree(true)
        return
      }

      // Ctrl+/ — 句子解析（词汇、结构、AI 讲解）
      if (e.ctrlKey && (e.key === "/" || e.key === "?")) {
        e.preventDefault()
        setShowExplain(true)
        return
      }

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

      // Ctrl+N — 收藏当前正在打的词
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault()
        void addWordToWordbook(words[activeIdx]?.english)
        return
      }

      // Ctrl+M — 标记掌握并跳下一句
      if (e.ctrlKey && e.key === "m") {
        e.preventDefault()
        void markCurrentMastered(true)
        return
      }

      const action = classifyTypingKey(e)
      const currentSentence = sentencesRef.current[currentIndexRef.current]
      const isChunkMode = !!(currentSentence?.chunks && currentSentence.chunks.length > 0)

      if (isChunkMode) {
        const chunks = currentSentence!.chunks!
        const chunkIdx = activeChunkIndexRef.current
        const expectedChunk = chunks[chunkIdx]
        if (!expectedChunk) return

        // 自由文本模式（chunk）：空格是答案本身的一部分（"in the morning"），
        // 必须能打出来，确认走 Enter。它与逐词模式「空格=确认」是两套语义，
        // 有意保留 —— 这里把分类器给出的 confirm 当作空格字符使用。
        if (action === "letter" || action === "confirm") {
          e.preventDefault()
          playTick()
          setChunkInput((prev) => {
            if (prev.length >= expectedChunk.text.length + 5) return prev
            return prev + e.key
          })
          return
        }
        if (action === "backspace") {
          e.preventDefault()
          playTick()
          setChunkInput((prev) => prev.slice(0, -1))
          return
        }
        if (e.key === "Enter") {
          e.preventDefault()
          confirmChunk()
          return
        }
        return
      }

      if (!words.length) return
      const activeWord = words[activeIdx]
      if (!activeWord) return

      // Letter input（任何单字符都收：不再静默吞键，敲错会立刻标红并可退格）
      if (action === "letter") {
        e.preventDefault()
        playTick()
        setWordStates((prev) => {
          const cur = prev[activeIdx]
          if (!cur) return prev
          // 错词态下继续输入 = 清空重打：给出一条明确的出路，
          // 不必逐个退格去猜「到底哪个字母错了」。
          const base = cur.status === "error" ? "" : cur.value
          const value = base + e.key
          // 实时判定（与复习页同一口径）：一旦不再是期望的前缀就立刻标错。
          // 原先写死 `value.length >= expected.length` 就 return，敲到上限后
          // 按键毫无反应、而且不提示，用户会以为键盘坏了。
          const status = isTypingPrefix(value, activeWord.english) ? "active" : "error"
          const next = [...prev]
          next[activeIdx] = { value, status }
          return next
        })
        return
      }

      // Backspace
      if (action === "backspace") {
        e.preventDefault()
        playTick()
        setWordStates((prev) => {
          const cur = prev[activeIdx]
          if (!cur) return prev
          if (cur.value.length === 0) return prev
          const value = cur.value.slice(0, -1)
          const next = [...prev]
          // 状态要跟着回退，否则删到正确前缀了还挂着红色
          next[activeIdx] = {
            value,
            status: isTypingPrefix(value, activeWord.english) ? "active" : "error",
          }
          return next
        })
        return
      }

      // Space: validate current word
      if (action === "confirm") {
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
    const timers: ReturnType<typeof setTimeout>[] = []

    centers.forEach(({ x, y, t }) => {
      const txArr: number[] = []
      const tyArr: number[] = []
      const gravArr: number[] = []
      const els: HTMLDivElement[] = []

      for (let i = 0; i < COUNT; i++) {
        const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.45
        const dist = 90 + Math.random() * 230
        txArr[i] = Math.cos(angle) * dist
        tyArr[i] = Math.sin(angle) * dist
        gravArr[i] = 220 + Math.random() * 180

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

      timers.push(setTimeout(() => {
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

        timers.push(setTimeout(() => {
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
        }, 280))
      }, t))
    })

    return () => {
      timers.forEach(clearTimeout)
      container.innerHTML = ""
    }
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

  // Show completion modal when all sentences done + earn lesson diamonds
  useEffect(() => {
    if (!isFinished) return
    setShowCompletionModal(true)
    fetch("/api/diamonds/earn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "lesson_complete", refId: lessonId }),
    }).catch((e) => { console.error(e) })
  }, [isFinished, lessonId])

  // 还在加载 → 保留原来的「正在加载课程内容…」开场画面。
  // 已经加载完但一句可练的都没有（空课时，或整节课的题干/答案都不可用），
  // 以及接口报错（403/404/500）——都必须给出明确交代，不能让它停在这个画面上。
  if (!sentence) {
    const stillLoading = loadState === "loading"
    if (!stillLoading) {
      return (
        <LearnClientMessage
          title={loadState === "error" ? "课程内容加载失败" : "本课暂无可练习内容"}
          description={
            loadState === "error"
              ? "网络或服务异常，请重试；若一直失败，请稍后再来。"
              : "这节课暂时没有可以练习的句子。若你正在使用会员内容，可能是该课时的题目数据有问题，我们正在修复。"
          }
          courseId={courseId}
          onRetry={loadState === "error" ? () => window.location.reload() : undefined}
        />
      )
    }
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden" style={{ background: "linear-gradient(135deg, #0f0a1a 0%, #1a1028 30%, #0d1525 60%, #0a0f1a 100%)" }}>
        <SoftKeyboardInput inputRef={softKeyboardRef} />
        {/* Animated background particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-violet-500/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full bg-cyan-500/8 blur-[100px] animate-pulse" style={{ animationDelay: "1.5s" }} />
          <div className="absolute top-1/2 left-1/2 w-64 h-64 rounded-full bg-fuchsia-500/6 blur-[90px] animate-pulse" style={{ animationDelay: "3s" }} />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-10">
          {/* Logo with ring animation */}
          <div className="relative">
            <div className="absolute inset-0 rounded-[32px] bg-violet-500/30 blur-3xl scale-150 animate-pulse" />
            <div className="absolute -inset-4 rounded-[40px] border border-violet-400/10 animate-spin" style={{ animationDuration: "8s" }} />
            <div className="absolute -inset-8 rounded-[48px] border border-violet-400/5 animate-spin" style={{ animationDuration: "12s", animationDirection: "reverse" }} />
            <div className="relative w-32 h-32 rounded-[32px] bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm flex items-center justify-center shadow-2xl shadow-violet-500/10">
              <Keyboard className="h-14 w-14 text-violet-400/60" />
            </div>
          </div>

          {/* Brand text */}
          <div className="text-center space-y-2">
            <p className="text-white/60 text-xl font-bold tracking-[4px]">码上英语</p>
            <p className="text-white/20 text-xs tracking-[6px] font-mono uppercase">TypeNow</p>
          </div>

          {/* Motivational quote */}
          <p className="text-white/15 text-sm font-light tracking-wider max-w-xs text-center leading-relaxed px-4">
            "The limits of my language mean the limits of my world."
          </p>
        </div>

        {/* Bottom progress area */}
        <div className="absolute bottom-16 left-0 right-0 px-12 max-w-sm mx-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold tracking-[4px] text-violet-300/70 uppercase">Preparing</span>
            <span className="text-[11px] font-bold font-mono text-violet-200/80">
{sentences.length > 0 ? 100 : loadingPercent}%
            </span>
          </div>
          <div className="h-1.5 bg-violet-300/15 rounded-full overflow-hidden">
            <div
              ref={loadingBarRef}
              className="h-full rounded-full transition-all duration-300"
              style={{ width: "0%", background: "linear-gradient(90deg, #c084fc, #a78bfa, #7c3aed)", boxShadow: "0 0 12px rgba(168,85,247,0.5)" }}
            />
          </div>
          <p className="mt-4 text-violet-200/35 text-[11px] text-center tracking-wider">
            正在加载课程内容…
          </p>
        </div>
      </div>
    )
  }

  function doReset() {
    setTransition({ show: true, message: "正在重置进度…", onComplete: () => {
      setCurrentIndex(0)
      setStatus("input")
      setTimer(0)
      setIsPaused(false)
      // 重新开始计数：否则「再练错句」会把这轮之前的历史错句也一起算进去
      clearErrorSentences()
      setTransition({ show: false, message: "" })
      const s = sentencesRef.current[0]
      if (s) globalSpeak(s.english)
    }})
  }

  function resetFromCompletion() {
    setShowCompletionModal(false)
    setCurrentIndex(0)
    setStatus("input")
    setTimer(0)
    setErrorCount(0)
    setIsPaused(false)
    setShowConfetti(false)
    // 同上：新一轮从头计数
    clearErrorSentences()
    const s = sentencesRef.current[0]
    if (s) globalSpeak(s.english)
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

  /**
   * 「再练错句」：把本次出过错的句子单独抽出来重练。
   *
   * 完成弹窗原先只有「再来一次 / 返回课程」—— 用户刚被 5 个句子难住，
   * 想巩固只能整节课从头再来一遍，错的那几句反而练不到。
   * 按 id 过滤（不是下标），所以打乱顺序之后依然成立。
   */
  function practiceErrorsOnly() {
    const wrong = fullSentencesRef.current.filter((s) => errorSentenceIdsRef.current.has(s.id))
    if (wrong.length === 0) return
    setShowCompletionModal(false)
    setShowConfetti(false)
    setSentences(wrong)
    setCurrentIndex(0)
    setStatus("input")
    setTimer(0)
    setErrorCount(0)
    setIsPaused(false)
    setIsErrorRun(true)
    clearErrorSentences()
    const s = wrong[0]
    if (s) globalSpeak(s.english)
  }

  /** 从「错句重练」回到完整课时。 */
  function restoreFullLesson() {
    const all = fullSentencesRef.current
    if (all.length === 0) return
    setSentences(all)
    setCurrentIndex(0)
    setStatus("input")
    setTimer(0)
    setErrorCount(0)
    setIsErrorRun(false)
    clearErrorSentences()
    const s = all[0]
    if (s) globalSpeak(s.english)
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="h-full flex flex-col outline-none"
      style={{ minHeight: "100dvh" }}
      onPointerDown={(e) => {
        // 触摸设备上没有物理键盘：一个 div 即使拿到了焦点也唤不起软键盘，
        // 于是整个练习页在手机上完全无法输入（定价页却承诺「手机浏览器也能用」）。
        // 只在触摸时把焦点交给下面那个真实但不可见的 input，桌面端行为不变。
        if (e.pointerType === "touch") softKeyboardRef.current?.focus()
      }}
    >
      <SoftKeyboardInput inputRef={softKeyboardRef} />
      {/* === Layer 1: Action Bar === */}
      <div className="flex items-center justify-between shrink-0 px-3 sm:px-5 py-2 sm:py-3">
        {/* Left: back + course title + progress */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={() => setShowBackModal(true)}
            className="inline-flex items-center gap-1 sm:gap-1.5 text-base sm:text-lg text-foreground hover:text-foreground/80 transition-colors shrink-0"
          >
            <ArrowLeft className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="hidden sm:inline">返回</span>
          </button>
          <span className="text-sm sm:text-lg text-foreground truncate">{courseTitle}</span>
          <span className="text-xs sm:text-sm text-foreground/70 shrink-0">{currentIndex + 1}/{sentences.length}</span>
        </div>

        {/* Right: action icons — collapse lesser-used on mobile */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <TooltipButton label={showAnswer ? "隐藏答案" : "显示答案"} onClick={debouncedToggleAnswer}>
            {showAnswer ? <EyeOff className="h-5 w-5 sm:h-6 sm:w-6" /> : <Eye className="h-5 w-5 sm:h-6 sm:w-6" />}
          </TooltipButton>
          <span className="hidden sm:contents">
            <TooltipButton label="快捷键" onClick={() => setShowShortcuts(true)}><Keyboard className="h-6 w-6" /></TooltipButton>
            <TooltipButton label="设置" onClick={() => setShowSettings(true)}><Settings className="h-6 w-6" /></TooltipButton>
          </span>
          <TooltipButton label="暂停" onClick={debouncedTogglePause}><Pause className="h-5 w-5 sm:h-6 sm:w-6" /></TooltipButton>
          <span className="hidden md:contents">
            <TooltipButton label="重置进度" onClick={() => setShowResetConfirm(true)}><RotateCcw className="h-6 w-6" /></TooltipButton>
            <TooltipButton label="打乱顺序" onClick={() => setShowShuffleConfirm(true)}><Shuffle className="h-6 w-6" /></TooltipButton>
          </span>
          <TooltipButton label="内容大纲" onClick={() => setShowOutline(true)}><List className="h-5 w-5 sm:h-6 sm:w-6" /></TooltipButton>
          <TooltipButton label={isFullscreen ? "退出全屏" : "全屏"} onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize className="h-5 w-5 sm:h-6 sm:w-6" /> : <Maximize className="h-5 w-5 sm:h-6 sm:w-6" />}
          </TooltipButton>
        </div>
      </div>

      {/* === Layer 1.5: 错句重练提示 === */}
      {isErrorRun && (
        <div className="shrink-0 mx-3 sm:mx-5 mb-1 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2">
          <span className="text-xs sm:text-sm text-amber-400/90 font-medium truncate">
            错句重练 · 本轮共 {sentences.length} 句
          </span>
          <button
            onClick={restoreFullLesson}
            className="shrink-0 text-xs sm:text-sm text-amber-400 hover:text-amber-300 font-semibold transition-colors"
          >
            返回完整课时
          </button>
        </div>
      )}

      {/* === Layer 2: Progress Bar === */}
      <div className="shrink-0 px-3 sm:px-5 pb-1 sm:pb-2">
        <div className="h-2 rounded-full border border-foreground/40 bg-transparent overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* === Layer 2.5: 恢复提示 === */}
      {resumeNotice !== null && (
        <div className="shrink-0 px-3 sm:px-5 pb-1 sm:pb-2 flex items-center justify-center">
          <div className="flex items-center gap-2 sm:gap-3 rounded-full border border-accent/25 bg-accent/[0.06] px-3 py-1.5 text-[11px] sm:text-xs text-foreground/70">
            <span>已为你恢复到第 {resumeNotice + 1} 句</span>
            <button
              onClick={() => {
                // 只是把这一轮挪回开头；真正的进度覆盖交给切句时的上报去做，
                // 所以这里不直接写库。
                setCurrentIndex(0)
                setResumeNotice(null)
              }}
              className="font-semibold text-accent hover:text-accent/80 transition-colors"
            >
              从头开始
            </button>
            <button
              onClick={() => setResumeNotice(null)}
              className="text-foreground/35 hover:text-foreground/70 transition-colors"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* === Layer 2.4: 触屏设备提示（PC 优先） ===
          只提示不拦截：平板上接外接键盘的用户照样能正常练习，
          硬拦会把本来能用的场景一起挡掉。 */}
      {showDesktopNotice && (
        <div className="shrink-0 px-3 sm:px-5 pb-1 sm:pb-2 flex items-center justify-center">
          <div className="flex items-center gap-2 sm:gap-3 rounded-full border border-amber-500/25 bg-amber-500/[0.06] px-3 py-1.5 text-[11px] sm:text-xs text-foreground/70">
            <Keyboard className="h-3.5 w-3.5 text-amber-400/70 shrink-0" />
            <span>打字练习需要物理键盘，建议在电脑上打开，手感与识别都更可靠</span>
            <button
              onClick={dismissDesktopNotice}
              className="text-foreground/35 hover:text-foreground/70 transition-colors"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* === Layer 3: Timer === */}
      <div className="shrink-0 px-3 sm:px-5 pb-1 sm:pb-2 flex items-center gap-2 sm:gap-3">
        <span className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground/85 font-mono">{timerStr}</span>
        {isPaused && <span className="text-sm sm:text-base text-amber-400/60">已暂停</span>}
        {/* 浏览器在用户交互之前会静音自动播放，且不会报错 —— 只会「明明配了
            发音却一点声音都没有」。真被拦下时才出现这个按钮：它本身是一次
            用户手势，点一下就能把音频通道打开，之后切句都正常发音。 */}
        {needsAudioGesture && !isPaused && (
          <button
            onClick={unlockAudio}
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] sm:text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
          >
            <Volume2 className="h-3.5 w-3.5" />
            点击开启发音
          </button>
        )}
      </div>

      {/* Answer Preview (below timer, centered) */}
      {showAnswer && status === "input" && (
        <div className="shrink-0 px-3 sm:px-5 pb-3 sm:pb-4 flex justify-center">
          <div className="rounded-2xl border border-accent/20 bg-accent/[0.02] px-4 sm:px-6 py-3 sm:py-4 w-full max-w-2xl">
            <div className="flex items-center justify-center gap-2 mb-2 sm:mb-3">
              <Eye className="h-3.5 w-3.5 text-accent/50" />
              <span className="text-[11px] font-medium text-accent/50 uppercase tracking-wide">答案预览</span>
            </div>
            <CompletedSentence words={sentence.words || []} small />
          </div>
        </div>
      )}

      {/* Main Content

          ⚠️ 这里**不能**用 justify-center 来做垂直居中：它在 overflow-y-auto 的
          滚动容器里会把超出部分推到滚动原点之上，而滚动条永远到不了负值，于是长句
          的第一行被永久裁掉、滚不回来。headless Chrome 实测（604px 容器 / 内容
          溢出 652px）：scrollTop=0 时第一个词格在容器上方 650px 处，不可达。
          改用子元素 margin-block:auto（下面的 my-auto）：内容装得下就上下留白居中，
          装不下就顶对齐并可完整滚动。短内容居中的视觉效果不变（实测上留白 230px）。 */}
      <div
        key={`${currentIndex}-${status}`}
        className="flex-1 flex flex-col items-center px-3 sm:px-6 md:px-8 py-6 sm:py-10 md:py-12 overflow-y-auto animate-fadein"
      >
        {status === "complete" ? (
          /* Completed Sentence Display */
          <div className="my-auto w-full max-w-5xl flex flex-col items-center gap-6 sm:gap-10 px-2">
            <CompletedSentence words={sentence.words || []} />

            {/* Full Chinese translation */}
            <p className="text-center text-xl sm:text-2xl font-semibold text-foreground/65 tracking-wide">
              {sentence.chinese}
            </p>

            <VoicePanel english={sentence.english} />

            <div className="flex flex-col items-center gap-2 sm:gap-3">
              <p className="text-xs sm:text-base text-foreground/30 font-medium text-center">
                按 Enter 继续下一句 · 鼠标悬停单词查看词性说明
              </p>
              <button
                onClick={() => { void markCurrentMastered(false) }}
                className="px-4 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-all"
              >
                已掌握 ✓
              </button>
            </div>
          </div>
        ) : sentence.chunks && sentence.chunks.length > 0 ? (
          /* Chunk Mode Input */
          <div className="my-auto w-full max-w-2xl space-y-6 sm:space-y-8 px-2">
            {/* Current chunk Chinese hint */}
            <p className="text-center text-xl sm:text-2xl font-medium text-foreground">
              {sentence.chunks[activeChunkIndex]?.chinese ?? sentence.chinese}
            </p>

            {/* Chunk progress row */}
            <div className="flex flex-wrap justify-center items-center gap-2 sm:gap-3">
              {sentence.chunks.map((chunk, i) => {
                const status = chunkStatuses[i]
                const chunkWidth = Math.min(chunk.text.length * 16 + 16, 280)
                return (
                  <div key={i} className="flex flex-col items-center gap-1 sm:gap-1.5">
                    <div
                      className={`
                        min-h-[44px] sm:min-h-[56px] md:min-h-[64px] flex items-center justify-center px-3 sm:px-4 text-2xl sm:text-3xl md:text-4xl font-medium transition-colors rounded-xl
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
                      style={{ minWidth: chunkWidth }}
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
                      style={{ width: chunkWidth }}
                    />
                    <span className="text-[10px] sm:text-xs text-foreground/30">{chunk.chinese}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Word Mode Input */
          <div className="my-auto w-full max-w-4xl space-y-6 sm:space-y-8 px-2">
            <p className="text-center text-2xl sm:text-3xl md:text-4xl font-semibold text-foreground">
              {sentence.chinese}
            </p>

            <div className="flex flex-wrap justify-center items-end gap-x-3 sm:gap-x-4 gap-y-3 sm:gap-y-4">
              {(sentence.words || []).map((word, i) => {
                const isInput = word.pos !== "标点"
                const wsIdx = inputWords.indexOf(word)
                const ws = isInput && wsIdx >= 0 ? wordStates[wsIdx] : null
                const isActive = isInput && wsIdx === activeWordIndex
                const isShaking = shakeWords.has(wsIdx)

                if (!isInput) {
                  return (
                    <span key={i} className="text-base sm:text-xl font-medium text-foreground/70 self-end pb-1 sm:pb-1.5">
                      {word.english}
                    </span>
                  )
                }

                const isPending = !ws || ws.status === "idle"

                /**
                 * 只有已经打完（done）或打错（error）的词才挂词详情浮层。
                 *
                 * 未开始 / 正在打的词绝不能挂：浮层里直接有中文释义和发音，
                 * 鼠标停在题目上就会把答案递到眼前，等于自带作弊器。
                 * 打完之后再看词义，才是「练完顺手查一下」的正确时机。
                 */
                const cell = (
                  <div
                    className={`relative grid grid-cols-1 place-items-center gap-[4px] sm:gap-[5px] ${isShaking ? "animate-shake" : ""}`}
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
                    {/*
                      宽度由「期望单词」这把尺子决定，而不是按字数估算。
                      旧写法 width: calc(Nch + 10px) 有两个坑：
                        1. ch 是相对该元素自身字号算的，而下划线所在元素没有字号类，
                           继承到 16px（1ch≈8px）；上面的单词却是 text-3xl…lg:text-6xl，
                           于是 5 个字母的词文字宽 ~120px、下划线只有 ~50px。
                        2. 按字数算对 i/l 与 W/M 这类宽度差异大的词必然不准。
                      现在用不可见的期望单词 + 实际输入同格叠放：格子宽度 = 两者较宽者，
                      下划线 w-full 跟着格子走，每个词各得其所。
                    */}
                    <div
                      className={`
                        col-start-1 row-start-1 grid place-items-center text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-medium transition-colors
                        h-10 sm:h-12 md:h-14 lg:h-16
                        ${ws?.status === "done"
                          ? "text-foreground"
                          : ws?.status === "error"
                            // 错词不再整格染红：底色回到正常前景色，
                            // 由 TypedChars 把「错在第几个字母」单独标红。
                            ? "text-foreground"
                            : isActive
                              ? "text-accent"
                              : "text-transparent"
                        }
                      `}
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
                      className={`col-start-1 row-start-2 w-full h-[2px] sm:h-[3px] transition-colors duration-150 ${
                        ws?.status === "error"
                          ? "bg-red-500"
                          : ws?.status === "done"
                            ? "bg-foreground/40"
                            : isActive
                              ? "bg-accent shadow-[0_0_8px_var(--accent)]"
                              : "bg-foreground/20"
                      }`}
                      style={{ clipPath: "polygon(0 0, 100% 0, calc(100% - 2px) 100%, 2px 100%)" }}
                    />
                    {/* 打错了就把正确拼写摆出来。原先答案是默认不显示的，
                        而错词又不指出错在哪 —— 用户只能退格硬猜，这是闭环里最断的一环。
                        只在这一个词已经出错后才显示，不会提前剧透。

                        绝对定位而不是新增一行：单词行是 items-end 对齐的，
                        多出一行会把出错那个词的文字整体顶高约 18px，
                        每错一次整行就跳一下。浮在下方则完全不影响布局。 */}
                    {ws?.status === "error" && (
                      <span className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap px-1 text-[10px] sm:text-xs font-medium text-emerald-400/80">
                        {word.english}
                      </span>
                    )}
                  </div>
                )

                // key 挂在最外层，所以这里用 Fragment 承接，
                // 不能额外套一层 div：flex 行里的每个词格就是一个 flex item，
                // 多一层盒子会让 items-end 的对齐基准下沉。
                if (ws?.status !== "done" && ws?.status !== "error") {
                  return <Fragment key={i}>{cell}</Fragment>
                }
                return (
                  <WordDetailPopover
                    key={i}
                    word={word.english}
                    sentenceId={baseSentenceId(sentence.id)}
                  >
                    {cell}
                  </WordDetailPopover>
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

      {/* Chapter Completion Modal — 试学截断时由下面的付费引导取代，避免谎称「已完成本课全部」 */}
      {showCompletionModal && !trial?.truncated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md">
          <div className="relative w-full max-w-[420px] mx-4 rounded-3xl overflow-hidden border border-border bg-card shadow-2xl">
            {/* Top accent bar */}
            <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #7c3aed, #ec4899, #f59e0b)" }} />

            <div className="px-8 pt-8 pb-9 flex flex-col items-center gap-7">
              {/* Heading */}
              <div className="text-center">
                <p className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">太棒了！</p>
                <p className="text-foreground/35 text-xs sm:text-sm mt-1.5">你已完成本课全部 {sentences.length} 个句子</p>
              </div>

              {/* Score */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] font-mono tracking-widest text-foreground/25 uppercase">Score</span>
                <span className="text-4xl sm:text-6xl font-extrabold" style={{ background: "linear-gradient(135deg, #a78bfa, #f472b6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  {score.toLocaleString()}
                </span>
              </div>

              {/* Stats row */}
              <div className="w-full grid grid-cols-3 divide-x divide-foreground/[0.07]">
                <div className="flex flex-col items-center gap-1 px-4">
                  <span className="text-3xl font-bold text-foreground">{sentences.length}</span>
                  <span className="text-foreground/30 text-[11px] text-center leading-tight">完成<br />句数</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-4">
                  <span className="text-3xl font-bold text-foreground">{timerStr.slice(3)}</span>
                  <span className="text-foreground/30 text-[11px] text-center leading-tight">用时<br />(分:秒)</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-4">
                  <span className="text-3xl font-bold text-foreground">{errorCount}</span>
                  <span className="text-foreground/30 text-[11px] text-center leading-tight">失误<br />次数</span>
                </div>
              </div>

              {/* Motivational message */}
              <div className="w-full rounded-2xl bg-foreground/[0.03] border border-foreground/[0.06] px-5 py-3.5 text-center">
                <p className="text-foreground/40 text-xs leading-relaxed">
                  坚持每天练习，记住学习英语最好的方式<br />
                  就是持续输入，让语感自然形成。
                </p>
              </div>

              {/* Action buttons
                  原先只有「再来一次 / 返回课程」：学完一课没有去处，学错几个词也没法
                  只练那几个。现在补上「继续下一课」与「再练错句」。 */}
              <div className="w-full flex flex-col gap-3">
                {nextLesson && (
                  <Link
                    href={`/home/learn/${courseId}?lesson=${nextLesson.id}`}
                    className="w-full py-3 rounded-2xl text-center text-white text-sm font-semibold transition-colors truncate px-4"
                    style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
                  >
                    继续下一课{nextLesson.title ? ` · ${nextLesson.title}` : ""} →
                  </Link>
                )}
                <div className="flex gap-3">
                  {errorSentenceCount > 0 && (
                    <button
                      onClick={practiceErrorsOnly}
                      className="flex-1 py-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-400 text-sm font-semibold hover:bg-amber-500/20 transition-colors"
                    >
                      再练错句 ({errorSentenceCount})
                    </button>
                  )}
                  <button
                    onClick={resetFromCompletion}
                    className="flex-1 py-3 rounded-2xl border border-foreground/12 text-foreground/70 text-sm font-semibold hover:bg-foreground/[0.05] hover:text-foreground transition-colors"
                  >
                    再来一次
                  </button>
                </div>
                <Link
                  href={`/home/store/${courseId}`}
                  className="w-full py-3 rounded-2xl text-center border border-foreground/12 text-foreground/60 text-sm font-semibold hover:bg-foreground/[0.05] transition-colors"
                >
                  返回课程
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 试学结束 → 付费引导。
          非会员只拿到每课前 FREE_TRIAL_SENTENCES 句，练完必须给一条明确的转化路径，
          而不是复用完成弹窗说「你已完成本课全部 N 个句子」——那会让用户以为课就这么短。 */}
      {showCompletionModal && trial?.truncated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md">
          <div className="relative w-full max-w-[420px] mx-4 rounded-3xl overflow-hidden border border-border bg-card shadow-2xl">
            <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #7c3aed, #ec4899, #f59e0b)" }} />

            <div className="px-8 pt-8 pb-8 flex flex-col items-center gap-6">
              <div className="text-center">
                <p className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
                  {trialAvailable ? "免费体验完整课程" : "试学结束"}
                </p>
                <p className="text-foreground/40 text-xs sm:text-sm mt-2">
                  {trialAvailable
                    ? `你已免费学完本课前 ${trial.limit} 句，领取体验会员即可解锁全部内容`
                    : `你已免费学完本课前 ${trial.limit} 句，这节课还有更多句子`}
                </p>
              </div>

              <div className="w-full rounded-2xl border border-foreground/10 bg-foreground/[0.03] px-5 py-4 flex flex-col gap-2">
                <p className="text-xs text-foreground/50">
                  {trialAvailable ? "体验会员可以" : "开通会员后可以"}
                </p>
                <ul className="text-sm text-foreground/70 flex flex-col gap-1.5">
                  <li>· 解锁本课及全部课程的完整句子</li>
                  <li>· 使用 AI 智能拆句与语法解析</li>
                  <li>· 自动安排复习，练过的不会白练</li>
                </ul>
              </div>

              <div className="w-full flex flex-col gap-2.5">
                {trialAvailable ? (
                  <>
                    {/* 没领过体验会员的人先给免费入口：直接要钱会白白丢掉一次
                        「先体验、再付费」的机会，而这正是句乐部验证过的路径。 */}
                    <button
                      onClick={claimTrialMembership}
                      disabled={claimingTrial}
                      className="w-full py-3 rounded-2xl text-center text-white text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
                    >
                      {claimingTrial ? "领取中…" : `免费领取 ${TRIAL_DAYS} 天体验会员`}
                    </button>
                    <Link
                      href="/pricing?reason=trial"
                      className="w-full py-3 rounded-2xl text-center border border-foreground/12 text-foreground/60 text-sm font-semibold hover:bg-foreground/[0.05] transition-colors"
                    >
                      直接开通会员
                    </Link>
                  </>
                ) : (
                  <Link
                    href="/pricing?reason=trial"
                    className="w-full py-3 rounded-2xl text-center text-white text-sm font-semibold transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
                  >
                    开通会员，继续学完
                  </Link>
                )}
                <Link
                  href={`/home/store/${courseId}`}
                  className="w-full py-3 rounded-2xl text-center border border-foreground/12 text-foreground/60 text-sm font-semibold hover:bg-foreground/[0.05] transition-colors"
                >
                  返回课程
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shortcut Drawer */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setShowShortcuts(false)} />
          <div className="relative w-full sm:w-[380px] h-full bg-card border-l border-border shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-bold text-foreground">快捷键</h2>
              <button onClick={() => setShowShortcuts(false)} className="p-1 rounded text-foreground/40 hover:text-foreground transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-4 py-4 space-y-1">
              {([
                { keys: ["Ctrl", "'"], label: "播放声音", action: () => { const s = sentencesRef.current[currentIndexRef.current]; if (s) globalSpeak(s.english) } },
                { keys: ["Ctrl", ";"], label: "显示/隐藏答案" },
                { keys: ["Ctrl", "P"], label: "暂停/继续" },
                { keys: ["Ctrl", "1"], label: "查看课程大纲", action: () => setShowOutline(true) },
                { keys: ["Ctrl", "2"], label: "查看语法树", action: () => setShowTree(true) },
                { keys: ["Ctrl", "/"], label: "查看句子解析", action: () => setShowExplain(true) },
                { keys: ["Space"], label: "确认当前单词" },
                { keys: ["Enter"], label: "提交整句" },
                { keys: ["Backspace"], label: "删除字符" },
                { keys: ["Shift", "←/→"], label: "上一句/下一句" },
                { keys: ["Ctrl", "M"], label: "标记掌握并跳下一句", action: () => { void markCurrentMastered(true) } },
                { keys: ["Ctrl", "N"], label: "收藏当前单词到生词本", action: () => { void addWordToWordbook(inputWords[activeWordIndex]?.english) } },
              ] as ShortcutItem[]).map((item, i) => (
                <div
                  key={i}
                  onClick={item.action}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${
                    item.disabled ? "opacity-30" : item.action ? "cursor-pointer hover:bg-foreground/[0.04]" : "hover:bg-foreground/[0.04]"
                  }`}
                >
                  <span className="text-sm text-foreground/70">{item.label}</span>
                  <span className="inline-flex items-center gap-1">
                    {item.keys.map((k, j) => (
                      <span key={j}>
                        <kbd className="rounded border border-foreground/15 bg-foreground/[0.04] px-1.5 py-0.5 text-[11px] text-foreground/60 font-medium">{k}</kbd>
                        {j < item.keys.length - 1 && <span className="text-foreground/20 mx-0.5">+</span>}
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
          revealedIds={revealedIds}
          onClose={() => setShowOutline(false)}
          onJumpTo={(i) => { setCurrentIndex(i); setShowOutline(false) }}
        />
      )}

      {/* 依存语法树（Ctrl+2）。revealed=false 时组件自己会先拦一道剧透确认。 */}
      {showTree && (
        <SentenceTreeModal
          sentence={sentence}
          revealed={isRevealed}
          onClose={() => setShowTree(false)}
        />
      )}

      {/* 句子解析 / 词汇与结构（Ctrl+/）。同一个剧透闸门。 */}
      {showExplain && (
        <SentenceExplainModal
          sentence={sentence}
          revealed={isRevealed}
          onClose={() => setShowExplain(false)}
        />
      )}

      {/* Transition Overlay */}
      <TransitionOverlay
        show={transition.show}
        message={transition.message}
        onComplete={transition.onComplete}
      />

      {/* Sentence Feedback (Great / Perfect / Combo) */}
      <SentenceFeedback
        trigger={feedback.trigger}
        variant={feedback.variant}
        streak={feedback.streak}
        earned={feedback.earned}
      />

      {/* Reset Confirm Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl bg-card border border-border p-8 text-center max-w-sm mx-4 shadow-2xl">
            <p className="text-lg font-bold text-foreground">确认重置</p>
            <p className="mt-3 text-sm text-foreground/60">重置后当前进度和计时器将归零，确定要重置吗？</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button onClick={() => setShowResetConfirm(false)} className="rounded-xl border border-foreground/10 px-6 py-2.5 text-sm text-foreground/60 hover:bg-foreground/5 transition-colors">取消</button>
              <button onClick={() => { setShowResetConfirm(false); doReset() }} className="rounded-xl bg-red-500/80 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-500 transition-colors">确认重置</button>
            </div>
          </div>
        </div>
      )}

      {/* Shuffle Confirm Modal */}
      {showShuffleConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl bg-card border border-border p-8 text-center max-w-sm mx-4 shadow-2xl">
            <p className="text-lg font-bold text-foreground">确认打乱</p>
            <p className="mt-3 text-sm text-foreground/60">打乱后句子顺序将随机排列，并从头开始，确定要打乱吗？</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button onClick={() => setShowShuffleConfirm(false)} className="rounded-xl border border-foreground/10 px-6 py-2.5 text-sm text-foreground/60 hover:bg-foreground/5 transition-colors">取消</button>
              <button onClick={() => { setShowShuffleConfirm(false); doShuffle() }} className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition-colors">确认打乱</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl bg-card border border-border p-8 text-center max-w-sm mx-4 shadow-2xl">
            <p className="text-lg font-bold text-foreground">暂停学习</p>
            <p className="mt-3 text-sm text-foreground/60 leading-relaxed">
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
        <div className="fixed inset-0 z-50 flex items-start justify-start bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl bg-card border border-border p-8 text-center max-w-sm m-6 shadow-2xl">
            <p className="text-lg font-bold text-foreground">确认返回</p>
            <div className="mt-5 space-y-2.5">
              <Link
                href="/home/store"
                className="block w-full rounded-xl border border-foreground/10 px-5 py-2.5 text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
              >
                <ShoppingBag className="h-4 w-4 inline mr-2" />
                返回课程列表
              </Link>
              <Link
                href={`/home/store/${courseId}`}
                className="block w-full rounded-xl border border-foreground/10 px-5 py-2.5 text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
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
      <div className="flex items-center justify-center gap-3 sm:gap-4 md:gap-8 shrink-0 px-3 sm:px-6 py-3 sm:py-4">
        <button
          onClick={debouncedGoPrev}
          disabled={currentIndex === 0}
          className="flex items-center gap-0.5 sm:gap-1 text-xs sm:text-sm text-foreground hover:text-foreground/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8" />
          <span className="hidden sm:inline">上一句</span>
        </button>

        {/* Keyboard shortcuts — hidden on smallest mobile */}
        <div className="hidden sm:flex items-center gap-1 sm:gap-2 flex-wrap justify-center">
          <ShortcutBadge keys={["Ctrl", "'"]} label="发音" onClick={() => { const s = sentencesRef.current[currentIndexRef.current]; if (s) globalSpeak(s.english) }} />
          <ShortcutBadge keys={["Ctrl", ";"]} label={showAnswer ? "隐藏答案" : "显示答案"} onClick={debouncedToggleAnswer} />
          <ShortcutBadge keys={["Ctrl", "2"]} label="语法树" onClick={() => setShowTree(true)} />
          <ShortcutBadge keys={["Ctrl", "/"]} label="解析" onClick={() => setShowExplain(true)} />
          <ShortcutBadge keys={["Ctrl", "P"]} label={isPaused ? "继续" : "暂停"} onClick={debouncedTogglePause} />
          <ShortcutBadge keys={["Space"]} label="确认" onClick={debouncedConfirmWord} />
          <ShortcutBadge keys={["Enter"]} label="提交" onClick={debouncedSubmitAll} />
        </div>

        <button
          onClick={debouncedGoNext}
          className="flex items-center gap-0.5 sm:gap-1 text-xs sm:text-sm text-foreground hover:text-foreground/70 transition-colors shrink-0"
        >
          <span className="hidden sm:inline">下一句</span>
          <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8" />
        </button>
      </div>
    </div>
  )
}
