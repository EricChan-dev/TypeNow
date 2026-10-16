"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import type { Sentence } from "@/types"
import { buildAnnotation } from "@/lib/annotated-sentence"
import {
  dictationTokens,
  isAutoFilledToken,
  normalizeQuotes,
} from "@/lib/dictation-tokens"
import {
  configureMeasureHost,
  disposeMeasureElements,
  dynamicInputWidth,
  invalidateMeasureCache,
  measureWordInputWidth,
} from "@/lib/dictation-measure"
import {
  applyPersonalization,
  applyThemeStyle,
  DEFAULT_DICTATION_INPUT_SETTINGS,
  DICTATION_FONT_LABELS,
  DICTATION_FONT_MODAL_LABELS,
  DICTATION_FONT_OPTIONS,
  loadAudioVisualizer,
  loadAutoNext,
  loadAutoRevealThreshold,
  loadConfetti,
  loadDictationInputSettings,
  loadFragmentImage,
  loadFragmentMode,
  loadLoopCount,
  loadNextPreview,
  loadImmersive,
  loadSentenceImage,
  loadShortcutOverlay,
  loadShowChinese,
  loadShowPhonetics,
  loadSuccessPlayCount,
  MAX_SUCCESS_PLAY,
  DEFAULT_SUCCESS_PLAY,
  loadThemeStyle,
  loadToolbarDensity,
  saveAutoNext,
  saveAutoRevealThreshold,
  saveAudioVisualizer,
  saveConfetti,
  saveDictationInputSettings,
  saveFragmentImage,
  saveFragmentMode,
  saveLoopCount,
  saveNextPreview,
  saveSentenceImage,
  saveShortcutOverlay,
  saveShowChinese,
  saveShowPhonetics,
  saveSuccessPlayCount,
  saveThemeStyle,
  saveImmersive,
  saveToolbarDensity,
  applyImmersive,
  THEME_STYLE_LABELS,
  type DictationInputSettings,
  type ThemeStyle,
  type ToolbarDensity,
} from "@/lib/practice-prefs"
import {
  getSfxEnabledSnapshot,
  getSfxEnabledServerSnapshot,
  setSfxEnabled,
  subscribeSfxEnabled,
} from "@/lib/sfx"
import { type PracticeMode } from "@/lib/practice-mode"
import { ModeSwitcher } from "./ModeSwitcher"
import {
  DEFAULT_SHORTCUTS,
  VISIBLE_SHORTCUT_IDS,
  isDefaultShortcuts,
  loadShortcuts,
  matchShortcut,
  resetShortcuts,
  saveShortcuts,
  shortcutKbdParts,
  validateCombo,
  type ShortcutBinding,
  type ShortcutId,
} from "@/lib/practice-shortcuts"
import { normalizeSentences, isExpandedIndexSpace, mapExpandedIndexToRawIndex } from "@/lib/sentence-expand"
import { decideResume } from "@/lib/practice-session"
import { baseSentenceId } from "@/lib/sentence-id"
import { findNextLesson } from "@/lib/course-nav"
import { getCurrentAudioElement, globalSpeak, isSpeaking, stopSpeaking, subscribeSpeaking, waitForSpeechEnd, useTTSSettings, YOUDAO_EN_VOICES } from "@/lib/hooks/useTTSSettings"
import { startVisualizer, stopVisualizer } from "@/lib/audio-visualizer"
import { playError, playTyping, playChime } from "@/lib/sfx"
import { fireSuccessBurst, startCompletionFireworks, resetConfetti } from "@/lib/confetti"
import { toast } from "sonner"
import {
  trackLessonStart,
  trackPracticeComplete,
  trackPaywallShown,
  trackTouchNoticeDismissed,
  trackTouchNoticeShown,
  trackTrialClaimed,
} from "@/lib/analytics"
import {
  dismissDesktopNotice,
  getDesktopNoticeServerSnapshot,
  getDesktopNoticeSnapshot,
  subscribeDesktopNotice,
} from "@/lib/desktop-only"
import { InlineSpeakingBar } from "@/components/home/learn/InlineSpeakingBar"
import { SpeakingPractice } from "@/components/home/learn/SpeakingPractice"
import { PuzzlePractice } from "@/components/home/learn/PuzzlePractice"
import { WordDetailCard } from "@/components/home/learn/WordDetailCard"
import { StructuredAnswerView } from "@/components/home/learn/StructuredAnswerView"
import { buildStructuredAnswer } from "@/lib/structured-answer"
import { fragmentsForSentence, mergedFragmentGroups } from "@/lib/fragment-practice"
import { BRAND } from "@/lib/brand"
import { TRIAL_DAYS } from "@/lib/trial-days"
import type { TrialInfo } from "@/lib/free-trial"

/**
 * 音效调用一律包一层守卫：先判 `typeof playTypingSound === 'function'` 再调用。
 *
 * 不要把这层守卫当「可有可无的防御」删掉。音频模块是**独立 chunk**，dev 下
 * Turbopack 内存触顶会自动重启（日志：`Server is approaching the used memory
 * threshold, restarting`），此时浏览器缓存里那份 sfx chunk 与新的模块图对不上，
 * 导出对象上根本没有 playTyping。裸调用会抛 `TypeError: ...playTyping is not a
 * function`，把它**下面那行真正干活的语句**一起带走：
 *   · 打字音效处抛错 → 字符虽已入槽但后续逻辑中断；
 *   · 跳格处音效抛错 → `focusSlot(index, 1)` 永不执行 → **空格/右箭头无法跳到下一词**。
 * 用户看到的就是「打字报错 + 空格不能切词」两个症状，其实是同一个异常。
 * 加守卫后音效失效只会静音，输入路径不受影响。
 */
const sfxTyping = () => { const f = playTyping; if (typeof f === "function") f() }
const sfxError = () => { const f = playError; if (typeof f === "function") f() }
const sfxChime = () => { const f = playChime; if (typeof f === "function") f() }

/**
 * 听写模式（键盘打字）。
 *
 * 为什么另起一个组件而不是改 LearnClient：听写模式与旧版练习页在
 * 结构、判题口径、键盘行为上几乎没有一处重合（旧版空格确认单词、0.5s 自动跳转，
 * 听写模式空格移动焦点、无自动跳转、答对后必进答案回顾屏）。在 2,569 行的旧组件里
 * 改会造成两套语义互相污染，所以新写一份，旧组件保留给其余三种模式。
 *
 * 数据层（取句、恢复进度、上报、金币、分析）全部复用既有接口，避免两套实现
 * 在「进度写到哪里」上分叉。
 */

type Status = "input" | "review" | "complete"

interface SlotInput {
  value: string
  /** 期望值（小写 token）；只读槽位与它永远相等 */
  expected: string
  readonly: boolean
  wasIncorrect: boolean
}

export function DictationPractice({
  courseId,
  lessonId,
  mode = "dictation",
}: {
  courseId: string
  lessonId: string
  /**
   * 当前练习模式。**外壳（顶栏 / 进度条 / 计时器 / 底部工具栏）四种模式共用**
   * —— 口语等模式只把 `main#practiceContent` 的内容换掉，外壳不动。所以这里
   * 也只用 `mode` 决定 `main` 里渲染哪一套内容，而不是另起一个满屏组件
   * （那会让顶栏、模式切换器、底栏全部消失）。
   *
   * 默认 `"dictation"`：本组件最初就是听写模式专用，保留默认值让既有调用点
   * （以及只关心听写的测试/探针）无需改动。
   */
  mode?: PracticeMode
}) {

  // ── 数据状态 ────────────────────────────────────────────────────────────────
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading")
  const [trial, setTrial] = useState<TrialInfo | null>(null)
  const [trialAvailable, setTrialAvailable] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [status, setStatus] = useState<Status>("input")
  const [completed, setCompleted] = useState<Set<number>>(new Set())
  const [mistaken, setMistaken] = useState<Set<number>>(new Set())
  const [timer, setTimer] = useState(0)
  const [paused, setPaused] = useState(false)
  const [nextLesson, setNextLesson] = useState<{ id: string; title?: string } | null>(null)
  const [courseTitle, setCourseTitle] = useState("")
  const [lessonTitle, setLessonTitle] = useState("")

  // ── 界面偏好（全部来自 localStorage，挂载后读取） ─────────────────────────────
  const [showChinese, setShowChinese] = useState(true)
  const [autoNext, setAutoNext] = useState(false)
  const [successPlayCount, setSuccessPlayCount] = useState(DEFAULT_SUCCESS_PLAY)
  const [revealThreshold, setRevealThreshold] = useState(3)
  const [personalization, setPersonalization] = useState<DictationInputSettings>(
    DEFAULT_DICTATION_INPUT_SETTINGS,
  )
  // 「更多设置」里的开关。默认全开；
  // 首帧用默认值、挂载后再读 localStorage，避免水合不一致。
  const [showPhonetics, setShowPhonetics] = useState(true)
  const [nextPreview, setNextPreview] = useState(true)
  // 答案视图的两种形态，两个默认都是 true：
  //   · hintStructured —— 按 ⌘+A 的「看答案」浮层用结构化还是纯文本
  //   · learningStructure —— 复习屏显示语法结构还是注音单词视图
  // 它们**只存在内存里**，不持久化（刷新即回默认）。
  const [hintStructured, setHintStructured] = useState(true)
  const [learningStructure, setLearningStructure] = useState(true)
  const [confetti, setConfetti] = useState(true)
  const [audioVisualizer, setAudioVisualizer] = useState(true)
  const [shortcutOverlayEnabled, setShortcutOverlayEnabled] = useState(true)
  const [sentenceImage, setSentenceImage] = useState(false)
  // 分段练习配图开关。纯偏好，没有功能依赖，所以可以完整实现。键值是 'true'/'false' 字符串。
  const [fragmentImage, setFragmentImage] = useState(true)
  /**
   * 「分段练习」总开关，默认 **OFF**。开启后当前句先逐段听写、再整句听写。
   */
  const [fragmentMode, setFragmentMode] = useState(false)
  /**
   * 当前练到第几段。**按句绑定**（带 `sid`），这样切句时无需 effect 重置 ——
   * `sid` 对不上就自动回到 0。用派生代替在十几个调用点手工重置，杜绝漏调。
   */
  // `phase`：分段练习阶梯内的档位 —— "single" 逐段听写，"merged" 相邻 3 段
  // 合并档（mergedFragmentGroups 的产物）。塞进 fragmentPos 而不是独立 state，
  // 是为了「切句后 sid 对不上 → 自动回单段第 0 段」这条既有兜底同时覆盖档位。
  const [fragmentPos, setFragmentPos] = useState<{
    sid: string
    index: number
    phase: "single" | "merged"
  } | null>(null)
  /**
   * 本句的分段练习是否已「跳过」或「已结束」。
   *
   * 一个**按句**的锁：点「跳过 →」、或答完全部片段、或中途关掉开关都会置位，
   * 置位后本句不再进入分段练习。同样按句绑定，切句自动失效。
   */
  const [fragmentDoneFor, setFragmentDoneFor] = useState<string | null>(null)
  /** `#fragmentResultMessage` 的状态：答错是 `error` + 「请再试一次」。 */
  const [fragmentResult, setFragmentResult] = useState<"" | "error">("")
  const [loopCount, setLoopCount] = useState(1)
  const [toolbarDensity, setToolbarDensity] = useState<ToolbarDensity>("normal")
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>("dark")
  /* TTS 音色设置（voiceCard）。此前这卡是死的：value 硬编码「美式男声」、
     onClick 空操作，YOUDAO_EN_VOICES 全仓零引用 —— 用户反馈 m22433
     「切换不了」。现在接上 useTTSSettings：有道音色 + 系统英文语音，
     选中即写 localStorage（typenow_tts_settings）并试听一次。 */
  const { settings: ttsSettings, updateSettings: updateTtsSettings, enVoices: ttsBrowserVoices } = useTTSSettings()
  const ttsVoiceShort =
    ttsSettings.source === "youdao"
      ? (YOUDAO_EN_VOICES.find((v) => v.name === ttsSettings.youdaoVoice)?.label ?? ttsSettings.youdaoVoice).split(" ")[0]
      : ttsSettings.voice || "系统默认"
 // 极简沉浸模式。默认关闭。
  const [immersive, setImmersive] = useState(false)
 // 全屏状态跟随浏览器（fullscreenchange 事件同步图标）
  const [fullscreen, setFullscreen] = useState(false)
  // 键盘音效直接复用全局 SFX 开关（同一件事，不另起一个键）。
  const sfxEnabled = useSyncExternalStore(
    subscribeSfxEnabled,
    getSfxEnabledSnapshot,
    getSfxEnabledServerSnapshot,
  )
  /**
   * 「此刻有没有朗读在响」。拿到它才能让频谱条跟着实际播放起停，而不是
   * 跟着「用户点了播放按钮」—— 播放会被打断、会失败、会自动结束，
   * 只有这条订阅流才反映真实状态。
   */
  const speaking = useSyncExternalStore(subscribeSpeaking, isSpeaking, () => false)

  /**
   * === Layer 2.4: 触屏设备提示（PC 优先）===
   *
   * 只提示不拦截：平板上接了外接键盘的用户照样能正常练习，硬拦会把本来
   * 能用的场景一并挡掉。判定与持久化都在 `src/lib/desktop-only.ts`，
   * 那里记着这条产品决策的完整来龙去脉（练习页输入完全依赖 keydown，
   * 软键盘能否吐出可用的 keydown 取决于各家输入法，实测不可靠；所以
   * 退守 PC 优先，改为如实告知用户换电脑）。
   *
   * 与 sfx 开关同样用订阅式读值而不是在 effect 里 setState：服务端不知道
   * 设备形态，先渲染提示条再撤掉会闪一下；订阅还能在用户平板上插上鼠标/
   * 键盘时（`(hover: none)` 变 false）自动收起提示。
   */
  const showDesktopNotice = useSyncExternalStore(
    subscribeDesktopNotice,
    getDesktopNoticeSnapshot,
    getDesktopNoticeServerSnapshot,
  )

  /**
   * 触屏提示出现时上报一次。
   *
   * 每次挂载只报一次是必须的：`showDesktopNotice` 会随 `(hover: none)` 变化
   * （平板插上/拔掉键盘），跟着它报会在同一次访问里重复计数，于是「触屏用户
   * 有多少」这个分母直接被放大。
   */
  const touchNoticeTrackedRef = useRef(false)
  useEffect(() => {
    if (showDesktopNotice && !touchNoticeTrackedRef.current) {
      touchNoticeTrackedRef.current = true
      trackTouchNoticeShown()
    }
  }, [showDesktopNotice])

  // ── 菜单/面板开合 ───────────────────────────────────────────────────────────
  // 模式下拉与切换确认弹窗的状态都随组件移进 `ModeSwitcher` 了，
  // 这里不再持有 `modeMenuOpen` / `pendingMode`。
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showHint, setShowHint] = useState(false)
  /**
   * 底部「已加入错题本」通知。
   *
   * 保持单实例：连续两次错误不叠层，用 `mistakeNoticeEpoch` 自增重启时间线（旧通知先收、
   * 再重新滑入），节奏一致且不会叠层。epoch 归 0 表示通知已卸载。
   */
  const [mistakeNoticeEpoch, setMistakeNoticeEpoch] = useState(0)
  /** 通知的 `.show` 相位（滑入/滑出） */
  const [mistakeNoticeShow, setMistakeNoticeShow] = useState(false)
  /**
   * 结果条的类名状态。每次提交先清掉旧类名，答错时置 error。
   * 听写模式答对会直接进复习屏、不写文本；`success show` 只出现在
   * **学习模式**分支，听写走不到，所以这里只有 `error` 一种置位。
   */
  const [resultMessage, setResultMessage] = useState<"" | "error">("")
  /** 设置面板里展开的卡片下拉（显示风格 / 发音偏好 / 自动播放次数） */
  const [openDropdown, setOpenDropdown] = useState<"theme" | "voice" | "loop" | null>(null)
  /** 个性化设置模态框 */
  const [personalizationOpen, setPersonalizationOpen] = useState(false)
  /**
   * 模态框里的草稿。在模态框内先改草稿，只有点「应用设置」才写盘并落到页面上。
   * 用独立 state 而不是直接改 `personalization`，是为了让「关闭」能真正丢弃改动。
   */
  const [personalizationDraft, setPersonalizationDraft] = useState<DictationInputSettings>(
    DEFAULT_DICTATION_INPUT_SETTINGS,
  )
  /** 更多设置模态框 */
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false)
  /** 「自动弹答案错误次数」下拉是否展开 */
  const [revealMenuOpen, setRevealMenuOpen] = useState(false)

  /**
   * 快捷键设置弹窗（设置面板「自定义快捷键」卡片点开）。
   * 快捷键是用户可改的，配置存 localStorage（见 src/lib/practice-shortcuts.ts），这里保存运行时的那一份。
   */
  const [shortcuts, setShortcuts] = useState<Record<ShortcutId, ShortcutBinding>>(DEFAULT_SHORTCUTS)
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false)
  /**
   * 正在录制按键的动作 id。用 state 驱动（要重渲染出录制态那一行），
   * 同时镜像到 ref 给全局 keydown 处理器读 —— 它挂在 effect 闭包里，
   * 拿不到最新的 state。
   */
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null)
  /** 录制态的行内警示文案（例如「⚠ 与「播放语音」冲突，请按其他键…」）。 */
  const [recordingWarning, setRecordingWarning] = useState<string | null>(null)
  /**
   * 录制时累积按下的纯修饰键个数，用来区分「单按 Control」和「Control 作为组合键的前缀」。
   */
  const modifiersPressedRef = useRef(0)

  // ── 收藏当前句（底栏星标） ──────────────────────────────────────────────────
  const [favorited, setFavorited] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)

  /**
   * 移动端提交按钮可见性不走 CSS 媒体查询。初始 false，挂载后再按客户端特征纠正 ——
   * 服务端渲染时拿不到 `matchMedia`，直接用它会在 hydration 时产生不一致。
   */
  const [isMobile, setIsMobile] = useState(false)

  // ── 输入槽状态 ──────────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<SlotInput[]>([])
  const [baseWidths, setBaseWidths] = useState<number[]>([])
  /**
   * 正在发音的单词槽下标（用于 `.word-speak-btn.playing` 的脉冲动画）。
   * 播放时给按钮加 `.playing` 类、播完再摘掉。
   */
  const [speakingWordIndex, setSpeakingWordIndex] = useState<number | null>(null)
  /**
   * 当前聚焦的输入槽下标，用来给 `.word-input` 打 `typing` 类。
   *
   * focus 时打上 `typing`、blur 时移除，提交判题时再统一摘掉。
   *
   * `.typing` 没有对应 CSS 规则、JS 也不读它，纯粹是 DOM 状态；但它是「这一格正在被输入」的唯一标记，保留它便于 DOM 层面对照调试。
   *
   * 为什么用 state 而不是直接 `classList`：React 掌着 `className`，
   * 下一次重渲染会把手改的类名冲掉，状态必须走 React。
   */
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null)

  // ── refs ───────────────────────────────────────────────────────────────────
  const shellRef = useRef<HTMLDivElement | null>(null)
  const interfaceRef = useRef<HTMLDivElement | null>(null)
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])
  const slotsRef = useRef<SlotInput[]>([])
  const sentencesRef = useRef<Sentence[]>([])
  const currentIndexRef = useRef(0)
  const statusRef = useRef<Status>("input")
  const completedRef = useRef<Set<number>>(new Set())
  const mistakenRef = useRef<Set<number>>(new Set())
  const sentenceMistakesRef = useRef(0)
  const mistakeRecordedRef = useRef(false)
  const sentenceStartRef = useRef(Date.now())
  const timerRef = useRef(0)
  const submittingRef = useRef(false)
  /** 已在本句按过 Tab/Enter 的标记，用于避免重复进回顾屏。 */
  const reviewEpochRef = useRef(0)
  /**
   * 单词发音的序号。连点两个不同单词的喇叭时，先发的请求可能后回来 ——
   * 没有它，`.playing` 脉冲会盖在错误的下标上，而且旧的会先把新的摘掉。
   */
  const wordSpeakEpochRef = useRef(0)
  /** 未受控输入框的「权威值」，防 IME 绕过 preventDefault 造成双字符。 */
  const kdValueRef = useRef<Map<number, string>>(new Map())
  const pausedRef = useRef(false)
  const autoNextRef = useRef(false)
  const successPlayRef = useRef(DEFAULT_SUCCESS_PLAY)
  /**
   * 「自动播放次数」的同步镜像。
   *
   * 自动朗读发生在 `globalSpeak` 的 `setTimeout` 回调、快捷键监听器和底栏
   * `onClick` 里，这些地方要么绑在首渲染闭包上、要么不依赖 `loopCount`，
   * 所以一律读这个 ref 而不是 state。
   */
  const loopCountRef = useRef(1)
  /**
   * 手动播放按钮 / 播放快捷键要用的次数。
   *
   * 手动档（0）补成 1 次保证一定出声，其余档沿用设定次数。
   * 从 `loopCountRef` 直接推比再存一个 ref 稳妥：少一处渲染期写入。
   */
  const manualPlayCount = () => (loopCountRef.current === 0 ? 1 : loopCountRef.current)
  /**
   * 「答对烟花效果」（`confetti_effect`）的同步镜像。
   *
   * 在 `triggerSuccessEffects()` 里**按调用时刻**判断 —— 不是渲染期依赖。
   * 我们的答对分支分散在 4 个 `useCallback` 里（听写/片段/口语/拼图），
   * 顺着 ref 读省掉往 4 个依赖数组里塞 state。
   */
  const confettiRef = useRef(true)
  /**
   * 答对时的视觉奖励。
   *
   * 只有「答对烟花效果」开着才炸；关掉时连彩带画布都不创建（该开关的 hint 正是「减少性能开销」）。
   */
  const triggerSuccessEffects = useCallback(() => {
    if (!confettiRef.current) return
    fireSuccessBurst()
  }, [])
  const revealRef = useRef(3)
  const showChineseRef = useRef(true)
  const trackedCompleteRef = useRef(false)
  /** 收藏请求进行中的同步镜像：快捷键处理器在闭包里读它，避免依赖 state 重建监听 */
  const favoriteBusyRef = useRef(false)
  /**
   * 本片段连错次数。**独立于整句**的计数 —— 分段练习不记录错题，只用来触发自动揭示答案。
   * 是**独立于整句**的计数 —— 分段练习不记录错题，只用来触发自动揭示答案。
   */
  const fragmentMistakesRef = useRef(0)
  /**
   * `checkAnswer` 的最新引用。
   *
   * `handleKeyDown` 的依赖是 `[focusSlot, setSlotValue]`，两者都是空依赖的
   * `useCallback`，所以它**只在首次渲染绑一次**。而首次渲染时 `sentences` 还
   * 没加载，`sentence` 是 `null` —— 它捕获的 `checkAnswer` 永远是那个
   * 「句子为 null」的版本。后果是回车提交虽然能判对错、能进回顾屏（那部分
   * 只读 `slotsRef`），但闭包里的 `sentence` 恒为 `undefined`：
   *   - `baseSentenceId(sentence?.id ?? "")` → `""`，`/api/practice/sessions`
   *     与错题上报全部静默跳过（`if (parentId)` 不成立）；
   *   - `playReviewAudio` 第一行 `const text = sentence?.english` 拿到 `undefined`，
   *     直接 `return` —— 于是**答对后既不朗读、也不会自动进入下一句**。
   *
   * 用 ref 转一手即可：`handleKeyDown` 绑定的仍是首次的那个函数，但它每次
   * 执行都去读当前渲染写下的最新 `checkAnswer`。移动端提交按钮
   * （`onClick` 直接闭包引用）本来就拿的是最新值，没有这个问题。
   */
  const checkAnswerRef = useRef<(() => void) | null>(null)
  /**
   * 已上报过完成进度的句子 id（口语 / 学习模式）。
   *
   * 为什么非要这个 ref：这两个模式把网络请求写在 `setCompleted` 的 updater
   * 里「顺手发一下」，而 **React 在开发模式下会双调用 reducer**（StrictMode 的
   * 一致性检查，也见于并发渲染重放）。updater 必须是纯函数 —— 副作用放进去
   * 就会被执行两次。实测（CDP 注入 fetch 并记调用栈）：进入学习模式首句时
   * `/api/practice/sessions` **确实发了两次**，栈顶都指向 `markLearningComplete`
   * 里的 `basicStateReducer` / `updateReducerImpl`。
   *
   * 修法是**把副作用移出 updater**：先用本 ref 同步判重（同一 tick 内重复调用
   * 也拦得住，不依赖「渲染已提交」），发完请求再改状态。用句子 id 而不是下标
   * 做键 —— 换课节时下标会重叠，id 不会。
   */
  const reportedCompleteRef = useRef<Set<string>>(new Set())

  slotsRef.current = slots
  sentencesRef.current = sentences
  currentIndexRef.current = currentIndex
  statusRef.current = status
  completedRef.current = completed
  mistakenRef.current = mistaken
  pausedRef.current = paused
  autoNextRef.current = autoNext
  successPlayRef.current = successPlayCount
  loopCountRef.current = loopCount
  confettiRef.current = confetti
  revealRef.current = revealThreshold
  showChineseRef.current = showChinese
  timerRef.current = timer
  favoriteBusyRef.current = favoriteBusy

  const sentence = sentences[currentIndex] ?? null

 /** 本句的输入槽定义 —— 由英文分词推导，与 words 数组同源。 */
  const tokens = useMemo(
    () => (sentence ? dictationTokens(sentence.english) : []),
    [sentence],
  )

  /**
   * 「看答案」浮层用的结构化答案。
   *
 * 用 `enableFallback=true` —— 练习中查看答案走的是这个口径
   * （第四个参数传 true），宁可降级成纯文本也不给
   * 错的成分标注。复习屏那边相反，传 false，所以它自己在 ReviewScreen
   * 内部另算一份（那边还要用 useDeferredValue 让首帧先出注音视图）。
   */
  const hintAnswer = useMemo(
    () => buildStructuredAnswer(sentence, "us", true),
    [sentence],
  )

  /**
   * 当前句可以切出的听写片段（分层累积的 `chunks` 经 DP 线性化）。
   * 铺不满或只有 1 段时返回 null —— 该句不做分段练习。
   */
  const fragments = useMemo(() => fragmentsForSentence(sentence), [sentence])

  const fragmentSid = sentence?.id ?? ""
  /**
   * 当前是否处于分段练习态。
   *
 * 四个条件逐条对应如下：
   *   1. 开关开着
   *   2. 有可分段的片段
   *   3. 本句尚未跳过/结束（`fragmentDoneFor !== sid`）
 * 4. **本模式是听写** —— 原判定门写的是
   *      `canUseFragmentPractice() && isFragmentModeEnabled &&
   *       practiceMode === 'dictation' && !isInFragmentPractice && …`。
   *      本组件现在同时承载听写/口语/拼图三种模式（`mode` prop），
   *      所以第 4 条必须显式写出来，不能再靠「本组件就是听写模式」这个
   *      已经失效的假设。
   *
 * 第 5 条原是 `!isInFragmentPractice`（不在分段中才进入），那是用
   * 命令式状态机 + `loadCurrentSentence()` 重入留下的痕迹；我们这个派生量
   * 没有重入问题，不需要。
   */
  const inFragmentPractice =
    mode === "dictation" &&
    fragmentMode &&
    fragments !== null &&
    fragmentSid !== "" &&
    fragmentDoneFor !== fragmentSid

  /** 相邻 3 段合并档（单段全过后、整句之前的过渡阶梯）；不足 4 段时为 null。 */
  const mergedGroups = useMemo(
    () => (fragments ? mergedFragmentGroups(fragments) : null),
    [fragments],
  )

  /** 当前档位。切句后 `fragmentPos.sid` 对不上即视作单段档的 0。 */
  const fragmentPhase = fragmentPos?.sid === fragmentSid ? fragmentPos.phase : "single"
  /** 本档的练习列表：单段档用线性化片段，合并档用 3 段合并组。 */
  const activeFragmentList =
    fragmentPhase === "merged" && mergedGroups !== null ? mergedGroups : fragments

  /** 当前片段下标（0 基）。切句后 `fragmentPos.sid` 对不上即视作 0。 */
  const fragmentIndex = fragmentPos?.sid === fragmentSid ? fragmentPos.index : 0

  const currentFragment = inFragmentPractice
    ? (activeFragmentList?.[fragmentIndex] ?? null)
    : null

  /** 片段的分词（与整句同口径，标点已被抹掉，用户不需要敲标点）。 */
  const fragmentTokens = useMemo(
    () => (currentFragment ? dictationTokens(currentFragment.text) : []),
    [currentFragment],
  )

  /**
   * 本回合「要敲的词」。
   *
   * 分段练习与整句练习共用同一套输入机件（`slots` / `inputsRef` / `focusSlot` /
 * `handleKeyDown`），只把词表换掉 —— 原本也是两份几乎逐行相同的代码
   * （分段版与整句版各一份），差别仅在
   * 容器 id 与 `measureWordInputWidth` 的紧凑参数（片段传 80、整句传 100）。
   * 我们合并成一份，避免两份实现各自漂移。
   */
  const activeTokens = inFragmentPractice ? fragmentTokens : tokens

  /** 退回到整句练习：锁住本句，并清掉分段态。 */
  const startFullSentencePractice = useCallback(() => {
    if (fragmentSid) setFragmentDoneFor(fragmentSid)
    setFragmentPos(null)
    setFragmentResult("")
    setShowHint(false)
  }, [fragmentSid])

  // ── 载入偏好 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setShowChinese(loadShowChinese(lessonId))
    setAutoNext(loadAutoNext())
    setSuccessPlayCount(loadSuccessPlayCount())
    setRevealThreshold(loadAutoRevealThreshold())
    setPersonalization(loadDictationInputSettings())
    setShowPhonetics(loadShowPhonetics())
    setNextPreview(loadNextPreview())
    setConfetti(loadConfetti())
    setAudioVisualizer(loadAudioVisualizer())
    setShortcutOverlayEnabled(loadShortcutOverlay())
    setSentenceImage(loadSentenceImage())
    setFragmentImage(loadFragmentImage())
    setFragmentMode(loadFragmentMode())
    setLoopCount(loadLoopCount())
    setToolbarDensity(loadToolbarDensity())
    setThemeStyle(loadThemeStyle())
    setImmersive(loadImmersive())
    setShortcuts(loadShortcuts())
  }, [lessonId])

 // 沉浸模式落到壳元素上（不写 document.body，理由同 applyThemeStyle）
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    applyImmersive(el, immersive)
  }, [immersive])

 // 全屏状态跟随浏览器（监听
  // fullscreenchange / webkitfullscreenchange 来换图标与显隐退出按钮）
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement)
    sync()
    document.addEventListener("fullscreenchange", sync)
    document.addEventListener("webkitfullscreenchange", sync)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener("webkitfullscreenchange", sync)
    }
  }, [])

  // 个性化设置落到壳元素上，并让宽度测量缓存失效（字号变了，量出的宽也变了）
  useEffect(() => {
    const host = interfaceRef.current
    if (!host) return
    applyPersonalization(host, personalization)
    invalidateMeasureCache()
    disposeMeasureElements()
    configureMeasureHost(host)
    // 字体族/字号变化会改变每个词的像素宽，必须重新量一遍
    setBaseWidths(
      tokens.map((t) => measureWordInputWidth(t, window.innerWidth <= 1024)),
    )
  }, [personalization, tokens])

 // 移动端判定：没有服务端注入的 `isMobile` 可读，我们只能在
  // 客户端按指针能力推断。用 `pointer: coarse` + 视口宽而不是单看 UA ——
  // 桌面浏览器的移动端模拟器（DevTools 设备模式）也会给 coarse，这正是我们要的。
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)")
    const sync = () => setIsMobile(mq.matches || window.innerWidth <= 768)
    sync()
    mq.addEventListener("change", sync)
    window.addEventListener("resize", sync)
    return () => {
      mq.removeEventListener("change", sync)
      window.removeEventListener("resize", sync)
    }
  }, [])

  // 卸载时清掉隐藏测量节点，避免多次进出练习页在 DOM 里累积
  useEffect(() => () => disposeMeasureElements(), [])

  // ── 取句 + 恢复进度（复用既有数据层） ────────────────────────────────────────
  useEffect(() => {
    trackLessonStart(courseId, lessonId)
    let alive = true
    fetch(`/api/courses/sentences?lessonId=${lessonId}`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return
        if (!Array.isArray(json?.sentences)) {
          setLoadState("error")
          return
        }
        const raw = json.sentences as Sentence[]
        // 听写模式**不**摊平分块：一句一个练习项，`chunks` 原样留给分段练习
 // （`chunks` 的唯一用途就是分段练习的数据源）。用 expandSentences
        // 会把 chunks 置 null，分段练习静默失效。
        const normalized = normalizeSentences(raw)
        setTrial(json?.trial ?? null)
        setTrialAvailable(!!json?.trialAvailable)
        setSentences(normalized)
        setLoadState("ready")
        fetch(`/api/practice/sessions?lessonId=${lessonId}&mode=${mode}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((res) => {
            if (!alive) return
            const session = res?.session
            // 老会话可能存的是摊平空间的下标（听写模式曾用 expandSentences）。
            // 两个坐标系的原句数不同，直接当原句下标用会被夹到最后一句 ——
            // 用户看到的是「进度莫名跑到末尾」。
            //
            // ⚠️ 必须先折算、再钳制。`decideResume` 内部会把下标夹到
            // `total - 1`，顺序反了的话摊平空间的大下标会被先压成原句空间的
            // 最后一句，折算就完全失去意义（32 项压成 5，再折算还是最后一句）。
            const mapped =
              session && isExpandedIndexSpace(session.sentenceCount, raw)
                ? { ...session, currentIndex: mapExpandedIndexToRawIndex(session.currentIndex, raw) }
                : session
            const decision = decideResume(mapped, normalized.length)
            if (decision.restored) setCurrentIndex(decision.index)
          })
          .catch((e) => { console.error(e) })
      })
      .catch((e) => { console.error(e); if (alive) setLoadState("error") })
    return () => { alive = false }
  }, [courseId, lessonId, mode])

 // 课程 / 课节标题（头部会显示「课程名 > 课节名」）
  useEffect(() => {
    fetch(`/api/courses/${courseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.data?.title) setCourseTitle(j.data.title) })
      .catch((e) => { console.error(e) })
    fetch(`/api/courses/${courseId}/lessons`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!Array.isArray(j?.data)) return
        const list = j.data as Array<{ id: string; title?: string }>
        const cur = list.find((l) => l.id === lessonId)
        if (cur?.title) setLessonTitle(cur.title)
        setNextLesson(findNextLesson(list, lessonId))
      })
      .catch((e) => { console.error(e) })
  }, [courseId, lessonId])

  // ── 计时（暂停时不走） ──────────────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!pausedRef.current && statusRef.current !== "complete") {
        setTimer((t) => t + 1)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  /**
 * 自动暂停（听写页**没有**手动暂停按钮）：
   *   - `visibilitychange` 且 `document.hidden` → 暂停
   *   - `window.blur` 且计时中 → 暂停
   *   - 2 分钟无操作 → 暂停（`INACTIVITY_TIMEOUT = 2 * 60 * 1000`，
   *     每 10s 检查一次；活动事件 mousedown/keydown/touchstart/scroll 刷新计时）
   * 恢复靠「点任意处」（排除设置面板）或「按任意键」。
   * 暂停时 `.header-stats` 加 `.paused`，时钟与倒计时变红
 * 还要延迟 300ms 才绑恢复监听，
   * 避免触发暂停的同一次事件立刻把练习恢复回来。
   *
 * 暂停时还要 `.pause()` 当前音频并停频谱动画：
   * 我们调 `stopSpeaking()`（它内部会 pause 并 resolve 等待中的 deferred），
   * 语义一致。
   */
  useEffect(() => {
    let inactivityTimer: number | null = null
    let lastActivity = Date.now()
    let resumeBound = false

    const bindResume = () => {
      if (resumeBound) return
      resumeBound = true
      document.addEventListener("click", handleResumeClick)
      document.addEventListener("keydown", handleResumeKeydown)
    }
    const unbindResume = () => {
      if (!resumeBound) return
      resumeBound = false
      document.removeEventListener("click", handleResumeClick)
      document.removeEventListener("keydown", handleResumeKeydown)
    }

    const doPause = () => {
      if (pausedRef.current || statusRef.current === "complete") return
      pausedRef.current = true
      setPaused(true)
      stopSpeaking()
      // 延迟绑定，避免本次事件立刻恢复
      window.setTimeout(bindResume, 300)
    }
    const doResume = () => {
      if (!pausedRef.current) return
      pausedRef.current = false
      setPaused(false)
      lastActivity = Date.now()
      unbindResume()
    }
    function handleResumeClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (t?.closest(".settings-dropdown-panel") || t?.closest(".settings-trigger-btn")) return
      doResume()
    }
    function handleResumeKeydown(e: KeyboardEvent) {
      if (!pausedRef.current) return
      e.preventDefault()
      doResume()
    }

    const markActivity = () => { if (!pausedRef.current) lastActivity = Date.now() }
    const handleVisibility = () => { if (document.hidden) doPause() }
    const handleBlur = () => { if (!pausedRef.current) doPause() }

    const activityEvents = ["mousedown", "keydown", "touchstart", "scroll"] as const
    activityEvents.forEach((ev) => document.addEventListener(ev, markActivity))
    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("blur", handleBlur)
    inactivityTimer = window.setInterval(() => {
      if (pausedRef.current) return
      if (Date.now() - lastActivity > 2 * 60 * 1000) doPause()
    }, 10_000)

    return () => {
      activityEvents.forEach((ev) => document.removeEventListener(ev, markActivity))
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("blur", handleBlur)
      unbindResume()
      if (inactivityTimer) window.clearInterval(inactivityTimer)
    }
  }, [])

  // 这里**故意不写** `lesson_<id>_mode`。
  //
  // 曾经有过一段无条件的 `localStorage.setItem(..., mode)`（`mode` 恒为 "dictation"），
  // 它会把「模式记忆」彻底堵死：子组件 effect 先于父组件 effect 执行，
  // 于是首帧 `PracticeModeGate` 还在用 `storedMode=null` 渲染听写时，
  // 这个 effect 已经把用户存的 `puzzle` 覆盖成 `dictation`，
  // 父组件随后去读就只读到 `dictation` 了。实测：预设 stored=puzzle、不带 `?mode=`
  // 访问，仍然进听写，且 stored 被改写成 dictation。
  //
 // 原逻辑也**只在 URL 显式给模式时**才写（URL 合法 → 用它并写；
  // 否则用 savedMode，不写）。落库交给 `PracticeModeGate`，那里只在有 `urlMode` 时写。
  // 本组件的两处切换入口（`:1523` 下拉、`:2365` 确认弹窗）都是整页跳转并带上 `&mode=`，
  // 所以真切换一定经过 gate，不会漏记。

  // ── 初始化当前句的输入槽 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!sentence) return
    const list: SlotInput[] = activeTokens.map((t) => {
      const readonly = isAutoFilledToken(t)
      return { value: readonly ? t : "", expected: t, readonly, wasIncorrect: false }
    })
    setSlots(list)
 // 片段用紧凑口径（`measureWordInputWidth(word, 80)`）；
    // 整句用默认 100。
    setBaseWidths(
      activeTokens.map((t) =>
        measureWordInputWidth(t, window.innerWidth <= 1024 || inFragmentPractice),
      ),
    )
    kdValueRef.current.clear()
    sentenceMistakesRef.current = 0
    mistakeRecordedRef.current = false
    sentenceStartRef.current = Date.now()
    setStatus("input")
    setShowHint(false)
    setFragmentResult("")
 // 进入本回合后自动朗读原音：分段读片段，整句读整句。
    // 次数取「自动播放次数」——0 表示手动档，此时**不自动出声**
 // （`playbackCount = ttsPlaybackCount`，0 时循环不执行）。
    const text = inFragmentPractice ? currentFragment?.text : sentence.english
    if (text) {
      window.setTimeout(() => { void globalSpeak(text, { count: loopCountRef.current }) }, 60)
    }
    /*
      依赖里必须有 `inFragmentPractice`：**同一句话**上开关/跳过会切换词表
      （整句 ↔ 片段），而 `sentence?.id` 与 `fragmentIndex` 都没变 ——
      少了这一项，开启分段练习后输入槽会仍是整句的那套。
      `activeTokens` 由这二者推导，所以不必单列。
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence?.id, fragmentIndex, inFragmentPractice])

 // ── 键盘：完全接管（逐条对应如下） ──────────────────────────────────────
  const focusSlot = useCallback((from: number, dir: 1 | -1) => {
    const list = slotsRef.current
    let i = from + dir
    while (i >= 0 && i < list.length) {
 // 跳过只读槽（数字自动填入），原逻辑同样跳过
      if (!list[i].readonly) break
      i += dir
    }
    if (i < 0 || i >= list.length) {
      // 走到边界时回到另一端第一个可输入槽；都找不到就不动
      const first = list.findIndex((s) => !s.readonly)
      if (first < 0) return
      i = dir === 1 ? first : list.length - 1
      while (i >= 0 && list[i].readonly) i -= 1
      if (i < 0) return
    }
    const el = inputsRef.current[i]
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
  }, [])

  const setSlotValue = useCallback((index: number, value: string) => {
    setSlots((prev) => {
      if (!prev[index]) return prev
      const next = [...prev]
      next[index] = { ...next[index], value }
      return next
    })
  }, [])

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      const el = e.currentTarget
      const list = slotsRef.current
      const slot = list[index]
      if (!slot || slot.readonly) return
      if (pausedRef.current) return

      // 字母/数字/撇号/连字符/斜杠 —— 手动追加，绝不让浏览器默认插入
      if (
        e.key.length === 1 &&
        /^[a-zA-Z0-9'\-\/]$/.test(e.key) &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault()
        const next = el.value + e.key
        kdValueRef.current.set(index, next)
        setSlotValue(index, next)
        sfxTyping()
 // 用户一改动就清掉错误标记
        if (slot.wasIncorrect) {
          setSlots((prev) => {
            const n = [...prev]
            n[index] = { ...n[index], wasIncorrect: false }
            return n
          })
        }
 // 原逻辑的自动跳转是**注释掉**的：保留用户自由控制
        return
      }

      if (e.key === "Backspace") {
        e.preventDefault()
        if (slot.wasIncorrect) {
          setSlots((prev) => {
            const n = [...prev]
            n[index] = { ...n[index], wasIncorrect: false }
            return n
          })
        }
        if (el.value.length > 0) {
          const next = el.value.slice(0, -1)
          kdValueRef.current.set(index, next)
          setSlotValue(index, next)
          sfxTyping()
        } else {
          sfxTyping()
          focusSlot(index, -1)
        }
        return
      }

      if (e.key === "Delete") {
        e.preventDefault()
        kdValueRef.current.set(index, "")
        setSlotValue(index, "")
        sfxTyping()
        return
      }

      if (e.key === "Enter") {
        e.preventDefault()
        // 走 ref 而不是直接引用：本回调只在首渲染绑定一次（见 checkAnswerRef
        // 注释），直接引用会永远停在「sentences 尚未加载」那一版。
        // ref 里装的已经是「此刻该用的那个判题函数」（分段/整句由渲染期选定，
        // 见 `checkAnswerRef.current = inFragmentPractice ? … : …`）。
        void checkAnswerRef.current?.()
        return
      }

      // 听写模式下**空格移动焦点**，不是确认（与旧版练习页相反）
 // 分段练习同样如此（空格/右箭头/Tab 都跳下一格）
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault()
        sfxTyping()
        focusSlot(index, 1)
        return
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault()
        sfxTyping()
        focusSlot(index, -1)
        return
      }

      /*
        Tab：整句练习里**保持原生行为**（跳到下一个可聚焦元素），分段练习里
 原逻辑把它并入「跳下一格」（把
        `' ' || 'ArrowRight' || 'Tab'` 一起判的）。
        哪个分支渲染了这个 input 从 id 就能看出来 —— `fragment-word-N` 是分段，
        `word-N` 是整句。用 DOM 判据免掉了第二个「同步镜像」ref。
      */
      if (e.key === "Tab") {
        if (el.id.startsWith("fragment-word-")) {
          e.preventDefault()
          sfxTyping()
          focusSlot(index, 1)
        }
        return
      }

      // 兜底：放过 IME（Unidentified / keyCode 229）与 Alt/Shift，其余一律拦掉
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key !== "Shift" &&
        e.key !== "Alt" &&
        e.key !== "Unidentified" &&
        e.keyCode !== 229
      ) {
        e.preventDefault()
      }
    },
    // checkAnswer 在下方定义，通过 ref（checkAnswerRef）调用：既避开循环依赖，
    // 也绕开「首渲染绑定一次就再也拿不到新闭包」的陷阱。ref 本身是稳定引用，
    // 所以这里不再需要 exhaustive-deps 抑制。
    [focusSlot, setSlotValue],
  )

  /**
   * input 事件兜底：keydown 已经手动设过值，若浏览器仍插入了字符（部分 IME 不遵守
 * preventDefault），把它覆盖回权威值（keydown 侧记下的 `kdValueRef` 即权威值）。
   */
  const handleInput = useCallback((index: number, e: React.FormEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const authoritative = kdValueRef.current.get(index)
    if (authoritative !== undefined) {
      if (el.value !== authoritative) el.value = authoritative
      return
    }
    // 没有 keydown 记录（例如移动端输入法直接改 value）：以实际值为准
    setSlotValue(index, el.value)
  }, [setSlotValue])

  // ── 判题 ───────────────────────────────────────────────────────────────────
  const checkAnswer = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    const list = slotsRef.current
    try {
      const wrong: Array<{ expected: string; input: string; position: number }> = []
      let firstWrongIndex = -1
      let allCorrect = true
      const nextSlots = list.map((slot, i) => {
        if (slot.readonly) {
          return { ...slot, wasIncorrect: false }
        }
        const userValue = normalizeQuotes((inputsRef.current[i]?.value ?? slot.value).trim().toLowerCase())
        const ok = userValue === normalizeQuotes(slot.expected.toLowerCase())
        if (!ok) {
          allCorrect = false
          if (firstWrongIndex < 0) firstWrongIndex = i
          wrong.push({ expected: slot.expected, input: slot.value.trim(), position: i })
        }
        return { ...slot, value: userValue, wasIncorrect: !ok }
      })
      setSlots(nextSlots)

      // 提交后取消焦点，避免横线模式的焦点样式残留
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()

 // 等价于 `resultMessage.classList.remove('show','success','error')`
      // —— 每次提交先清空状态；听写模式答对后直接进复习屏，不会再置回来。
      setResultMessage("")

      if (allCorrect) {
        sfxChime()
        triggerSuccessEffects()
        const parentId = baseSentenceId(sentence?.id ?? "")
        setCompleted((prev) => new Set(prev).add(currentIndexRef.current))
        // 上报进度（fire-and-forget），与旧版走同一个接口
        if (parentId) {
          void fetch("/api/practice/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lessonId, courseId, mode,
              currentIndex: currentIndexRef.current + 1,
              sentenceCount: sentencesRef.current.length,
              mistakeCount: 0,
              elapsedSeconds: timerRef.current,
              state: currentIndexRef.current >= sentencesRef.current.length - 1 ? "completed" : "active",
            }),
          }).catch((e) => { console.error(e) })
        }
        setStatus("review")
        await playReviewAudio()
      } else {
        sfxError()
        sentenceMistakesRef.current += 1
        // 抖动/RED 高亮不在这里做：`.word-input.incorrect` 自带
        // `animation: shake 0.4s ease`，而槽位上的 `wasIncorrect` 已经在渲染时
        // 落到 input 的 class 上（打字时会清掉，所以连错两次动画会重新触发）。
 // `.shake-animation` 只用在拼拼乐模式的
        // `#puzzleAnswerArea` 上，听写模式没有这层包装动画。
        // 连错达到阈值 → 揭示答案（覆盖层，不替换界面）
        const threshold = revealRef.current
        if (
          !mistakeRecordedRef.current &&
          threshold > 0 &&
          sentenceMistakesRef.current >= threshold
        ) {
          mistakeRecordedRef.current = true
          setMistaken((prev) => new Set(prev).add(currentIndexRef.current))
          // 「已加入错题本」通知从底部滑入，
          // 10ms 后加 .show，2s 后移除（再等 300ms 淡出后卸载）。
          setMistakeNoticeEpoch((e) => e + 1)
          const parentId = baseSentenceId(sentence?.id ?? "")
          if (parentId) {
            void fetch("/api/practice/record", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sentenceId: parentId,
                mistakes: sentenceMistakesRef.current,
                userInput: nextSlots.map((s) => s.value).join(" ").trim() || null,
              }),
            }).catch((e) => { console.error(e) })
          }
          setShowHint(true)
        }
 // 答错时把结果条清空文本并
        // 置为 `result-message error show`（听写模式文案为空，靠 CSS 着色）。
        setResultMessage("error")
        if (firstWrongIndex >= 0) {
          const el = inputsRef.current[firstWrongIndex]
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
        }
      }
    } finally {
      submittingRef.current = false
    }
    // playReviewAudio / sentence 通过 ref 或稳定引用访问
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, lessonId, mode, sentence?.id])

  /**
 * 逐段判题。
   *
 * 与整句 `checkAnswer` 的三点实质差异（不是风格差异，都是明确设计的行为）：
 * 1. **不记录错题、不上报进度** —— 口径是「分段练习不记录错题」，
   *      连答案都不发 `/api/practice/record`；答错只弹「请再试一次」。
   *   2. 只读槽（数字/人名）不校验，直接标 `correct`。
   *   3. 全对后不是进复习屏，而是 800ms 后自动进入下一段（或整句练习）。
   *
   * 依赖里带 `fragments`（数组）而不是用 ref 镜像：本函数的引用会**每次渲染
   * 重新发布**到 `checkAnswerRef`，所以闭包永远是最新的，没有 `checkAnswer`
   * 那种「首渲染绑定后再也更新不了」的问题。
   */
  const checkFragmentAnswer = useCallback(() => {
    // 只可能在分段态下被调用（`checkAnswerRef` 的发布处已按 inFragmentPractice 择一），
    // 这里只是给 TS 把 `fragments` 收窄成非 null。
    if (!fragments || submittingRef.current) return
    submittingRef.current = true
    try {
      const list = slotsRef.current
      let allCorrect = true
      let firstWrongIndex = -1
      const nextSlots = list.map((slot, i) => {
        if (slot.readonly) return { ...slot, wasIncorrect: false }
        const userValue = normalizeQuotes(
          (inputsRef.current[i]?.value ?? slot.value).trim().toLowerCase(),
        )
        const ok = userValue === normalizeQuotes(slot.expected.toLowerCase())
        if (!ok) {
          allCorrect = false
          if (firstWrongIndex < 0) firstWrongIndex = i
        }
        return { ...slot, value: userValue, wasIncorrect: !ok }
      })
      setSlots(nextSlots)

      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()

      if (allCorrect) {
        sfxChime()
        triggerSuccessEffects()
        fragmentMistakesRef.current = 0
 // 延迟 800ms 再进下一段：给用户看「全绿」的那一下
        window.setTimeout(() => {
          setShowHint(false)
          setFragmentResult("")
          if (fragmentPhase === "single") {
            if (fragmentIndex < fragments.length - 1) {
              setFragmentPos({ sid: fragmentSid, index: fragmentIndex + 1, phase: "single" })
            } else if (mergedGroups !== null) {
              // 单段全过 → 相邻 3 段合并档（更接近整句语流的过渡阶梯）
              setFragmentPos({ sid: fragmentSid, index: 0, phase: "merged" })
            } else {
              startFullSentencePractice()
            }
          } else if (mergedGroups !== null && fragmentIndex < mergedGroups.length - 1) {
            setFragmentPos({ sid: fragmentSid, index: fragmentIndex + 1, phase: "merged" })
          } else {
            startFullSentencePractice()
          }
        }, 800)
      } else {
        sfxError()
        fragmentMistakesRef.current += 1
        setFragmentResult("error")
        if (firstWrongIndex >= 0) {
          const el = inputsRef.current[firstWrongIndex]
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
        }
        // 连错到用户设定的阈值 → 弹出答案覆盖层（与整句同一阈值，但计数独立）
        const threshold = revealRef.current
        if (threshold > 0 && fragmentMistakesRef.current >= threshold) {
          setShowHint(true)
        }
      }
    } finally {
      submittingRef.current = false
    }
  }, [fragmentIndex, fragments, fragmentPhase, fragmentSid, mergedGroups, startFullSentencePractice, triggerSuccessEffects])

  // 每次渲染写下最新引用；`handleKeyDown` 只会读到首渲染绑定的那个本函数，
  // 所以必须走这条路把「当前闭包」递过去。
  //
  // 这里发布的是**当前该用的判题函数** —— 分段练习与整句练习各一个
 // （也是按 `isInFragmentPractice\`
  // 分叉）。合并到一个 ref 里，回车路径就不需要第二个 ref 了。
  checkAnswerRef.current = inFragmentPractice ? checkFragmentAnswer : checkAnswer

  /** 答对后进回顾屏：朗读原音 N 次，之后视「自动下一句」决定是否推进。 */
  const playReviewAudio = useCallback(async () => {
    const text = sentence?.english
    if (!text) return
    const epoch = ++reviewEpochRef.current
    const times = Math.max(1, successPlayRef.current)
    for (let i = 0; i < times; i++) {
      if (epoch !== reviewEpochRef.current) return
      if (i > 0) await new Promise((r) => window.setTimeout(r, 1000))
      if (epoch !== reviewEpochRef.current) return
      const started = Date.now()
 // 这层循环自己负责「答对后播几次」（`successPlayCount`，这一层
 // 自己计数），所以每次只让它念 1 遍 —— 这里显式传
      // `overrideCount = 1`。传 `loopCount` 会让两个
      // 计数相乘，是错的。
      await globalSpeak(text, { count: 1 })
      // 每次播放至少停留 1.5s，防 TTS 静默失败时瞬间跳走
      const elapsed = Date.now() - started
      if (elapsed < 1500) await new Promise((r) => window.setTimeout(r, 1500 - elapsed))
    }
    if (epoch !== reviewEpochRef.current) return
    await new Promise((r) => window.setTimeout(r, 2000))
    if (epoch !== reviewEpochRef.current) return
    if (!autoNextRef.current) return
    if (completedRef.current.size >= sentencesRef.current.length) {
      setStatus("complete")
      return
    }
    advance()
    // advance 定义在下方
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence?.english])

  /**
 * 播放单个单词的发音。
   *
 * 原设计优先用字幕时间轴从整句音频里截出那个词的片段，字幕数据不可用时
   * 兜底走独立单词 TTS。我们没有字幕接口，所以**始终**走兜底路径 ——
 * 与无字幕场景的原行为语义一致。
   *
   * `.playing` 类的生命周期照抄：开始时加、**播完**摘掉。注意不是 `globalSpeak`
   * 返回就摘 —— 它回答的是「出声了没有」，一开始播就 resolve，用它收尾会让
   * 脉冲动画一闪而过（实测 `finally` 里的 setState 与点击落在同一个事件循环里，
 * `playing` 从未被观察到）。原实现是 `await playTTS(...)`，而 `playTTS` 内部
   * `await playSingleAudio` 一直等到 `ended` 才返回。
   *
 * 重复点同一个按钮时原实现直接 return（`if (btn.classList.contains('playing')) return`），
   * 这里用同一个下标挡住。
   */
  const handleWordSpeak = useCallback(async (index: number, word: string) => {
    if (speakingWordIndex === index) return
    const epoch = ++wordSpeakEpochRef.current
    setSpeakingWordIndex(index)
    try {
      const played = await globalSpeak(word)
      // 自动播放被拦时根本不会响，等下去只会让按钮一直亮着。
      if (played) await waitForSpeechEnd()
    } finally {
      // 期间用户可能已经点了别的单词 —— 那次的 finally 负责摘，这次别抢。
      if (epoch === wordSpeakEpochRef.current) setSpeakingWordIndex(null)
    }
  }, [speakingWordIndex])

  const advance = useCallback(() => {
    const idx = currentIndexRef.current
    if (idx >= sentencesRef.current.length - 1) {
      setStatus("complete")
      return
    }
    reviewEpochRef.current += 1
    stopSpeaking()
    setCurrentIndex(idx + 1)
    setStatus("input")
  }, [])

  /**
   * 学习模式的「下一句 / 完成」。
   *
 * 沿用原 `nextSentenceAfterPaint()` 的非复习态路径：
   * 配额检查之后**第一件事**就是
   *   `if (completedCount >= totalSentenceCount && totalSentenceCount > 0) { showCompletionMessage(); return; }`
   * 这条早退在学习模式里特别容易命中 —— 因为学习模式「渲染即完成」，只要
   * 十句都翻过一遍，`completedCount` 就等于总数了。此后无论用户是
   * 用 `prev` 退回去再点下一句，还是停在原地再点一次，都直接进完成页，
   * 而不是继续逐句前进。听写/拼图不会命中这条（它们靠答对才积满）。
   *
   * 所以本函数 = `advance()` 前面多这一道判断。两道都通向完成页：
 * · 全部完成 → 完成页（这条早退）
   *   · 已是末句 → 完成页（`advance()` 自身）
   * 其余情况与 `advance()` 完全一致：取消朗读、进下一句、回到 input 态。
   */
  const handleLearningAdvance = useCallback(() => {
    const total = sentencesRef.current.length
    if (completedRef.current.size >= total && total > 0) {
      setStatus("complete")
      return
    }
    advance()
  }, [advance])

  const goPrev = useCallback(() => {
    const idx = currentIndexRef.current
    if (idx <= 0) return
    reviewEpochRef.current += 1
    stopSpeaking()
    setCurrentIndex(idx - 1)
    setStatus("input")
  }, [])

  // ── 口语模式：评分回调与切句 ────────────────────────────────────────────────
  //
 // 原逻辑把这两件事都放在 `markCurrentSentenceComplete()`
  // 与 `nextSentence()` 里。
  //
  // 阈值分工照抄：**评分 ≥ 70 才记完成**（
  // `if (roundedScore >= 70) markCurrentSentenceComplete()`），而 ≥ 80 额外
  // 触发成功音效（`triggerSuccessEffects()` +
  // `playSuccessSound()`）。所以 70–79 之间是「记了进度但没庆祝」——
  // 这不是笔误。
  //
 // `completed` 这个 Set<number> 就是原 `completedIndexesSet` 与
 // `completedSentences` 的合并物：两个集合原逻辑里恒同增同减（见
  // `markCurrentSentenceComplete` 一次加两处），本仓的听写模式也一直只用下标
  // 这一套，没有理由为口语再拆一份按 id 的。
  const markSpeakingComplete = useCallback(() => {
    const idx = currentIndexRef.current
    const s = sentencesRef.current[idx]
    const parentId = baseSentenceId(s?.id ?? "")
    /**
     * 副作用必须在 updater **外面**：网络请求写进 `setCompleted(prev => …)`
     * 会被 React 开发模式双调用（见 `reportedCompleteRef` 的注释）。这里先用
     * ref 同步判重，再发请求，最后才动状态。
     *
     * 键用句子 id（拿不到 id 时退回 `idx`），不用下标 —— 换课节时下标会重叠。
     */
    const key = s?.id ?? `idx:${idx}`
    if (reportedCompleteRef.current.has(key)) return
    reportedCompleteRef.current.add(key)

    // 纯函数地算出「加了这一句之后」的完成集合，供状态更新与上报共用。
    const next = new Set(completedRef.current).add(idx)
    setCompleted((prev) => (prev.has(idx) ? prev : new Set(prev).add(idx)))

 // 记完成时同时上报进度（`recordProgressV2(true,'', [])`）。
    // 分数 0 只是占位 —— `/api/practice/sessions` 的入参本来就只有
    // 下标/总数/用时，没有分数位。
    void fetch("/api/practice/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId,
        courseId,
        mode,
        currentIndex: idx + 1,
        sentenceCount: sentencesRef.current.length,
        mistakeCount: 0,
        elapsedSeconds: timerRef.current,
        state: next.size >= sentencesRef.current.length && sentencesRef.current.length > 0 ? "completed" : "active",
      }),
    }).catch((e) => { console.error(e) })
    if (parentId) {
      // `mistakes: 0` —— 口语模式没有「敲错」的概念，扣分走评分而不是错误计数。
      void fetch("/api/practice/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentenceId: parentId, mistakes: 0, userInput: null }),
      }).catch((e) => { console.error(e) })
      void fetch("/api/coins/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "sentence",
          refId: parentId,
          streak: 0,
          perfect: true,
          durationSeconds: Math.max(1, Math.round((Date.now() - sentenceStartRef.current) / 1000)),
        }),
      }).catch((e) => { console.error(e) })
    }
  }, [courseId, lessonId, mode])

  const handleSpeakingScore = useCallback(
    (score: number) => {
      if (score >= 80) {
 // 评测 ≥80 分时调 `window.triggerSuccessEffects()`
        // + `playSuccessSound()`：烟花（`createCanvasConfettiEffect`）与音效
        // 是**两个各自独立**的判断，只不过在这里阈值恰好相同。
        // 「答对烟花效果」（`confetti_effect`）这个开关只 gate 烟花，
        // 不 gate 音效 —— `playChime` 不读这个键（`src/lib/sfx.ts` 零 import），
        // 音效与否由上面的 `score >= 80` 单独决定。
        triggerSuccessEffects()
        sfxChime()
      }
      if (score >= 70) markSpeakingComplete()
    },
    [markSpeakingComplete, triggerSuccessEffects],
  )

  /**
   * 口语模式的「下一句 / 完成」。
   *
 * 与听写模式的 `advance()` 有三处**刻意**的不同，全部沿用原
   * `nextSentenceAfterPaint` 的行为：
   *
 * 1. **先记完成再切。** 原版 `shouldMarkComplete = !completedIndexesSet.has(idx)`
   *      之后无条件 `commitSentenceSwitch` 前调用 `markCurrentSentenceComplete()`。
   *      即「点下一句」本身就算完成 —— 用户读完但不满意、直接跳过，也记进度。
   *   2. **全部完成 → 完成页。** 判据是 `completedSentences.size >= total`。
   *   3. **末句但还有未完成的 → 跳到第一个未完成句**，而不是去完成页
   *      （`getNextUncompletedIndex`）。听写模式没有这条：
   *      它靠答对来推进，不会「走到末尾还有漏的」。
   */
  const handleSpeakingAdvance = useCallback(() => {
    const idx = currentIndexRef.current
    const total = sentencesRef.current.length
    markSpeakingComplete()

 // 原逻辑在切句前有 5 秒冷却（`SENTENCE_SWITCH_COOLDOWN`），
    // 但那条只拦「用户主动切句」，`nextSentence` 内部推进不受限。我们的
    // Enter/点按都是主动切句，用 250ms 的物理去抖就够 —— 5 秒的冷却在口语
    // 模式下会让人以为按钮坏了（每句都要盯着读一遍再等 5 秒）。
    const done = new Set(completedRef.current).add(idx)
    if (done.size >= total && total > 0) {
      setStatus("complete")
      return
    }
    if (idx < total - 1) {
      reviewEpochRef.current += 1
      stopSpeaking()
      setCurrentIndex(idx + 1)
      setStatus("input")
      return
    }
 // 末句：跳回第一个未完成句。
    for (let i = 0; i < total; i++) {
      if (!done.has(i)) {
        reviewEpochRef.current += 1
        stopSpeaking()
        setCurrentIndex(i)
        setStatus("input")
        toast.info("已跳转到未完成的句子", { duration: 2000 })
        return
      }
    }
    setStatus("complete")
  }, [markSpeakingComplete])

  // ── 学习模式：进入即记完成 ──────────────────────────────────────────────────
  //
 // 原 `loadCurrentSentence()` 的学习模式分支在
  // 句子**渲染完之后**立刻把它记为已完成：
  //
  //   completedSentences.add(currentSentence.sentenceId)
  //   completedIndexesSet.add(currentSentenceIndex)
  //   updateProgress()
  //   recordProgressV2(true, '', [])
  //
  // 用户什么都没做也算完成 —— 学习模式的语义就是「读懂即完成」。所以它与
  // 听写/拼图的「答对才记」、口语的「评分 ≥70 才记」都不同，是三套门槛里
  // 最松的一套。
  //
  // 三处与 `markSpeakingComplete` 的**刻意**差异：
 // 1. 原版这里**只**调 `recordProgressV2`。本仓 `recordProgressV2` 对应
  //      `POST /api/practice/sessions`，所以这里也只发这一个请求 ——
  //      不发 `/api/practice/record`（学习模式没有错题）也不发
  //      `/api/coins/earn`（没有「答对」这个事件可奖励）。
 // 2. **不放成功音效**。原版这段没有 `playSuccessSound()` ——
  //      每翻一句就叮一声会很吵。
 // 3. **不自动跳转**。原注释口径很明确：「不再自动跳转，等待用户点击
  //      下一句按钮」，全部完成时也只是 `updateBottomToolbar(..., 'learning')`
  //      把底栏的箭头换成 ✓。所以这里只更新完成集合，不碰 `currentIndex`。
  //
  // 与 `markSpeakingComplete` 一样，副作用**绝不能**放进 `setCompleted` 的
  // updater —— React 开发模式会双调用 reducer，同一句会发出两条写请求
  // （实测见 `reportedCompleteRef` 的注释）。这里用 ref 同步判重。
  const markLearningComplete = useCallback(() => {
    const idx = currentIndexRef.current
    const s = sentencesRef.current[idx]
    const parentId = baseSentenceId(s?.id ?? "")
    const key = s?.id ?? `idx:${idx}`
    if (reportedCompleteRef.current.has(key)) return
    reportedCompleteRef.current.add(key)

    const next = new Set(completedRef.current).add(idx)
    setCompleted((prev) => (prev.has(idx) ? prev : new Set(prev).add(idx)))

    if (parentId) {
      void fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId,
          courseId,
          mode,
          currentIndex: idx + 1,
          sentenceCount: sentencesRef.current.length,
          mistakeCount: 0,
          elapsedSeconds: timerRef.current,
          state: next.size >= sentencesRef.current.length && sentencesRef.current.length > 0 ? "completed" : "active",
        }),
      }).catch((e) => { console.error(e) })
    }
  }, [courseId, lessonId, mode])

  /**
   * 学习模式：进入某句后自动记为已完成。
   *
 * 依赖 `sentence?.id`：每换一句跑一次，与「渲染完就记」的时机一致。
   * 走 `Promise.resolve().then(...)` 而不是同步调用，是为了不触发
   * `react-hooks/set-state-in-effect` —— 该规则会沿调用链追踪到
   * `setCompleted`，同步写状态会被判为「effect 里级联渲染」。微任务推迟一档
   * 既让规则满意，也仍然发生在这次渲染提交之后；`alive` 兜住快速切句时
   * 卸载后的迟到回调。
   */
  useEffect(() => {
    if (mode !== "learning") return
    if (!sentence?.id) return
    let alive = true
    Promise.resolve().then(() => {
      if (!alive) return
      markLearningComplete()
    })
    return () => { alive = false }
  }, [mode, sentence?.id, markLearningComplete])

  // ── 拼图（拼拼乐）模式：判题回调 ──────────────────────────────────────────────
  //
 // 原版的拼图**没有自己的判题函数**：`checkAnswer()`
  // 开头按 `practiceMode` 分了两条读答案的路径（拼图读
  // `selectedWords`，听写读输入框），但**从 `allCorrect` 往后完全共用**
  // —— 成功的上报/进复习屏、失败的错误音/错误计数/结果条都是同一段代码。
  //
  // 所以这里也不另起一条判题链：拼图组件把「拼对了没 + 拼出的句子」交回，
  // 由本回调走与听写相同的两条路径。两处**刻意**的差异：
  //
 // 1. **不写错题本，但照常统计准确率。** 原版写错题本的那次
  //      `recordProgressV2(false, …)` 外层条件是 `practiceMode === 'dictation'`
  //      时拼图落进下面的 `else if`，只把下标塞进
  //      `sentencesWithMistakes` 供准确率用。本仓对应 `setMistaken` ——
  //      已核过它只被 `accuracy` 与 `trackPracticeComplete`
  //      读取，**没有任何 JSX 消费**，所以加上它只影响准确率、不会长出
  //      错题本 UI；写错题本的动作是 `/api/practice/record`，
  //      那个请求这里一个都不发。
 // 2. **`sentenceMistakesRef.current += 1` 照加。** 原版的
  //      `currentSentenceMistakeCount++` 在拼图分支同样执行
  //      —— 那是「本句错了几次」的计数器，与写不写错题本是两回事。
 // 3. **答错不聚焦输入框。** 原版 `firstIncorrectInput` 只在听写分支
  //      被赋值（拼图没有输入框），拼图自然是 no-op。
  const handlePuzzleResult = useCallback(
    (correct: boolean, userInput: string) => {
 // 每次提交都先清状态：`checkAnswer()` 开头
      // `resultMessage.classList.remove('show','success','error')`
      // 。听写分支已做了同一件事，拼图也必须做 ——
      // 否则「先答错、再改对」时 error 类会残留，并一直带到下一句，
 // 因为原版换句时会重建 `#resultMessage`（新元素只有基类），
      // 而 React 复用的是同一个节点、类名来自 state。
      setResultMessage("")
      if (correct) {
        sfxChime()
        triggerSuccessEffects()
        const idx = currentIndexRef.current
        const total = sentencesRef.current.length
        setCompleted((prev) => new Set(prev).add(idx))
        const parentId = baseSentenceId(sentence?.id ?? "")
 // 成功分支上报进度（`recordProgressV2(true,'', [])`）并
        // `completedIndexesSet.add(currentSentenceIndex)`。
        if (parentId) {
          void fetch("/api/practice/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lessonId,
              courseId,
              mode,
              currentIndex: idx + 1,
              sentenceCount: total,
              mistakeCount: 0,
              elapsedSeconds: timerRef.current,
              state: idx >= total - 1 ? "completed" : "active",
            }),
          }).catch((e) => { console.error(e) })
        }
 // 与听写同路径：立即进复习屏（原版 
        // `if (practiceMode === 'dictation' || practiceMode === 'puzzle')
        //  { hideSentenceHint(); await showAnswerReview() }`）。
        setStatus("review")
        void playReviewAudio()
      } else {
        sfxError()
        sentenceMistakesRef.current += 1
 // 拼图答错只做三件事：错误音、本句错误计数、结果条置 error。
        // `.shake-animation` 由拼图组件自己加在 `#puzzleAnswerArea` 上
        // （那是它自己的 DOM），这里不重复。
        //
 // 准确率统计：原版把出错句塞进 `sentencesWithMistakes`
        // ，那是**独立于错题本**的一个集合，只喂准确率。
        // 本仓对应 `setMistaken` —— 已核过：它只被 `accuracy`、
        // `trackPracticeComplete` 读取，**没有任何 JSX 消费它**，
 // 所以它同样只影响准确率，语义与原版 `sentencesWithMistakes`
        // 恰好对齐。
        //
 // 关键区别在**不**做的事：原版那次 `recordProgressV2(false, …)`
        // 由 `practiceMode === 'dictation'` 把拼图挡在外面，
        // 拼图只落到 `else if` 分支统计准确率、**不写错题本**。本仓写错题本
        // 的动作是 `/api/practice/record`，所以这里一个写请求
        // 都不发 —— 只统计，不记录。
        setMistaken((prev) => new Set(prev).add(currentIndexRef.current))
        setResultMessage("error")
 // `userInput` 是用户拼出的句子。原版 `recordProgressV2` 会带上
        // `userInputs.join(' ')`，但既然拼图根本不走那条路径，这个值没有
        // 去处；留参数是为了让回调签名与听写一致，将来若要给拼图记错题
        // 不必再改组件协议。
        void userInput
      }
    },
    [courseId, lessonId, mode, sentence?.id, triggerSuccessEffects],
  )

  // ── 收藏当前句（底栏星标，⌘/Ctrl+U） ────────────────────────────────────────
  //
  // 每次切句都要重查：收藏状态是**按句**的，不能沿用上一句的星标。
  // 用 epoch 守卫避免快速切句时旧请求回来覆盖新状态（与 reviewEpoch 同一思路）。
  const favoriteEpochRef = useRef(0)
  useEffect(() => {
    const sid = sentence?.id
    if (!sid) { setFavorited(false); return }
    const epoch = ++favoriteEpochRef.current
    let alive = true
    fetch(`/api/sentences/favorites?sentenceId=${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || epoch !== favoriteEpochRef.current) return
        setFavorited(!!j?.favorited)
      })
      .catch(() => { /* 查询失败时保持未收藏，不打断练习 */ })
    return () => { alive = false }
  }, [sentence?.id])

  const toggleFavorite = useCallback(async () => {
    const sid = sentence?.id
    if (!sid || favoriteBusy) return
    setFavoriteBusy(true)
 // 乐观切换：请求期间只锁按钮、不改图标，所以这里也等响应落地再改，
    // 保证「看到的星标 == 服务端的真实状态」。
    try {
      const r = await fetch(
        favorited
          ? `/api/sentences/favorites?sentenceId=${encodeURIComponent(sid)}`
          : "/api/sentences/favorites",
        favorited
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sentenceId: sid,
                courseId,
                lessonId,
                sentenceText: sentence?.english ?? null,
              }),
            },
      )
      const data = await r.json().catch(() => null)
      if (!r.ok) {
 // 按 favorited 状态分「取消收藏失败」「收藏失败」两条文案
        // （服务端给了 message 就优先用它），但 catch 里是统一的「操作失败，请稍后重试」。
        toast.error(data?.error ?? (favorited ? "取消收藏失败" : "收藏失败"))
        return
      }
      setFavorited(!favorited)
      toast.success(favorited ? "已取消收藏" : "收藏成功")
    } catch {
      toast.error("操作失败，请稍后重试")
    } finally {
      setFavoriteBusy(false)
    }
  }, [sentence?.id, sentence?.english, favorited, favoriteBusy, courseId, lessonId])

  /**
 * 快捷键文案。默认 play=⌘/Ctrl+P、answer=⌘/Ctrl+A、favorite=⌘/Ctrl+U
   * （DEFAULT_SHORTCUTS 的出厂值），但这些是**用户可改**的，
   * 所以文案必须从 `shortcuts` 实时推导 —— 写死成常量就会出现
   * 「提示写着 ⌘+A、用户改成 ⌘+B 后按 ⌘+A 还有提示」的自相矛盾状态。
   */
  const shortcutText = useCallback(
    (id: ShortcutId) => shortcutKbdParts(id, shortcuts).join("+"),
    [shortcuts],
  )
  const answerShortcutKbd = shortcutText("answer")
  const playShortcutKbd = shortcutText("play")
 /** 单词发音按钮的 title 里要带快捷键。 */
  const wordSpeakShortcutKbd = shortcutText("wordSpeak")

  // ── 上报：整句完成 / 金币 / 分析 ─────────────────────────────────────────────
  useEffect(() => {
    if (status !== "review") return
    const parentId = baseSentenceId(sentence?.id ?? "")
    const s = sentencesRef.current[currentIndexRef.current]
    if (!s?.id) return
    void fetch("/api/practice/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sentenceId: parentId,
        mistakes: sentenceMistakesRef.current,
        userInput: slotsRef.current.map((x) => x.value).join(" ").trim() || null,
      }),
    }).catch((e) => { console.error(e) })
    void fetch("/api/coins/earn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sentence",
        refId: parentId,
        streak: 0,
        perfect: sentenceMistakesRef.current === 0,
        durationSeconds: Math.max(1, Math.round((Date.now() - sentenceStartRef.current) / 1000)),
      }),
    }).catch((e) => { console.error(e) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // ── 完成结算 ────────────────────────────────────────────────────────────────
  const accuracy = useMemo(() => {
    const total = sentences.length
    if (total === 0) return 100
    return Math.round(((total - mistaken.size) / total) * 100)
  }, [sentences.length, mistaken.size])

  const elapsedMinutes = Math.max(1, Math.round(timer / 60))

  useEffect(() => {
    if (status !== "complete") return
    stopSpeaking()
    if (!trackedCompleteRef.current) {
      trackedCompleteRef.current = true
      trackPracticeComplete(Math.max(100, sentences.length * 500 - mistaken.size * 30), sentences.length)
    }
    void fetch("/api/user/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, sentenceCount: sentences.length }),
    }).catch((e) => { console.error(e) })
    if (trial?.truncated) trackPaywallShown("trial_end")
  }, [status, courseId, sentences.length, mistaken.size, trial?.truncated])

  // 完成屏快捷键：Enter 下一课 / Space 返回课程
  useEffect(() => {
    if (status !== "complete") return
    const onKey = (e: KeyboardEvent) => {
      if (statusRef.current !== "complete") return
      if (e.key === "Enter" && nextLesson) { goNextLesson(); return }
      if (e.key === " ") { e.preventDefault(); goBack() }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, nextLesson])

  const goNextLesson = useCallback(() => {
    if (!nextLesson) return
    window.location.href = `/home/learn/${courseId}?lesson=${nextLesson.id}&mode=${mode}`
  }, [courseId, nextLesson, mode])

 // ── 全局快捷键 ─────────────
  //
  // 绑定值来自 `shortcuts`（用户可改，存 localStorage.practice_shortcuts），
  // 默认 play=⌘/Ctrl+P、answer=⌘/Ctrl+A、prevSent=⌘/Ctrl+←、
  // nextSent=⌘/Ctrl+→、favorite=⌘/Ctrl+U。
  //
  // 匹配一律走 `matchShortcut`，它要求**修饰键完全一致**（绑了 ctrl 就必须按
  // ctrl/meta、没绑就一个都不许按；shift/alt 同理）。早先这里写死
  // `if (!mod || e.altKey || e.shiftKey) return`，等于把用户的改键完全忽略，
  // 所以改成逐项比对配置。
  //
 // 「answer」原版只在非学习模式下切换提示浮层（
  // `if (practiceMode !== 'learning') toggleSentenceHint()`）—— 学习模式恒为
  // no-op；其余模式恒可切换。
  //
  // 学习模式还要额外接管**裸回车**：那条分支要求
  // `practiceMode === 'learning'` 且无任何修饰键、焦点不在输入框里，按下即
  // `nextSentence('enter-learning')`。学习模式没有输入框，所以这里不必像听写
  // 那样判断焦点 —— 但门卫仍照抄四个修饰键的排除，否则 ⌘+Enter 之类的组合会被
  // 抢先吞掉（它本该落到下面 `nextSent` 之类的绑定上）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (statusRef.current === "complete") return
      // 快捷键弹窗正在录制按键时，全局绑定必须让路 —— 否则用户按 ⌘+A 想
      // 重绑「答案」，却同时把答案提示切了一次。录制 effect 用的是捕获阶段
 // 监听 + stopPropagation，本监听挂在冒泡阶段，理论上
      // 已经收不到；这里再挡一道，避免哪天监听阶段被改动时静默串味。
      if (recordingId !== null) return

      if (mode === "learning") {
        if (
          e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
        ) {
          e.preventDefault()
          reviewEpochRef.current += 1
          handleLearningAdvance()
          return
        }
        // 学习模式下除回车外的其余绑定（播放/收藏/上一句/下一句）照常生效，
        // 唯独「答案」是 no-op —— 学习模式本来就整句摊开着，没有可揭示的东西。
      }

      // 听写/拼图的复习屏：裸 Enter 推进下一句。答对后输入屏已卸载，输入格的
      // Enter 提交处理器不在了，而「下一句预览」上明确画着 ↵、底栏下一句按钮
      // 干的也是同一件事 —— 此前裸 Enter 没人接，是个死键。焦点在按钮等可交互
      // 元素上时必须让位原生激活：点过「下一句」后焦点会留在按钮上，原生 click
      // 与这里的推进都跑就会一次跳两句。
      if (
        statusRef.current === "review" &&
        e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      ) {
        if (e.repeat) return
        const target = e.target as HTMLElement | null
        if (target?.closest("button, a, input, select, textarea, [contenteditable], [role='button']")) return
        e.preventDefault()
        reviewEpochRef.current += 1
        advance()
        return
      }

      if (matchShortcut(e, "answer", shortcuts)) {
        e.preventDefault()
        if (mode === "learning") return
        setShowHint((v) => !v)
        return
      }
      if (matchShortcut(e, "play", shortcuts)) {
        e.preventDefault()
        const s = sentencesRef.current[currentIndexRef.current]
 // 手动播放：`manualCount = ttsPlaybackCount === 0 ? 1 : null`
        // —— 手动档也要响一次，其余档沿用设定的次数。
        if (s?.english) void globalSpeak(s.english, { count: manualPlayCount() })
        return
      }
      if (matchShortcut(e, "favorite", shortcuts)) {
        e.preventDefault()
 // 长按重复与请求中重复都直接吞掉，避免连点产生一堆请求
        if (e.repeat || favoriteBusyRef.current) return
        void toggleFavorite()
        return
      }
      if (matchShortcut(e, "prevSent", shortcuts)) {
        e.preventDefault()
        goPrev()
        return
      }
      if (matchShortcut(e, "nextSent", shortcuts)) {
        e.preventDefault()
        reviewEpochRef.current += 1
        advance()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [advance, goPrev, toggleFavorite, shortcuts, recordingId, mode, handleLearningAdvance])

  /**
   * 快捷键弹窗里的「录制新按键」。
   *
 * 原版把捕获处理器挂在 `document` 的**捕获阶段**并
   * `stopImmediatePropagation`，
   * 让这一下击键既不改键也被全局快捷键吞掉。这里用 `recordingId` 驱动 +
   * 全局 effect 里提前 return 达到同样效果，但仍然用 capture:true ——
   * 否则输入框的 keydown 会先处理掉。
   *
   * 特殊处理「只按修饰键就松手」：keydown 时不认，等 keyup 且期间没有别的
 * 键按下，才把那个修饰键本身当成主键。
   */
  useEffect(() => {
    if (recordingId === null) return
    const actionId = recordingId

    const stopRecording = () => {
      setRecordingId(null)
      modifiersPressedRef.current = 0
      setRecordingWarning(null)
    }

    const commit = (combo: { key: string; ctrl: boolean; shift: boolean; alt: boolean }) => {
      const rejection = validateCombo(actionId, combo, shortcuts)
      if (rejection) {
        setRecordingWarning(rejection.inline)
        toast.warning(rejection.message, { duration: 3500 })
        return
      }
      const next = { ...shortcuts, [actionId]: { ...shortcuts[actionId], ...combo } }
      setShortcuts(next)
      saveShortcuts(next)
      stopRecording()
      toast.info("快捷键已更新", { duration: 2000 })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // ESC 取消录制（行内恢复成原样，弹窗不关）
        e.preventDefault()
        e.stopPropagation()
        stopRecording()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) {
        modifiersPressedRef.current += 1
        return
      }
      commit({
        key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
      })
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!["Control", "Meta", "Shift", "Alt"].includes(e.key)) return
      // 有多个修饰键同时按下时，松开第一个不算「单按修饰键」
      if (modifiersPressedRef.current === 1) {
        commit({ key: e.key, ctrl: false, shift: false, alt: false })
      }
      modifiersPressedRef.current = 0
    }

    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("keyup", onKeyUp, true)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("keyup", onKeyUp, true)
    }
  }, [shortcuts, recordingId])

 // ESC：优先关闭已打开的模态框（原版给两个
  // 模态框各绑了一个 Escape 监听），其次关闭答案提示浮层
 // （仅在浮层已显示时拦截）。
  //
  // 用 state 值而不是 setState 的 updater 来判断「有没有东西要关」：updater
  // 里的副作用在 React 里不保证同步执行，拿它设标志位再决定 preventDefault 会失效。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // 模式切换确认弹窗的 ESC 由 `ModeSwitcher` 自己收口（它会
      // stopImmediatePropagation 掉，所以到不了这里）；这里只管本页的浮层。
      // 关模态框时同时把草稿恢复成已保存值 —— 等价于 closePersonalization，
      // 就地写开是为了让这个 effect 不必依赖后面才声明的 useCallback。
      if (personalizationOpen) {
        setPersonalizationDraft(loadDictationInputSettings())
        setPersonalizationOpen(false)
        e.preventDefault()
        return
      }
      if (moreSettingsOpen) { setMoreSettingsOpen(false); setRevealMenuOpen(false); e.preventDefault(); return }
      if (revealMenuOpen) { setRevealMenuOpen(false); e.preventDefault(); return }
 // 快捷键弹窗最后关（它是最上层的浮层）。原版 closeShortcutModal 还会
      // 顺手 cancelShortcutRecording，所以这里一并清掉录制态。
      if (shortcutModalOpen) {
        setShortcutModalOpen(false)
        setRecordingId(null)
        setRecordingWarning(null)
        e.preventDefault()
        return
      }
      if (showHint) { setShowHint(false); e.preventDefault() }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [personalizationOpen, moreSettingsOpen, revealMenuOpen, showHint, shortcutModalOpen])

  /**
 * 点击面板外收起卡片下拉（全局 click 收口）：
   * 目标不在 `.info-card` / `.card-dropdown` / `.personalization-modal-content`
   * 之内就 `closeAllDropdowns()`。设置面板自身由 `.settings-wrapper` 的按钮
   * 切换，这里不碰，免得点卡片就把面板关了。
   */
  useEffect(() => {
    if (!openDropdown) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest(".info-card") || t.closest(".card-dropdown")) return
      setOpenDropdown(null)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [openDropdown])

  /**
   * 声音频谱条跟随真实播放状态起停。
   *
   * 只在 `speaking` 为真时才接线：`getCurrentAudioElement()` 拿到的是
   * `useTTSSettings` 里正在播的那个 `<audio>`，而它正是在 `speaking` 变真
   * 的那一刻才被赋值的（见该文件 `if (currentAudio === audio) setSpeaking(true)`）。
   * 关掉「声音频谱动画」开关时既不起 rAF，也把已有的停掉。
   */
  useEffect(() => {
    // 系统语音降级路径没有 <audio> 元素（走 speechSynthesis），拿不到
    // AnalyserNode 可接的源 —— 不启动 rAF，省掉一圈空转。
    const el = getCurrentAudioElement()
    if (!speaking || !audioVisualizer || !el) {
      stopVisualizer()
      return
    }
    startVisualizer(el)
  }, [speaking, audioVisualizer])

  // 离开练习页时收掉 rAF 与 AudioContext，避免切课后旧页面继续跑动画。
  useEffect(() => () => stopVisualizer(), [])

  /**
   * 「已加入错题本」通知的两段式时间线：
   *   挂载 → `setTimeout(add 'show', 10)` 滑入
   *        → `setTimeout(remove 'show', 2000)` 滑出
   *        → `setTimeout(remove node, 300)` 卸载
 * 用 `mistakeNoticeEpoch` 作依赖：原版每次都 `createElement` 一个新节点，
   * 连续两次错误会叠两条；我们单实例，靠自增 epoch 重启时间线（旧通知先收、
   * 再重新滑入），视觉节奏一致，且每次触发前会先清掉上一条的定时器。
   */
  useEffect(() => {
    if (mistakeNoticeEpoch === 0) return
    const showTimer = window.setTimeout(() => setMistakeNoticeShow(true), 10)
    const hideTimer = window.setTimeout(() => setMistakeNoticeShow(false), 2000)
    const unmountTimer = window.setTimeout(() => setMistakeNoticeEpoch(0), 2300)
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
      window.clearTimeout(unmountTimer)
    }
  }, [mistakeNoticeEpoch])

  const goBack = useCallback(() => {
    window.location.href = courseId ? `/home/courses/${courseId}` : "/home"
  }, [courseId])

  const claimTrial = useCallback(async () => {
    try {
      const r = await fetch("/api/trial/claim", { method: "POST" })
      const data = await r.json().catch(() => null)
      if (r.ok) { trackTrialClaimed(TRIAL_DAYS); toast.success(`已领取 ${TRIAL_DAYS} 天体验会员`) }
      else toast.error(data?.error ?? "领取失败，请稍后再试")
    } catch { toast.error("网络异常，请稍后再试") }
  }, [])

  // ── 派生显示值 ──────────────────────────────────────────────────────────────
  const completedCount = status === "complete" ? sentences.length : completed.size
  const timerStr = `${String(Math.floor(timer / 60)).padStart(2, "0")}:${String(timer % 60).padStart(2, "0")}`

  const toggleChinese = useCallback(() => {
 // 先算出目标值再落库/提示：原版是 `showChineseGlobal = !showChineseGlobal`
    // 之后再 toast。不能把 toast 塞进 setState 的
    // updater —— updater 必须是纯函数，StrictMode 下会被调用两次，提示弹两遍。
    const next = !showChineseRef.current
    setShowChinese(next)
    saveShowChinese(lessonId, next)
    toast.info(next ? "已显示中文提示" : "已隐藏中文提示", { duration: 2000 })
  }, [lessonId])

  const toggleAutoNext = useCallback(() => {
    const next = !autoNextRef.current
    setAutoNext(next)
    saveAutoNext(next)
 // （设置卡点击口径，非弹窗开关）。注意听写模式的设置卡
    // 是**直接**切 state，不像弹窗里的开关那样先算 `enabled` 再取反。
    toast.info(
      next ? "已开启自动下一句" : "已关闭自动下一句，需手动点击进入下一句",
      { duration: 2000 },
    )
  }, [])

  /**
 * 打开个性化模态框：先把草稿恢复成已保存的设置（原版
   * `openPersonalizationModal` 里的 `dictationInputSettings = loadDictationInputSettings()`），
   * 这样上次取消掉的改动不会残留。
   */
  const openPersonalization = useCallback(() => {
    setPersonalizationDraft(loadDictationInputSettings())
    setPersonalizationOpen(true)
  }, [])

 /** 关闭并丢弃草稿 —— 关闭时同样会重新读一次 localStorage。 */
  const closePersonalization = useCallback(() => {
    setPersonalizationDraft(loadDictationInputSettings())
    setPersonalizationOpen(false)
  }, [])

  /**
 * 答对后播放次数在 **1–3** 之间循环（原版 
   * `successPlayCount = successPlayCount >= 3 ? 1 : successPlayCount + 1`），
   * 并给一条 info toast（`答对后将播放 N 次语音`）。
   * 上界用 `MAX_SUCCESS_PLAY`，避免与 `loadSuccessPlayCount()` 的夹取漂移。
   */
  const cycleSuccessPlay = useCallback(() => {
    setSuccessPlayCount((prev) => {
      const next = prev >= MAX_SUCCESS_PLAY ? 1 : prev + 1
      saveSuccessPlayCount(next)
      toast.info(`答对后将播放 ${next} 次语音`, { duration: 2000 })
      return next
    })
  }, [])

 /** 设置自动播放次数（顶栏手动播放指示按钮用）。 */
  const cycleLoopTo = useCallback((n: number) => {
    setLoopCount(n)
    saveLoopCount(n)
    toast.info(n === 0 ? "已设置为手动播放" : `已设置自动播放次数: ${n}次`, { duration: 2000 })
  }, [])

 /** 切换极简沉浸模式。 */
  const toggleImmersive = useCallback(() => {
    setImmersive((v) => {
      const next = !v
      saveImmersive(next)
      toast.info(next ? "已开启极简沉浸模式" : "已恢复标准界面模式", { duration: 2000 })
      return next
    })
  }, [])

  /**
 * 全屏切换。
 * 对 `document.documentElement` 调 requestFullscreen。
 * 优先 `requestFullscreen`、退化到 `webkitRequestFullscreen`，
   * 两者都没有才提示「当前浏览器不支持全屏模式」。
   */
  const toggleFullscreen = useCallback(async () => {
    const docEl = document.documentElement
    if (!document.fullscreenElement) {
      if (!docEl.requestFullscreen) {
        toast.warning("当前浏览器不支持全屏模式", { duration: 2000 })
        return
      }
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await docEl.requestFullscreen()
    } catch {
      toast.warning("切换全屏失败，请重试", { duration: 2000 })
    }
  }, [])

  // ── 渲染 ────────────────────────────────────────────────────────────────────
  if (loadState === "loading") {
    return <CenteredNotice title="正在加载课程内容…" />
  }
  if (loadState === "error") {
    return <CenteredNotice title="课程内容加载失败" hint="请返回课程页重试" onBack={goBack} />
  }
  if (sentences.length === 0) {
    return <CenteredNotice title="这节课还没有可练习的句子" hint="换一节课试试" onBack={goBack} />
  }

  return (
    <div
      className={[
        "practice-shell",
        showChinese ? "" : "hide-chinese",
        showPhonetics ? "" : "hide-phonetics",
        toolbarDensity === "compact" ? "toolbar-compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // 主题（深色/浅色三种变体）统一由 applyThemeStyle 写在这层元素上：
      // 抽取后的 CSS 选择器都是 `.practice-shell[data-theme="light"] …`，
 // 主题写在壳层元素上才能命中这些选择器。
      ref={(el) => {
        shellRef.current = el
        if (el) applyThemeStyle(el, themeStyle)
      }}
    >
      <div className="cyber-interface" ref={interfaceRef}>
        <header className="cyber-header">
          <div className="progress-bar-segmented">
            {sentences.map((s, i) => (
              <div
                key={s.id}
                className={`progress-segment${i < completedCount ? " active" : ""}`}
              />
            ))}
          </div>

          <div className="header-left">
            <button
              type="button"
              className="btn-abort"
              title="退出练习"
              onClick={goBack}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </button>
            <div className="header-course-info">
              <span className="course-name">{courseTitle || BRAND.nameZh}</span>
              <span className="course-sep">&gt;</span>
              <span className="unit-name" id="lessonName">{lessonTitle || "课节"}</span>
            </div>
          </div>

          <div className="header-right">
            {/*
              模式切换器已抽成共用组件（`ModeSwitcher`），非听写模式也用它，
              否则切到拼图/学习/口语之后就再也切不回来。
            */}
            <ModeSwitcher
              courseId={courseId}
              lessonId={lessonId}
              mode={mode}
              completedCount={completedCount}
            />

            <div className="header-divider" />

            <div className={`header-stats${paused ? " paused" : ""}`}>
              <div className="timer-display">
                <svg className="timer-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                <span id="timerValue" className="mono-text">{timerStr}</span>
              </div>
              <span className="counter mono-text">
                <span id="completedCount">{completedCount}</span>
                <span className="counter-separator">/</span>
                <span id="totalCount">{sentences.length}</span>
              </span>
            </div>

            <div className="header-divider" />

            <div className="header-controls">
              {/*
 顶栏的顺序是：手动播放指示 → 全屏 → 退出全屏 → 退出沉浸 →
 设置。这里此前自作主张放了一个「暂停」按钮 —— 但没有暂停
                按钮。暂停是练习的自动行为
                （失焦 / 页面隐藏 / 2 分钟无操作 → pausePractice），只把
                `.header-stats` 加 `.paused` 变红，不存在手动切换入口。
              */}
              <button
                type="button"
                id="manualPlayIndicator"
                className="header-icon-btn manual-play-indicator"
                title="自动播放已关闭，点击恢复"
                style={{ display: loopCount === 0 ? undefined : "none" }}
                onClick={() => cycleLoopTo(1)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4z" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              </button>
              <button
                type="button"
                id="headerFullscreenBtn"
                className="header-icon-btn"
                title="全屏切换"
                onClick={toggleFullscreen}
              >
                <svg className="fs-expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: fullscreen ? "none" : undefined }}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
                <svg className="fs-compress-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: fullscreen ? undefined : "none" }}><path d="M4 14h2a2 2 0 0 1 2 2v2" /><path d="M20 14h-2a2 2 0 0 0-2 2v2" /><path d="M4 10h2a2 2 0 0 0 2-2V6" /><path d="M20 10h-2a2 2 0 0 1-2-2V6" /></svg>
              </button>
              <button
                type="button"
                id="exitFullscreenBtn"
                className="btn-exit-immersive"
                title="退出全屏"
                style={{ display: fullscreen && immersive ? "inline-flex" : "none" }}
                onClick={(e) => { e.stopPropagation(); if (fullscreen) void toggleFullscreen() }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
              </button>
              <button
                type="button"
                id="exitImmersiveBtn"
                className="btn-exit-immersive"
                title="退出沉浸模式"
                style={{ display: immersive ? "inline-flex" : "none" }}
                onClick={(e) => { e.stopPropagation(); toggleImmersive() }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="M14 10l7-7" /><path d="M3 21l7-7" /></svg>
              </button>
              <div className="settings-wrapper">
                <div
                  className="settings-trigger-btn"
                  id="settingsTriggerBtn"
                  role="button"
                  tabIndex={0}
                  title="系统设置"
                  onClick={() => setSettingsOpen((v) => !v)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSettingsOpen((v) => !v) }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                </div>
                {/*
                  必须**常驻 DOM** + 用 `.show` 切换，不能条件渲染：移植过来的
 基础规则是 `display:none`，`.show` 才 `display:block`（同样靠
                  `#settingsPanel.classList` 增删
                  `show`）。条件渲染会让基础规则永远生效 —— 面板压根不显示。
                */}
                <div className={`settings-dropdown-panel${settingsOpen ? " show" : ""}`} id="settingsPanel">
                  <div className="info-cards-stack">
                      <InfoCard
                        id="themeCard"
                        title="切换亮/暗色模式"
                        label="显示风格"
                        value={THEME_STYLE_LABELS[themeStyle]}
                        valueId="themeDisplay"
                        status={themeStyle === "dark" ? "ok" : "purple"}
                        /**
 * applyThemeStyle 会按当前
                         * 风格换图标：浅色给太阳（8 条光芒）、深色给月亮。
                         * 之前这里写死 IconMoon，切到浅色后太阳路径永远不会出现
                         * —— `#themeIcon` 是 id 作用域的，探针能查到这个偏差。
                         */
                        icon={themeStyle === "dark" ? <IconMoon /> : <IconSun />}
                        iconId="themeIcon"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenDropdown((v) => (v === "theme" ? null : "theme"))
                        }}
                      />
                      <InfoCard
                        id="immersiveCard"
                        title="切换沉浸/极简练习模式"
                        label="界面模式"
                        /*
 toggleImmersiveMode 的行为：
                          `#immersiveDisplay` 文本在「沉浸 / 标准」间切换，
                          沉浸时加 `status-ok`，并 toast
                          `已开启极简沉浸模式` / `已恢复标准界面模式`。
                        */
                        value={immersive ? "沉浸" : "标准"}
                        valueId="immersiveDisplay"
                        status={immersive ? "ok" : "plain"}
                        icon={<IconExpand />}
                        iconId="immersiveIcon"
                        onClick={(e) => { e.stopPropagation(); toggleImmersive() }}
                      />
                      <InfoCard
                        id="voiceCard"
                        title="选择发音来源与音色（有道 TTS / 系统语音）"
                        label="发音偏好"
                        value={ttsVoiceShort}
                        valueId="voiceDisplayShort"
                        status={ttsSettings.source === "youdao" ? "ok" : "plain"}
                        icon={<IconMic />}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenDropdown((v) => (v === "voice" ? null : "voice"))
                        }}
                      />
                      <InfoCard
                        id="soundCard"
                        title="开启/关闭打字时的机械键盘音效"
                        label="键盘音效"
                        value={sfxEnabled ? "ON" : "OFF"}
                        valueId="kbdSoundDisplay"
                        status={sfxEnabled ? "ok" : "muted"}
                        icon={<IconSpeaker />}
                        onClick={() => setSfxEnabled(!sfxEnabled)}
                      />
                      <InfoCard
                        id="loopCard"
                        title="句子练习时英文语音自动播放的次数"
                        label="自动播放次数"
                        value={loopCount === 0 ? "手动" : `${loopCount}次`}
                        valueId="loopDisplayValue"
                        status="plain"
  /* 手动播放时值变红 */
                        valueColor={loopCount === 0 ? "#ef4444" : undefined}
                        icon={<IconLoop />}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenDropdown((v) => (v === "loop" ? null : "loop"))
                        }}
                      />
                      <InfoCard
                        id="successPlayCard"
                        title="答对后自动播放句子语音的次数（1-3次），点击切换"
                        label="答对播放次数"
                        value={`${successPlayCount}X`}
                        valueId="successPlayDisplay"
                        status="ok"
                        icon={<IconSpeaker />}
                        onClick={cycleSuccessPlay}
                      />
                      <InfoCard
                        id="fragmentCard"
                        title="开启后，先逐段练习句子成分，再按相邻 3 段一组合并练习，最后整句拼写（仅听写模式）"
                        label="分段练习"
                        value={fragmentMode ? "ON" : "OFF"}
                        valueId="fragmentModeDisplay"
                        status={fragmentMode ? "purple" : "off"}
                        icon={<IconFragment />}
                        onClick={() => {
 // 分句模式切换的
                          // 点击分支，逐条对应：
                          //   1. 非会员 → 强制 OFF + 写 '0' + 警告 toast
                          //   2. 翻转开关 + setFragmentMode(next) + 更新显示
                          //   3. 非听写模式到此为止（本组件就是听写模式，恒过）
                          //   4. 刚关掉且正在分段中 → toast + 回整句练习
                          //   5. 刚开启 → 按当前句有没有 chunks 分三种 toast
                          //
                          // 会员信号用 `trial === null`：服务端 sliceForTrial
                          // （src/lib/free-trial.ts:49）对会员返回 `trial: null`。
                          if (trial !== null) {
                            setFragmentMode(false)
                            saveFragmentMode(false)
                            toast.warning("免费用户暂不支持开启分段练习", { duration: 2500 })
                            return
                          }
                          const next = !fragmentMode
                          setFragmentMode(next)
                          saveFragmentMode(next)

                          if (!next) {
                            // 关闭时若正在分段中：回整句练习（片段进度作废）
                            if (inFragmentPractice) {
                              startFullSentencePractice()
                              toast.info("已关闭分段练习，进入整句练习", { duration: 2000 })
                            }
                            return
                          }

 // 刚开启：用当前句的真实 chunks 探一次路，
                          // 按探路结果分三种情况处理。
                          const available = fragments !== null && fragments.length >= 1
                          if (available) {
 // 重置本句的分段完成标记
                            // —— 允许本句重新进入分段练习
                            setFragmentDoneFor(null)
                            setFragmentPos(null)
                            setFragmentResult("")
                            toast.info("已开启分段练习", { duration: 2000 })
                          } else {
                            toast.info("当前句子无有效片段，分段练习将从下一句开始", { duration: 2500 })
                          }
                        }}
                      />
                      <InfoCard
                        id="fragmentImageCard"
                        title="开启/关闭分段练习时显示的单词配图（可节省流量）"
                        label="分段图片"
                        value={fragmentImage ? "ON" : "OFF"}
                        valueId="fragmentImageDisplay"
                        status={fragmentImage ? "ok" : "muted"}
                        icon={<IconImage />}
                        onClick={() => {
                          const next = !fragmentImage
                          setFragmentImage(next)
                          saveFragmentImage(next)
                          toast.info(
                            next ? "已开启分段练习配图" : "已关闭分段练习配图",
                            { duration: 2000 },
                          )
                        }}
                      />
                      <InfoCard
                        id="autoNextCard"
                        title="开启后，回答正确会自动进入下一句；关闭后需手动点击进入"
                        label="自动下一句"
                        value={autoNext ? "ON" : "OFF"}
                        valueId="autoNextDisplay"
                        status={autoNext ? "ok" : "off"}
                        icon={<IconChevronRight />}
                        onClick={toggleAutoNext}
                      />
                      <InfoCard
                        id="personalizationCard"
                        title="自定义听写输入框的字体和字号"
                        label="个性化"
                        value={`${DICTATION_FONT_LABELS[personalization.font]} · ${(personalization.size / 10).toFixed(1)}rem · ${personalization.inputStyle === "underline" ? "横线" : "方框"}`}
                        valueId="personalizationDisplay"
                        status="cyan"
                        icon={<IconSliders />}
                        onClick={(e) => { e.stopPropagation(); openPersonalization() }}
                      />
                      <InfoCard
                        id="shortcutCard"
                        title="自定义全局操作快捷键"
                        label="自定义快捷键"
                        value={isDefaultShortcuts(shortcuts) ? "默认" : "自定义"}
                        valueId="shortcutDisplay"
                        status="cyan"
                        icon={<IconKeyboard />}
                        onClick={() => {
 // 打开快捷键弹窗：
                          // 渲染列表 + 加 `.show`。这里是受控渲染，只置开。
                          setShortcutModalOpen(true)
                        }}
                      />
                      <InfoCard
                        id="moreSettingsCard"
                        title="更多个性化设置（自动弹答案次数、快捷键提示等）"
                        label="更多设置"
                        value="打开"
                        valueId="moreSettingsDisplay"
                        status="cyan"
                        icon={<IconMore />}
                        onClick={(e) => { e.stopPropagation(); setMoreSettingsOpen(true) }}
                      />
                    </div>

                    {/*
 卡片下拉。`.dropdowns-container` 铺满面板并
                      `pointer-events:none` 让点击穿透，真正可点的 `.card-dropdown`
                      再单独 `pointer-events:auto` —— 这两条都在移植的 CSS 里。
                    */}
                    <div className="dropdowns-container">
                      <div className={`card-dropdown${openDropdown === "theme" ? " active" : ""}`} id="themeCardDropdown">
                        {(
                          [
                            ["dark", "🌙 深色模式"],
                            ["light-standard", "☀️ 浅色标准"],
                            ["light-white", "⬜ 浅色纯白"],
                            ["light-grey", "🔲 浅色浅灰"],
                          ] as Array<[ThemeStyle, string]>
                        ).map(([value, text]) => (
                          <button
                            key={value}
                            type="button"
                            className={`card-opt-btn theme-opt${themeStyle === value ? " active" : ""}`}
                            data-theme={value}
                            onClick={(e) => {
                              e.stopPropagation()
                              setThemeStyle(value)
                              saveThemeStyle(value)
                              setOpenDropdown(null)
                            }}
                          >
                            {text}
                          </button>
                        ))}
                      </div>

                      <div className={`card-dropdown custom-scrollbar${openDropdown === "voice" ? " active" : ""}`} id="voiceCardDropdown">
                        {/* 有道 TTS 音色（默认来源）。选中即持久化并试听 ——
                            globalSpeak 的 overrides 支持「试听非当前来源」，见 hook 注释。 */}
                        {YOUDAO_EN_VOICES.map((v) => (
                          <button
                            key={v.name}
                            type="button"
                            className={`card-opt-btn voice-opt${ttsSettings.source === "youdao" && ttsSettings.youdaoVoice === v.name ? " active" : ""}`}
                            data-youdao={v.name}
                            onClick={(e) => {
                              e.stopPropagation()
                              updateTtsSettings({ source: "youdao", youdaoVoice: v.name })
                              setOpenDropdown(null)
                              void globalSpeak("Hello", { source: "youdao", youdaoVoice: v.name })
                            }}
                          >
                            有道 · {v.label}
                          </button>
                        ))}
                        {/* 系统语音（兜底来源）：enVoices 是白名单过滤后的英文语音 */}
                        {ttsBrowserVoices.length > 0 && (
                          <>
                            <button
                              type="button"
                              className={`card-opt-btn voice-opt${ttsSettings.source === "browser" && !ttsSettings.voice ? " active" : ""}`}
                              data-voice=""
                              onClick={(e) => {
                                e.stopPropagation()
                                updateTtsSettings({ source: "browser", voice: "" })
                                setOpenDropdown(null)
                                void globalSpeak("Hello", { source: "browser", voice: "" })
                              }}
                            >
                              系统 · 默认英文
                            </button>
                            {ttsBrowserVoices.map((v) => (
                              <button
                                key={v.name}
                                type="button"
                                className={`card-opt-btn voice-opt${ttsSettings.source === "browser" && ttsSettings.voice === v.name ? " active" : ""}`}
                                data-voice={v.name}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  updateTtsSettings({ source: "browser", voice: v.name })
                                  setOpenDropdown(null)
                                  void globalSpeak("Hello", { source: "browser", voice: v.name })
                                }}
                              >
                                系统 · {v.name}
                              </button>
                            ))}
                          </>
                        )}
                      </div>

                      <div className={`card-dropdown${openDropdown === "loop" ? " active" : ""}`} id="loopCardDropdown">
                        {[0, 1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className={`card-opt-btn loop-opt${loopCount === n ? " active" : ""}`}
                            data-count={n}
                            onClick={(e) => {
                              e.stopPropagation()
                              setLoopCount(n)
                              saveLoopCount(n)
                              setOpenDropdown(null)
                            }}
                          >
                            {n === 0 ? "手动" : `${n}次`}
                          </button>
                        ))}
                      </div>
                    </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="cyber-main" id="practiceContent">
          {/*
            === Layer 2.4: 触屏设备提示（PC 优先）===

 位置放在 `main` 的第一子节点而不是 `header` 里：顶栏是
            `position:fixed`（`height:44px`），而 `.cyber-main` 用
            `padding-top:54px` 让开它；把提示条塞进 fixed 顶栏会撑破那 44px，
            放在这里则自然落在顶栏正下方、把内容往下推一行。

            样式用内联而不是新建类：`practice.css` 是
 `scripts/extract-practice-css.py` 抽取的产物，文件头写着
            「自动生成 —— 请勿手改」，手写类会在下次重新生成时被抹掉。
            这里取壳上已有的 `--neon-yellow` 变量，保证深浅三种主题下都不跑偏。
          */}
          {showDesktopNotice && (
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(255, 204, 0, 0.25)",
                  background: "rgba(255, 204, 0, 0.06)",
                  fontSize: 12,
                  color: "rgba(255, 255, 255, 0.7)",
                }}
              >
                <span style={{ color: "var(--neon-yellow)", flexShrink: 0, display: "flex" }}>
                  <IconKeyboard />
                </span>
                <span>打字练习需要物理键盘，建议在电脑上打开，手感与识别都更可靠</span>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => {
                    // 关掉≠开始练习：它只说明这条提示打扰到了人。
                    // 之后有没有 practice_complete 才是「移动端是不是劝退」的答案。
                    trackTouchNoticeDismissed()
                    dismissDesktopNotice()
                  }}
                  style={{
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    color: "rgba(255, 255, 255, 0.35)",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {status === "complete" ? (
            <CompletionScreen
              sentenceCount={sentences.length}
              elapsedMinutes={elapsedMinutes}
              accuracy={accuracy}
              nextLesson={nextLesson}
              onNextLesson={goNextLesson}
              onBack={goBack}
            />
          ) : status === "review" ? (
            <ReviewScreen
              sentence={sentence}
              nextSentence={sentences[currentIndex + 1] ?? null}
              currentIndex={currentIndex}
              total={sentences.length}
              showNextPreview={nextPreview}
              autoNext={autoNext}
              trial={trial}
              trialAvailable={trialAvailable}
              onClaimTrial={claimTrial}
              learningStructure={learningStructure}
              onToggleLearningStructure={() => setLearningStructure((v) => !v)}
            />
          ) : mode === "speaking" ? (
            /*
 口语跟读模式。只把 `main#practiceContent` 的内容换掉
              （`initSpeakingMode(document.getElementById('practiceContent'), …)`），
              顶栏 / 进度条 / 计时器 / 底部工具栏全部照旧 —— 所以这里是
              `main` 里的一个分支，不是另起一个满屏组件。
            */
            <SpeakingPractice
              text={sentence?.english ?? ""}
              translation={sentence?.chinese ?? ""}
              sentenceId={sentence?.id ?? ""}
              onResult={handleSpeakingScore}
              onAdvance={handleSpeakingAdvance}
            />
          ) : mode === "puzzle" ? (
            /*
              拼图（拼拼乐）模式。
 把整个模式的 DOM 建在 `#inputContainer.input-slots-container`
              **里面**（`initInputs()`：拿到 `#inputContainer`
              后 `container.innerHTML = ''` 再 `initPuzzleMode(container)`），
              而 `#inputContainer` 是整句渲染模板的一部分 —— 所以拼图模式
              **保留**中文提示条与 `#resultMessage` 结果条，只把输入槽换成词按钮。

              这一点与口语模式不同：口语连中文提示条一起换掉
              （`initSpeakingMode` 直接 `container.innerHTML = ''` 覆写整个
              `main#practiceContent`）。拼图是「听写的容器 + 拼图的填充物」，
              所以下面把中文提示条与结果条按整句分支原样保留。

              容器仍复用 `inputContainer` / `.input-slots-container`：
 `initPuzzleMode` 收的就是这个同一容器；`.puzzle-container`
              自带 `align-items:center`（生成 CSS `:3900`），不会串听写样式。
            */
            <>
              <div className="mission-prompt-wrapper">
                <div className="prompt-border-left" />
                <div className="chinese-prompt">
                  {sentence?.chinese || "（无中文翻译）"}
                </div>
              </div>

              <div className="input-slots-container" id="inputContainer">
                {/*
                  `key` 是必需的，不是可选优化：拼图组件的词表由挂载时的
                  lazy initializer 洗牌一次（`useState(() => …)`），
                  换句时靠**整体重挂**来重新洗牌并把已选词归零 ——
 等价于 `initPuzzleMode()` 里 `container.innerHTML =''`
                  的「拆了重建」。若不加 key，React 会复用实例，
                  下一句的按钮还是上一句的词。
                */}
                <PuzzlePractice
                  key={sentence?.id ?? ""}
                  text={sentence?.english ?? ""}
                  onResult={handlePuzzleResult}
                />
              </div>

              <div style={{ textAlign: "center" }}>
                <div className={`result-message${resultMessage ? ` ${resultMessage} show` : ""}`} id="resultMessage" />
              </div>
            </>
          ) : mode === "learning" ? (
            /*
 学习模式。`loadCurrentSentence()`在这一
              分支把 `main#practiceContent` 整个换成 `.learning-container`：
              中文翻译 + （可选）视图切换按钮 + 注音/结构化句子 + 口语评估条。
              **没有输入框**，句子一显示就自动记完成（见下方 learning 自动完成
              effect），且**永不自动跳转** —— 由用户点底栏下一句/按回车推进。

 这套标记与复习屏几乎相同，此前就写了两遍
              （`loadCurrentSentence` 与 `renderAnswerReviewContent` 各一处），
              所以这里复用 `ReviewScreen` 并传 `variant="learning"` 承载那三处
              差异（外层类名 `long-content`、结构化字号变量、无下一句预览）。

 与拼图/口语一致，这里仍只是 `main` 里的一个分支 ——
              顶栏 / 进度条 / 计时器 / 模式切换器 / 底栏全部照旧。
            */
            <ReviewScreen
              sentence={sentence}
              nextSentence={null}
              currentIndex={currentIndex}
              total={sentences.length}
 /* 学习模式**没有**下一句预览：守卫是
                 `practiceMode === 'dictation' || 'puzzle'`。 */
              showNextPreview={false}
              autoNext={autoNext}
              trial={trial}
              trialAvailable={trialAvailable}
              onClaimTrial={claimTrial}
              learningStructure={learningStructure}
              onToggleLearningStructure={() => setLearningStructure((v) => !v)}
              variant="learning"
            />
          ) : (
            <>
              {/*
 分段练习与整句练习的容器结构不同，差异如下：
                  · 整句（静态 HTML .cyber-main 首屏）：
                    `.mission-prompt-wrapper` > `.prompt-border-left` **在**
                    `.chinese-prompt` **之前**
                    `#inputContainer.input-slots-container`
                    结果条外面套一层 `div`（`text-align:center`）
                  · 分段（`loadFragmentPractice` 注入的
                    innerHTML）：外层多一个 `.fragment-practice-container`，
                    `.chinese-prompt` 在 `.prompt-border-left` **之前**
                    （顺序真的反过来，见源码），
                    `#fragmentInputContainer.input-container`
                    结果条自己带 `style="text-align: center;"`，不套外层 div。
 两处顺序差异是原有设计，不是笔误 —— DOM 对比时会看出来。
              */}
              {inFragmentPractice && currentFragment ? (
                <div className="fragment-practice-container">
                  <div className="mission-prompt-wrapper">
                    <div className="chinese-prompt">
                      {currentFragment.meaning || "（无中文翻译）"}
                    </div>
                    <div className="prompt-border-left" />
                  </div>

                  {/*
 这里原本还有 `#fragmentWordImage`（`loadFragmentWordImage`
                    调 `GET /api/searchWord/image`）。我们没有这个
                    接口（`grep -rln image src/app/api/` 零命中），所以**整块不渲染**
 —— 取不到图时也把容器 `container.remove()`，语义一致；
                    渲染一个空容器反而会多出 24px 上边距和一块占位。
                  */}

                  <div className="input-container" id="fragmentInputContainer">
                    {activeTokens.map((token, i) => {
                      const slot = slots[i]
                      if (!slot) return null
                      return (
                        <div
                          className={`word-input-wrapper${slot.wasIncorrect ? " incorrect" : ""}${slot.readonly ? " read-only" : ""}`}
                          key={`${sentence?.id}-f${fragmentIndex}-${i}`}
                        >
                          <input
                            ref={(el) => { inputsRef.current[i] = el }}
                            id={`fragment-word-${i}`}
                            className={`word-input${slot.readonly ? " correct proper-name" : ""}${slot.wasIncorrect ? " incorrect" : ""}${focusedSlot === i ? " typing" : ""}`}
                            type="text"
                            data-index={i}
                            data-was-incorrect={slot.wasIncorrect ? "true" : undefined}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            lang="en"
                            enterKeyHint="done"
                            inputMode={"latin" as unknown as "text"}
                            readOnly={slot.readonly}
                            value={slot.value}
                            style={{ width: `${baseWidths[i] ?? 80}px` }}
                            onChange={(e) => handleInput(i, e)}
                            onKeyDown={(e) => handleKeyDown(i, e)}
                            onFocus={(e) => {
                              setFocusedSlot(i)
                              const w = dynamicInputWidth(
                                e.currentTarget.value,
                                baseWidths[i] ?? 80,
                                token,
                                true,
                              )
                              e.currentTarget.style.width = `${w}px`
                            }}
                            onBlur={() => {
                              setFocusedSlot((cur) => (cur === i ? null : cur))
                            }}
                          />
                          {/*
 分段练习**没有**单词发音按钮 ——
                            `initFragmentInputs` 只创建
                            `input`，整段的 `word-speak-btn` 一个都没有。
                          */}
                        </div>
                      )
                    })}
                  </div>

                  <div
                    className={`result-message${fragmentResult ? ` ${fragmentResult} show` : ""}`}
                    id="fragmentResultMessage"
                    style={{ textAlign: "center" }}
                  >
                    {fragmentResult === "error" ? "请再试一次" : ""}
                  </div>
                </div>
              ) : (
                <>
                  <div className="mission-prompt-wrapper">
                    <div className="prompt-border-left" />
                    <div className="chinese-prompt">
                      {sentence?.chinese || "（无中文翻译）"}
                    </div>
                  </div>

                  <div className="input-slots-container" id="inputContainer">
                    {tokens.map((token, i) => {
                      const slot = slots[i]
                      if (!slot) return null
                      return (
                        <div
                          className={`word-input-wrapper${slot.wasIncorrect ? " incorrect" : ""}${slot.readonly ? " read-only" : ""}`}
                          key={`${sentence?.id}-${i}`}
                        >
                          <input
                            ref={(el) => { inputsRef.current[i] = el }}
                            id={`word-${i}`}
                            className={`word-input${slot.readonly ? " correct proper-name" : ""}${slot.wasIncorrect ? " incorrect" : ""}${focusedSlot === i ? " typing" : ""}`}
                            type="text"
                            data-index={i}
                        /**
 * `input.dataset.wasIncorrect ='true'`（，
                         * 答错时打标；分段练习同理）。`dataset.wasIncorrect`
                         * 落到 DOM 上就是 `data-was-incorrect`。当前 CSS 里没有规则用
 * 它，但它是会写在 DOM 上的真实状态，且曾用于
                         * 「输满长度自动跳下一格」的兜底判断（
                         * 现已注释掉）。保留以备对齐。
                         */
                        data-was-incorrect={slot.wasIncorrect ? "true" : undefined}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        lang="en"
                        enterKeyHint="done"
                        /**
 * 这里写的是 `inputmode="latin"`（HTML 规范里的合法值，
                         * 让移动端弹拉丁键盘而不是本地语言键盘）。React 的
                         * `inputMode` 类型联合里**没有** "latin"（它只收 none/text/
                         * tel/url/email/numeric/decimal/search），所以需要断言绕过；
                         * 但属性名必须用驼峰 `inputMode` —— 直接写小写 `inputmode`
                         * 会被 React 当成未知属性并打警告
                         * 「Invalid DOM property `inputmode`. Did you mean `inputMode`?」。
                         * 两者输出的 DOM 属性都是 `inputmode="latin"`。
                         */
                        inputMode={"latin" as unknown as "text"}
                        readOnly={slot.readonly}
                        value={slot.value}
                        style={{ width: `${baseWidths[i] ?? 100}px` }}
                        onChange={(e) => handleInput(i, e)}
                        onKeyDown={(e) => handleKeyDown(i, e)}
                        onFocus={(e) => {
 // focus 时打 `typing`
                          setFocusedSlot(i)
                          // 聚焦时按当前值重算一次宽度（个性化变更后可能不准了）
                          const w = dynamicInputWidth(
                            e.currentTarget.value,
                            baseWidths[i] ?? 100,
                            token,
                            window.innerWidth <= 1024,
                          )
                          e.currentTarget.style.width = `${w}px`
                        }}
                        onBlur={() => {
 // blur 时摘掉 `typing`
                          setFocusedSlot((cur) => (cur === i ? null : cur))
                        }}
                      />
                      <button
                        type="button"
                        className={`word-speak-btn${speakingWordIndex === i ? " playing" : ""}`}
                        tabIndex={-1}
                        title={`播放单词发音(${wordSpeakShortcutKbd})`}
                        data-word={token}
                        data-word-index={i}
                        onClick={(e) => {
 // 先拦默认行为与冒泡：这个按钮
                          // 就在输入框旁边，不拦的话点它会先把焦点从 input 上抢走。
                          e.preventDefault()
                          e.stopPropagation()
                          void handleWordSpeak(i, token)
                        }}
                      >
 {/* 原样 SVG（12×12、polygon + path）。 */}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>

              <div style={{ textAlign: "center" }}>
                <div className={`result-message${resultMessage ? ` ${resultMessage} show` : ""}`} id="resultMessage" />
              </div>
                </>
              )}
            </>
          )}
        </main>

        {status !== "complete" && (
          <footer className="cyber-footer">
            <div className="footer-stack">
              {/*
 声音频谱条：footer > .footer-stack 的**第一个子节点**。
                基类虽然 `visibility:hidden; opacity:0`，但它仍占 30px 布局
                （`height:30px; margin:0 auto 4px`）—— 漏掉整块会让底栏相对
 预期位置上移 34px。

 `.active` 跟随真实播放状态增删（在
                `_webAudioAvailable && vizEnabled` 时加，stopAudioVisualizer
                里删）。静态 HTML 快照里带 `.active` 只是因为抓取那一刻
                首句 TTS 正在自动播。
              */}
              <div
                className={`audio-visualizer${speaking && audioVisualizer ? " active" : ""}`}
                id="audioVisualizer"
              >
                <canvas id="audioCanvas" width={600} height={120} style={{ width: 300, height: 60 }} />
              </div>
              {/*
 底栏按以下 DOM 顺序逐项对齐：
                prevBtn → 分隔 → ttsBtn → showEnglishBtn → favoriteBtn → 分隔
                → fragmentInfo → fragmentDivider → submitAnswerBtn → nextBtn
                → 三个被 CSS 强制隐藏的兼容占位 → voiceSelect。

 `#chineseToggleBtn` 这类占位**必须渲染出来**：CSS 用
                `display:none !important` 把它们压成 0 尺寸（见
                「Force hide compatibility elements」段），所以
                它们在视觉与布局上都不可见 —— 渲染它们既不影响像素，又让
 DOM 结构与设计保持一致（否则任何按结构做的对比都会误报）。
              */}
              <div className="control-dock" id="bottomToolbar">
                <button
                  type="button"
                  id="prevBtn"
                  className="dock-btn"
                  disabled={currentIndex === 0}
                  onClick={goPrev}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>

                <div className="dock-divider" />

                <button
                  type="button"
                  id="ttsBtn"
                  className="dock-btn btn-main"
                  onClick={() => { if (sentence?.english) void globalSpeak(sentence.english, { count: manualPlayCount() }) }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H2v6h4l5 4z" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                </button>

 {/* 慢声发音按钮已被后端停用，DOM 留在注释里。 */}
                {/* <button className="dock-btn" id="slowTtsBtn" disabled>…</button> */}

                <button
                  type="button"
                  id="showEnglishBtn"
                  className="dock-btn"
                  /*
 口语与学习模式隐藏「显示答案」（`updateBottomToolbar`
                    里 `showEnglishBtn.style.display = 'none'`）。
                    这两个模式整句本来就摊开着，看了答案也没东西可变。
                    听写/拼图恢复 `flex`。
                  */
                  style={{ display: mode === "speaking" || mode === "learning" ? "none" : "flex" }}
                  onClick={() => setShowHint((v) => !v)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
 {/* 用这个 span 存文案给 JS 读，自身恒为 display:none */}
                  <span className="kbd" style={{ display: "none" }}>{answerShortcutKbd}</span>
                </button>

                <button
                  type="button"
                  id="favoriteBtn"
                  className={`dock-btn${favorited ? " favorited" : ""}`}
                  aria-busy={favoriteBusy}
                  disabled={favoriteBusy}
                  onClick={() => { void toggleFavorite() }}
                >
                  <svg
                    id="favoriteIcon"
                    viewBox="0 0 24 24"
                    fill={favorited ? "var(--neon-yellow, #f59e0b)" : "none"}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>

                <div className="dock-divider" />

                {/*
 分段练习信息条。`#fragmentInfo` 的可见性只由
                  `updateFragmentInfo()` / `hideFragmentInfo()`
                  控制：进入分段练习置 `flex`（注意**不是** `''` —— 它显式写
                  `flex`，因为基类 `.fragment-info` 本身就是 `display:flex`，
 写空串也能复原，但显式写死 `flex`），`#fragmentDivider`
                  置空串（恢复样式表默认的可视态）。

                  这里不再写 `mode !== "speaking"`：`inFragmentPractice` 的
                  定义里已经含 `mode === "dictation"`，TypeScript 的
                  别名条件收窄会认定该比较恒真并报 TS2367。分段练习本就只属于
                  听写模式，条件简化为单一来源也更难写错。
                */}
                <div
                  className="fragment-info"
                  id="fragmentInfo"
                  style={{ display: inFragmentPractice ? "flex" : "none" }}
                >
                  <span className="fragment-badge">分段练习</span>
                  <span className="fragment-step" id="fragmentStep">
                    {inFragmentPractice
                      ? `${fragmentIndex + 1}/${activeFragmentList?.length ?? 0}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="skip-fragment-btn"
                    onClick={startFullSentencePractice}
                  >
                    跳过 →
                  </button>
                </div>

                <div
                  className="dock-divider"
                  id="fragmentDivider"
                  style={{ display: inFragmentPractice ? "" : "none" }}
                />

                {/*
 移动端听写提交按钮。可见性由
                  `practiceIsMobileDevice && mode === 'dictation' && !isInAnswerReviewMode`
                  决定，桌面端恒为 `display:none`（由 `.mobile-submit-btn` 的
                  默认样式保证）。这里同样只在 `isMobile` 时加 `is-visible`。
                */}
                <button
                  type="button"
                  id="submitAnswerBtn"
                  className={`dock-btn mobile-submit-btn${isMobile && mode === "dictation" && status === "input" ? " is-visible" : ""}`}
                  aria-label="提交答案"
                  aria-hidden={!(isMobile && mode === "dictation" && status === "input")}
                  disabled={!(isMobile && mode === "dictation" && status === "input")}
                  /*
 提交时按
                    `isInFragmentPractice` 分叉：分段走 `checkFragmentAnswer`，
                    整句走 `checkAnswer`。
                  */
                  onClick={() => {
                    if (inFragmentPractice) checkFragmentAnswer()
                    else void checkAnswer()
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>提交</span>
                </button>

                <button
                  type="button"
                  id="nextBtn"
                  /*
                    ✓/`.finish-btn` 的判据是**全部完成**，不是「停在最后一句」。
 判据公式：
                      allCompleted = (mode==='learning'||mode==='speaking')
                        ? completedSentences.size >= totalSentenceCount
                        : completedCount >= totalSentenceCount
                    而 `completedCount = completedSentences.size`，
                    两条分支判的是同一个集合大小 —— 所以这里一个条件通吃四模式。
                    用下标判是错的：末句还没做时它就会亮✓，而中间几句没做、
                    停在末句上时反而该亮。
                  */
                  className={`dock-btn${completedCount >= sentences.length && sentences.length > 0 ? " finish-btn" : ""}`}
                  onClick={() => {
                    reviewEpochRef.current += 1
 // 学习模式多一道「全部完成即进完成页」的早退：
                    // 学习模式
                    // 渲染即完成，翻完一遍后再点箭头就该收尾，不该继续逐句绕。
                    if (mode === "learning") handleLearningAdvance()
                    else advance()
                  }}
                >
                  {completedCount >= sentences.length && sentences.length > 0 ? "✓" : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  )}
                </button>

 {/* 以下四项是 JS 兼容占位，被 CSS 强制隐藏，无视觉影响。 */}
                <button type="button" id="chineseToggleBtn" style={{ display: "none" }} aria-hidden="true" />
                <button type="button" id="immersiveToggleBtn" style={{ display: "none" }} aria-hidden="true" />
                <span id="playShortcutDisplay" style={{ display: "none" }}>{playShortcutKbd}</span>
                <select id="voiceSelect" style={{ display: "none" }} aria-hidden="true" tabIndex={-1} defaultValue="">
                  <option value="English_magnetic_voiced_man">美式男声</option>
                </select>
              </div>
            </div>
          </footer>
        )}

        {/*
 答案揭示浮层。结构是 `div.answer-reveal-panel#sentenceHint` >
          `div#sentenceHintContent`，由 `_renderSentenceHintWithCurrentData()`
          注入，再**恒定**追加 `.answer-panel-footer`
          显示「{快捷键} 或 ESC」——这条页脚是浮层唯一常驻的操作提示。

          内容有两种形态，由 `isHintStructuredMode`（默认 true）切换：
            · 有结构数据且处于结构模式 → `renderStructuredAnswer(…, true)`
              （enableFallback=true：与原句对不上宁可给纯文本）
              外层**不加** padding 包裹，`.structured-answer` 自带 `padding: 5px 0`
            · 否则 → 居中包裹的 `<span class="answer-text-plain">`
          页脚也跟着分叉：有结构数据时多一个 `div.footer-action` 切换按钮
          （`toggleHintMode`），没有结构数据时只有 `.footer-hint` 且靠右。

          **常驻 DOM + `.show` 切换**，理由同设置面板：移植过来的 CSS 是
          `.answer-reveal-panel:not(.show) { display:none }`（practice.css:1961），
          条件渲染虽然视觉等价，但会让 `#sentenceHint` 在收起时不存在，
 而 `toggleSentenceHint` 判断的正是
          `hintBox.classList.contains('show')`，DOM 对比也会缺 id。
        */}
        <div
          className={`answer-reveal-panel${showHint && status === "input" ? " show" : ""}`}
          id="sentenceHint"
        >
          <div id="sentenceHintContent">
            {/*
 分段练习的 hint **完全短路**：`showSentenceHint`
              在进入结构化渲染前先判断
              `isInFragmentPractice`，命中就只塞
              `<span class="answer-text-plain">{fragment.text}</span>`
              然后 `return` —— 既没有 `.structured-answer`，也**没有页脚**
              （页脚是 `_renderSentenceHintWithCurrentData` 才追加的），
              所以分段态下连 `Switch to Text` 按钮和快捷键提示都不出现。
            */}
            {inFragmentPractice && currentFragment ? (
              <div style={{ padding: "20px 10px", textAlign: "center" }}>
                <span className="answer-text-plain">{currentFragment.text}</span>
              </div>
            ) : hintAnswer.structured && hintStructured ? (
              <StructuredAnswerView answer={hintAnswer} highlightedIndex={focusedSlot} />
            ) : (
              <div style={{ padding: "20px 10px", textAlign: "center" }}>
                <span className="answer-text-plain">{sentence?.english ?? ""}</span>
              </div>
            )}
            {inFragmentPractice && currentFragment ? null : (
            <div
              className="answer-panel-footer"
              style={hintAnswer.structured ? undefined : { justifyContent: "flex-end" }}
            >
              {hintAnswer.structured ? (
                /*
 原结构是 `div.footer-action[onclick=toggleHintMode]`
                  —— 是 div 不是 button（CSS 也没给它按钮态），照抄。
                  图标与文字之间靠一个空格分隔，不是 margin。
                */
                <div
                  className="footer-action"
                  role="button"
                  tabIndex={0}
                  title="Toggle View Mode"
                  onClick={(e) => {
                    e.stopPropagation()
                    setHintStructured((v) => !v)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      e.stopPropagation()
                      setHintStructured((v) => !v)
                    }
                  }}
                >
                  {/*
                    文案方向：当前是结构视图 → 按钮提示可以切到纯文本。
 判据是 isHintStructuredMode 本身。
                    图标同理：结构模式给「列表」图标，纯文本模式给「宫格」图标。
                  */}
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ marginBottom: 1 }}
                  >
                    {hintStructured ? (
                      <path d="M4 6h16M4 12h16M4 18h7" />
                    ) : (
                      <>
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                      </>
                    )}
                  </svg>{" "}
                  {hintStructured ? "Switch to Text" : "View Structure"}
                </div>
              ) : null}
              <div className="footer-hint">{answerShortcutKbd} 或 ESC</div>
            </div>
            )}
          </div>
        </div>

        {/*
          常驻的快捷键提示条（此前是长按 ⌘/Ctrl 才滑出，用户反馈不明显）。
 旧做法在 `document.body` 上重建整个节点；这里用条件 class 切换
          `.active`，CSS 里 `.shortcut-overlay-bar` 是 `position:fixed`，放在壳内
          同样相对视口定位。开关关闭或快捷键弹窗录制时回到隐藏态，不删节点。
        */}
        <div className={`shortcut-overlay-bar${shortcutOverlayEnabled && !shortcutModalOpen ? " active" : ""}`}>
          {/*
 每一段各自包一层 <kbd>，段间用 + 连接。早先这里是 `replace("+","")`，
            把 ⌘ 和 P 并在同一个 <kbd> 里，胶囊样式刻意不同。
            文案也一并读实时配置（用户改键后提示条必须跟着变）。
          */}
          <div className="shortcut-item">
            {shortcutKbdParts("play", shortcuts).map((p, i) => (
              <span key={i}>{i > 0 && "+"}<kbd>{p}</kbd></span>
            ))}
            <span>播放语音</span>
          </div>
          <div className="shortcut-item">
            {shortcutKbdParts("answer", shortcuts).map((p, i) => (
              <span key={i}>{i > 0 && "+"}<kbd>{p}</kbd></span>
            ))}
            <span>答案提示</span>
          </div>
          <div className="shortcut-item">
            {shortcutKbdParts("favorite", shortcuts).map((p, i) => (
              <span key={i}>{i > 0 && "+"}<kbd>{p}</kbd></span>
            ))}
            <span>收藏句子</span>
          </div>
        </div>

        {/*
 「已加入错题本」通知。时间线：出现后 10ms 加 `.show` 滑入，
          2s 后移除 `.show`、再 300ms 后卸载；用 epoch + show 两个相位
          驱动（CSS 已移植：`position:fixed` + `bottom` 从下方滑入）。
        */}
        {mistakeNoticeEpoch > 0 && (
          <div className={`mistake-notification${mistakeNoticeShow ? " show" : ""}`}>
            <span className="mistake-icon">📝</span>
            <div className="mistake-content">
              <div>已加入错题本</div>
              <div className="mistake-subtitle">该句已记录，完成练习后可在错题本中复习</div>
            </div>
          </div>
        )}
      </div>

      {/*
 快捷键设置弹窗。
        结构是 `.shortcut-modal > .shortcut-modal-content > header/body/hint/footer`；
        body 里的行由 `VISIBLE_SHORTCUT_IDS.map()` 动态生成。

        同样**不能**条件渲染：`.shortcut-modal` 基类是 `display:none`，
        靠 `.show` 切成 `flex`。

 点遮罩即关：判 `e.target === e.currentTarget`，点到弹窗内容不会误关。
      */}
      <div
        className={`shortcut-modal${shortcutModalOpen ? " show" : ""}`}
        id="shortcutModal"
        onClick={(e) => { if (e.target === e.currentTarget) setShortcutModalOpen(false) }}
      >
        <div className="shortcut-modal-content">
          <div className="shortcut-modal-header">
            <h3>⌨️ 快捷键设置</h3>
            <button type="button" className="shortcut-close-btn" id="shortcutCloseBtn"
              aria-label="关闭" onClick={() => setShortcutModalOpen(false)}>✕</button>
          </div>
          <div className="shortcut-modal-body" id="shortcutList">
            {VISIBLE_SHORTCUT_IDS.map((id) => {
              const isRecording = recordingId === id
              return (
                <div
                  key={id}
                  className={`shortcut-row${isRecording ? " recording" : ""}`}
                  data-action-id={id}
                >
                  <span className="shortcut-label">{shortcuts[id].label}</span>
                  <div className="shortcut-key-display">
                    {isRecording ? (
                      <span className="shortcut-recording-text">
                        {recordingWarning ?? "⏺ 请按下新快捷键..."}
                      </span>
                    ) : (
 // 每一段都包一层 <kbd>，段间用 + 连。
                      shortcutKbdParts(id, shortcuts).map((p, i) => (
                        <span key={i}>
                          {i > 0 && "+"}
                          <kbd>{p}</kbd>
                        </span>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    className="shortcut-edit-btn"
                    data-action={id}
                    title={isRecording ? "取消" : "修改"}
                    onClick={() => {
                      if (isRecording) {
                        setRecordingId(null)
                        setRecordingWarning(null)
                        modifiersPressedRef.current = 0
                      } else {
                        setRecordingWarning(null)
                        modifiersPressedRef.current = 0
                        setRecordingId(id)
                      }
                    }}
                  >
                    {isRecording ? "✕" : "✏️"}
                  </button>
                </div>
              )
            })}
          </div>
          <div className="shortcut-modal-hint">
            💡 支持修饰键（Alt/Ctrl/Win/Shift）或功能键单按。⚠️ 字母键需搭配修饰键以防打字冲突。
          </div>
          <div className="shortcut-modal-footer">
            <button
              type="button"
              className="shortcut-reset-btn"
              id="shortcutResetBtn"
              onClick={() => {
                setShortcuts(resetShortcuts())
                setRecordingId(null)
                setRecordingWarning(null)
                toast.info("快捷键已恢复默认")
              }}
            >
              恢复默认
            </button>
            <button
              type="button"
              className="shortcut-close-action-btn"
              id="shortcutCloseActionBtn"
              onClick={() => setShortcutModalOpen(false)}
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {/*
        切换练习模式的确认弹窗已随切换器一起移进 `ModeSwitcher`
        （听写页与非听写页共用）。它用 portal 挂到 `document.body`，
        而不是继续留在这里 —— 这里在 `.learning-container` 内部，
        而后者带 `animation: … forwards`，computed `transform` 非 none，
        会让参考 CSS 的 `position:fixed` 改以它为 containing block、遮罩盖不满屏。
        内联口语条已踩过同一个坑。样式前缀也换成了 `.mode-switcher-scope`，
        `.practice-shell .custom-modal-*` 在非听写页一条都命中不了。
      */}

      {/*
 个性化设置模态框。模态框 id 为 `#personalizationModal`，块级 `position:fixed`
        且默认 `display:none`，靠 `.show` 切成 flex —— 不能用条件渲染，否则
        `input#previewInput` 等受控节点会在关闭时被卸载、CSS 过渡也失效。

 交互口径：模态框里改的是一个**草稿**，只有点
        「应用设置」才 `saveDictationInputSettings` + 落到壳元素上；「恢复默认」
        只把草稿改回默认值并刷新界面、**不写盘**；关闭/ESC/点遮罩都是丢弃草稿、
        重新从 localStorage 读回。
      */}
      <div className={`personalization-modal${personalizationOpen ? " show" : ""}`} id="personalizationModal"
        onClick={(e) => { if (e.target === e.currentTarget) closePersonalization() }}>
        <div className="personalization-modal-content">
          <div className="personalization-modal-header">
            <h3>个性化设置</h3>
            <button type="button" className="personalization-close-btn" id="closePersonalizationModal"
              aria-label="关闭" onClick={closePersonalization}>
              <IconClose />
            </button>
          </div>
          <div className="personalization-modal-body">
            <div className="personalization-section">
              <div className="personalization-label">输入框字体</div>
              <div className="font-options">
                {(Object.keys(DICTATION_FONT_LABELS) as Array<DictationInputSettings["font"]>).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`font-option-btn${personalizationDraft.font === f ? " active" : ""}`}
                    data-font={f}
                    onClick={() => setPersonalizationDraft((d) => ({ ...d, font: f }))}
                  >
                    {/*
 外层 button + 内层 span[style=fontFamily]，
                      内层 span 里再套一个 1.2em 的「Aa」。字体族必须落在
                      内层 span 上，落在 button 上会被按钮自身样式覆盖。
                    */}
                    <span style={{ fontFamily: DICTATION_FONT_OPTIONS[f] }}>
                      <span style={{ fontSize: "1.2em", marginRight: 4 }}>Aa</span>{" "}
                      {DICTATION_FONT_MODAL_LABELS[f]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="personalization-section">
              <div className="personalization-label">字号大小</div>
              <div className="font-size-value" id="fontSizeValue">
                {(personalizationDraft.size / 10).toFixed(1)}rem
              </div>
              <input
                type="range"
                className="font-size-slider"
                id="fontSizeSlider"
                min={16}
                max={40}
                step={2}
                value={personalizationDraft.size}
                onChange={(e) => setPersonalizationDraft((d) => ({ ...d, size: Number(e.target.value) }))}
              />
              <div className="font-size-marks">
                <span>小</span><span>中</span><span>大</span><span>超大</span>
              </div>
            </div>

            <div className="personalization-section">
              <div className="personalization-label">输入框样式</div>
              <div className="input-style-options">
                {(
                  [
                    ["box", "▢", "方框"],
                    ["underline", "▁", "横线"],
                  ] as Array<[DictationInputSettings["inputStyle"], string, string]>
                ).map(([style, glyph, text]) => (
                  <button
                    key={style}
                    type="button"
                    className={`input-style-btn${personalizationDraft.inputStyle === style ? " active" : ""}`}
                    data-style={style}
                    onClick={() => setPersonalizationDraft((d) => ({ ...d, inputStyle: style }))}
                  >
                    <span className="style-icon">{glyph}</span>
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="personalization-section">
              <div className="personalization-label">预览效果</div>
              {/*
 `input-style-underline` 与 `input-style-box` 两个类必须互斥（切换时一加一减），
                只加不减会让方框模式被横线模式的规则覆盖。
              */}
              <div
                className={`personalization-preview${personalizationDraft.inputStyle === "underline" ? " input-style-underline" : " input-style-box"}`}
                id="previewArea"
              >
                <div className="preview-input-wrapper">
                  <input
                    className="preview-input"
                    id="previewInput"
                    readOnly
                    value="Hello"
                    style={{
                      fontFamily: DICTATION_FONT_OPTIONS[personalizationDraft.font],
                      fontSize: `${(personalizationDraft.size / 10).toFixed(1)}rem`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="personalization-modal-footer">
            <button
              type="button"
              className="personalization-reset-btn"
              id="resetPersonalization"
 // 只改草稿 + 刷新界面，不写盘 —— 写盘要等「应用设置」
              onClick={() => setPersonalizationDraft(DEFAULT_DICTATION_INPUT_SETTINGS)}
            >
              恢复默认
            </button>
            <button
              type="button"
              className="personalization-apply-btn"
              id="applyPersonalization"
              onClick={() => {
                setPersonalization(personalizationDraft)
                saveDictationInputSettings(personalizationDraft)
                setPersonalizationOpen(false)
                toast.info("已应用输入框个性化设置", { duration: 2000 })
              }}
            >
              应用设置
            </button>
          </div>
        </div>
      </div>

 {/* 「更多设置」模态框 —— 与个性化设置并列的独立模态框 */}
      <div className={`personalization-modal${moreSettingsOpen ? " show" : ""}`} id="moreSettingsModal">
        <div className="personalization-modal-content">
          <div className="personalization-modal-header">
            <h3>更多设置</h3>
            <button type="button" className="personalization-close-btn" id="closeMoreSettingsModal"
              aria-label="关闭" onClick={() => { setMoreSettingsOpen(false); setRevealMenuOpen(false) }}>
              <IconClose />
            </button>
          </div>
          <div className="personalization-modal-body">
            <MoreSettingsRow
              label="自动弹答案错误次数"
              hint="输入错误达到此次数后自动弹出答案并加入错题本"
            >
              <div className="more-settings-select" id="autoRevealSelect">
                <button
                  type="button"
                  className="more-settings-select-trigger"
                  id="autoRevealTrigger"
                  aria-haspopup="listbox"
                  aria-expanded={revealMenuOpen}
                  onClick={() => setRevealMenuOpen((v) => !v)}
                >
                  <span className="more-settings-select-value" id="autoRevealValueDisplay">
                    {revealThreshold === 0 ? "永不" : `${revealThreshold} 次`}
                  </span>
                  <IconChevronDown />
                </button>
                <ul className={`more-settings-select-menu${revealMenuOpen ? " open" : ""}`} id="autoRevealMenu" role="listbox">
                  {[0, 3, 4, 5].map((n) => (
                    <li
                      key={n}
                      role="option"
                      aria-selected={revealThreshold === n}
                      className={`more-settings-select-item${revealThreshold === n ? " active" : ""}`}
                      data-value={n}
                      onClick={() => {
                        setRevealThreshold(n)
                        saveAutoRevealThreshold(n)
                        setRevealMenuOpen(false)
                      }}
                    >
                      {n === 0 ? "永不" : `${n} 次`}
                    </li>
                  ))}
                </ul>
              </div>
            </MoreSettingsRow>

            <MoreSettingsRow
              label="显示音标"
              hint="关闭后听写答案和复习界面不显示音标"
              control={
                <MoreSettingsToggle
                  id="showPhoneticsToggle"
                  on={showPhonetics}
                  onChange={(next) => {
                    setShowPhonetics(next)
                    saveShowPhonetics(next)
                    toast.info(next ? "已开启音标显示" : "已关闭音标显示", { duration: 2000 })
                  }}
                />
              }
            />

            <MoreSettingsRow
              label="显示中文"
              hint="关闭后听写时不显示中文提示，便于自测"
              control={
                <MoreSettingsToggle
                  id="showChineseToggle"
                  on={showChinese}
                  onChange={() => toggleChinese()}
                />
              }
            />

            {/*
              听写整句配图开关。**开关在、渲染器永远不会触发** —— 但这不是缺陷，
 对「我们有的数据」而言，不渲染就是正确行为：

 `canDisplayFullSentenceImage` 的门禁要求
              `getSentenceImageStatus(sentence) === 3 && !!getSentenceImageName(sentence)`，
              而 `imageGenStatus` / `imageName` 在 `sentences` 表里**不存在**
              （39 张表里没有任何图片列；`courses.cover_url` 是课程封面，不是句子配图），
              也没有 `PracticeConfig.sentenceImageBaseUrl` 这个地址前缀。
              所以即使把 `renderFullSentenceImage` 逐字搬过来，
              取 `imageName` 恒为空串 → 第一道 `return` 就出去了，DOM 里同样没有
              `#fullSentenceImage`。开关的默认值也是两边一致（`=== 'on'` ⇒ 默认关）。

 因此这里保留的是**行为正确的控件**，而不是一个待实现的空缺：
              等哪天有了句图数据源，只需补 `canDisplayFullSentenceImage` +
              `renderFullSentenceImage` 两段，开关不必再改。
            */}
            <MoreSettingsRow
              label="显示句子图片（部分课程支持）"
              hint="开启后在听写整句练习时显示配图，关闭可节省空间和流量"
              control={
                <MoreSettingsToggle
                  id="sentenceImageToggle"
                  on={sentenceImage}
                  onChange={(next) => {
                    setSentenceImage(next)
                    saveSentenceImage(next)
                    toast.info(next ? "已开启听写整句配图" : "已关闭听写整句配图", { duration: 2000 })
                  }}
                />
              }
            />

            <MoreSettingsRow
              label="下一句预览"
              hint="复习界面底部显示即将练习的下一句中文"
              control={
                <MoreSettingsToggle
                  id="nextSentencePreviewToggle"
                  on={nextPreview}
                  onChange={(next) => {
                    setNextPreview(next)
                    saveNextPreview(next)
 // 关闭时的文案特意点明「下一句进入时生效」，
                    // 因为复习屏是当帧就已经渲染好的，改开关不会立刻收起当前预览。
                    toast.info(
                      next ? "已开启下一句预览" : "已关闭下一句预览（下一句进入时生效）",
                      { duration: 2000 },
                    )
                  }}
                />
              }
            />

            <MoreSettingsRow
              label="答对烟花效果"
              hint="关闭后答对时不显示烟花动画，减少性能开销"
              control={
                <MoreSettingsToggle
                  id="confettiEffectToggle"
                  on={confetti}
                  onChange={(next) => {
                    setConfetti(next)
                    saveConfetti(next)
                    toast.info(next ? "已开启烟花效果" : "已关闭烟花效果", { duration: 2000 })
                  }}
                />
              }
            />

            <MoreSettingsRow
              label="声音频谱动画"
              hint="关闭后播放语音时不显示频谱波形动画"
              control={
                <MoreSettingsToggle
                  id="audioVisualizerToggle"
                  on={audioVisualizer}
                  onChange={(next) => {
                    setAudioVisualizer(next)
                    saveAudioVisualizer(next)
                    toast.info(next ? "已开启频谱动画" : "已关闭频谱动画", { duration: 2000 })
                  }}
                />
              }
            />

            <MoreSettingsRow
              label="底部工具栏样式"
              hint="紧凑模式可减少工具栏高度，为输入区域留出更多空间"
              control={
 // 用 label[for] 包原生 select，点击任意位置都能展开
                <label className="more-settings-native-select-wrap" htmlFor="toolbarDensitySelect">
                  <select
                    className="more-settings-native-select"
                    id="toolbarDensitySelect"
                    aria-label="底部工具栏样式"
                    value={toolbarDensity}
                    onChange={(e) => {
                      const next = e.target.value as ToolbarDensity
                      setToolbarDensity(next)
                      saveToolbarDensity(next)
                      toast.info(
                        next === "compact" ? "已切换为紧凑工具栏" : "已切换为常规工具栏",
                        { duration: 2000 },
                      )
                    }}
                  >
                    <option value="normal">常规</option>
                    <option value="compact">紧凑</option>
                  </select>
                </label>
              }
            />

            <MoreSettingsRow
              label="快捷键提示"
              hint="在页面顶部常驻显示快捷键提示浮层"
              control={
                <MoreSettingsToggle
                  id="shortcutOverlayInModalToggle"
                  on={shortcutOverlayEnabled}
                  onChange={(next) => {
                    setShortcutOverlayEnabled(next)
                    saveShortcutOverlay(next)
 // 文案判据是**切换后**的 `next`（等价于用切换前的值取反判断）。
                    toast.info(next ? "已开启快捷键提示" : "已关闭快捷键提示", { duration: 2000 })
                  }}
                />
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 「更多设置」里的一行：左侧标签 + 提示，右侧控件 */
function MoreSettingsRow({
  label, hint, control, children,
}: {
  label: string
  hint: string
  control?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="more-settings-row">
      <div className="more-settings-row-main">
        <div className="more-settings-row-label">{label}</div>
        <div className="more-settings-row-hint">{hint}</div>
      </div>
      {control ?? children}
    </div>
  )
}

/**
 * 开关是 `button.more-settings-toggle-btn[data-on]`，文案为
 * 「已开启」/「已关闭」，选中态完全由 `[data-on="true"]` 的 CSS 决定。
 */
function MoreSettingsToggle({
  id, on, onChange,
}: {
  id: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      className="more-settings-toggle-btn"
      id={id}
      data-on={on}
      onClick={() => onChange(!on)}
    >
      {on ? "已开启" : "已关闭"}
    </button>
  )
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

/*
 * 早先这里有 `switchText(from, to)` 与 `ModeIcon(mode)` 两个私有小函数。
 * 它们（连同模式下拉和切换确认弹窗）都随 `ModeSwitcher` 一起提成了共用组件：
 * 非听写模式也必须能切回听写，否则用户切过去就回不来了。
 * 文案仍复用 `practice-mode.ts` 的 `switchModeConfirmText` —— 早先这里把来源
 * 模式写死成「听写模式」，一旦四种模式都能进，对「从拼图切到学习」这种路径
 * 就会撒谎（文案必须按当前模式动态取名）。
 */

/**
 * 设置面板的一张信息卡，结构为 `div.info-card > .ic-left > (.ic-label +
 * .ic-value#xxxDisplay) + .ic-icon`。
 *
 * `status` 的取值：`ok`/`off`/`muted`/`purple`/`cyan`，另外加了一个
 * `plain` 表示不带状态类（「界面模式」「发音偏好」「自动播放次数」三张卡
 * 都会用到）。`.status-off` / `.status-muted` 在参考 CSS 里没有基础规则
 * （grep 计数 0），颜色只靠内联样式给出 —— 我们这里显式带上内联色保持一致。
 */
function InfoCard({
  id, title, label, value, valueId, status, valueColor, icon, iconId, onClick,
}: {
  id: string
  title: string
  label: string
  value: string
 /** 这四张卡的值 id 并不等于 `${id去掉Card}Display`：
   *  `soundCard→kbdSoundDisplay`、`loopCard→loopDisplayValue`、
   *  `fragmentCard→fragmentModeDisplay`、`voiceCard→voiceDisplayShort`。
   *  做成显式参数比推导更忠实。 */
  valueId: string
  status: "ok" | "off" | "muted" | "purple" | "cyan" | "plain"
 /** `#loopDisplayValue` 需要单独写内联色：
   *  手动播放时 `style.color = '#ef4444'`，否则清空。 */
  valueColor?: string
  icon: ReactNode
 /** 只有 themeCard / immersiveCard 的图标写了 id。 */
  iconId?: string
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
}) {
  const statusClass = status === "plain" ? "" : ` status-${status}`
  const inlineColor = valueColor
    ? { color: valueColor }
    : status === "ok"
      ? { color: "var(--neon-green, #22c55e)" }
      : status === "off" || status === "muted"
        ? { color: "#666" }
        : undefined
  return (
    <div
      className="info-card interactive"
      id={id}
      title={title}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent<HTMLDivElement>)
        }
      }}
    >
      <div className="ic-left">
        <span className="ic-label">{label}</span>
        <span className={`ic-value${statusClass}`} id={valueId} style={inlineColor}>
          {value}
        </span>
      </div>
 {/* 只有 themeCard / immersiveCard 的 .ic-icon 写了 id，其余 10 张
          卡的图标没有 id —— 不自己补。 */}
      <div className="ic-icon" id={iconId}>{icon}</div>
    </div>
  )
}

/* ── 设置面板图标（面板用到的 svg 集中在这里） ─────────────────────────── */

function SvgIcon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

function IconMoon() {
  return <SvgIcon size={14}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></SvgIcon>
}
function IconExpand() {
  return (
    <SvgIcon size={14}>
      <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
    </SvgIcon>
  )
}
function IconMic() {
  return (
    <SvgIcon size={14}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v4" /><path d="M8 23h8" />
    </SvgIcon>
  )
}
function IconSpeaker() {
  return (
    <SvgIcon size={14}>
      <path d="M11 5L6 9H2v6h4l5 4z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </SvgIcon>
  )
}
function IconLoop() {
  return (
    <SvgIcon size={14}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
    </SvgIcon>
  )
}
function IconFragment() {
  return (
    <SvgIcon size={14}>
      <path d="M4 4h7v7H4z" /><path d="M13 4h7v7h-7z" /><path d="M4 13h7v7H4z" /><path d="M13 13h7v7h-7z" />
    </SvgIcon>
  )
}
function IconImage() {
  return (
    <SvgIcon size={14}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
    </SvgIcon>
  )
}
function IconChevronRight() {
  return <SvgIcon size={14}><path d="M9 18l6-6-6-6" /></SvgIcon>
}
function IconSliders() {
  return (
    <SvgIcon size={14}>
      <path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" />
      <path d="M20 21v-5" /><path d="M20 12V3" /><path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" />
    </SvgIcon>
  )
}
function IconKeyboard() {
  return (
    <SvgIcon size={14}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </SvgIcon>
  )
}
function IconMore() {
  return (
    <SvgIcon size={14}>
      <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
    </SvgIcon>
  )
}
function IconSun() {
  return (
    <SvgIcon size={14}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </SvgIcon>
  )
}
function IconClose() {
  return (
    <SvgIcon size={18}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </SvgIcon>
  )
}
function IconChevronDown() {
  return <SvgIcon size={12}><polyline points="6 9 12 15 18 9" /></SvgIcon>
}

/**
 * 「学习容器」主体：中文翻译 + 视图切换 + 注音/结构化句子 + 口语评估条。
 *
 * 这套标记在旧代码里被**两处**几乎重复地拼出来：
 *   · `loadCurrentSentence()` 的学习模式分支
 *   · `renderAnswerReviewContent()`（听写/拼图答对后的复习屏）
 * 两者只在三处不同，所以这里用一个组件 + `variant` 承载，而不是抄两份：
 *   1. 外层类名：学习模式按 `targetSentence.length > 80` 追加 `long-content`
 *      复习屏恒为 `learning-container`。
 * ⚠️ `long-content` 没有任何 CSS 规则（`grep -c` 为 0），
 *      纯 DOM 标记 —— 加上它只为结构对比一致，不影响像素。
 *   2. 结构化容器的字号：学习模式写
 *      `calc(1.5rem * var(--dictation-review-font-scale, 1))`，
 *      复习屏写死 `1.5rem`。
 *   3. 底部「下一句预览」：只在听写/拼图模式的复习屏出现
 *      （守卫条件：模式为 `'dictation'` 或 `'puzzle'`），
 *      学习模式**永远没有**（学习模式不自动推进，由用户点下一句）。
 *      这里用 `showNextPreview` 表达，学习模式传 `false`。
 */
function ReviewScreen({
  sentence, nextSentence, currentIndex, total, showNextPreview, autoNext, trial, trialAvailable, onClaimTrial,
  learningStructure, onToggleLearningStructure,
  variant = "review",
}: {
  sentence: Sentence | null
  nextSentence: Sentence | null
  currentIndex: number
  total: number
  /** 「更多设置」→「下一句预览」；关掉后复习界面不显示底部下一句提示
 * （默认开）。 */
  showNextPreview: boolean
 /** 设置里的「自动下一句」。开着时不渲染内联口语评估条：门槛是
   *  `!autoNextEnabled`，自动跳转下没有回顾停留时间。 */
  autoNext: boolean
  trial: TrialInfo | null
  trialAvailable: boolean
  onClaimTrial: () => void
  /** 复习屏显示语法结构（true）还是注音单词视图（false）。默认 true。 */
  learningStructure: boolean
  onToggleLearningStructure: () => void
  /** `"learning"` 时对齐 `loadCurrentSentence()` 学习模式分支的三处差异
   *  （见本组件顶部注释），`"review"` 时对齐复习屏。 */
  variant?: "review" | "learning"
}) {
  const hasNext = currentIndex + 1 < total
 // 学习模式的长内容类。阈值 80 是写死的。
  const isLongContent = variant === "learning" && (sentence?.english?.length ?? 0) > 80
 // 注音版延后到空闲时机再换（同步注音在 iPad 上
  // 会阻塞主线程 100–400ms），这里先渲纯文本、下一帧再换 —— 用同一套
  // 「先给内容，再补装饰」的顺序，慢设备上不会白屏。
  //
 // 注意判据是 `segments` 而不是 `words`：只要 `english` 非空，`buildAnnotation`
  // 就会产出 segments，`<div class="annotated-sentence">` 也照常渲染；
  // 词表为空时整句并成一个纯文本段。
  // 只有 `english` 本身为空才会走到纯文本分支。
  const annotation = useDeferredValue(buildAnnotation(sentence))
  const hasSentence = annotation.segments.length > 0
  // `enableFallback=false`：复习界面结构与原句对不上也照渲。
  const structure = useDeferredValue(buildStructuredAnswer(sentence, "us", false))
  const hasStructureData = structure.structured
  return (
    <div className={`learning-container${isLongContent ? " long-content" : ""}`}>
      <div className="learning-chinese">{sentence?.chinese || "（无中文翻译）"}</div>

      {/*
 语法结构 / 单词视图切换按钮。只有**有结构数据**时才渲染它
        （`if (hasStructureData)`），且文案与图标随当前模式翻转：
        结构模式 →「切换到单词视图」+ 列表图标；单词模式 →「查看语法结构」+ 宫格图标。
        居中靠 inline style，因为参考 CSS 里**没有** `.view-switch-container` 规则
        （grep 计数 0，只有 JS 里出现）。
      */}
      {hasStructureData && (
        <div className="view-switch-container" style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <button
            type="button"
            className="skip-fragment-btn"
            style={{ fontSize: 12, padding: "4px 12px", display: "inline-flex", alignItems: "center" }}
            onClick={onToggleLearningStructure}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ marginRight: 4, marginBottom: 1 }}
            >
              {learningStructure ? (
                <path d="M4 6h16M4 12h16M4 18h7" />
              ) : (
                <>
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </>
              )}
            </svg>
            {learningStructure ? "切换到单词视图" : "查看语法结构"}
          </button>
        </div>
      )}

      {/*
        主体：结构模式下换成 `.structure-view-wrapper` 里的结构化答案。
 结构模式时**完全替换**掉注音视图，不是并列显示。
        外层 inline style 的 margin 两处一致（12px 0），字号则按 variant 分开：
        复习屏写死 `1.5rem`，学习模式带字号变量
        `calc(1.5rem * var(--dictation-review-font-scale, 1))`
        —— 学习模式跟着「设置 → 字号」缩放，复习屏不跟。这不是笔误。
      */}
      {hasStructureData && learningStructure ? (
        <div
          className="structure-view-wrapper"
          style={{
            fontSize: variant === "learning" ? "calc(1.5rem * var(--dictation-review-font-scale, 1))" : "1.5rem",
            margin: "12px 0",
          }}
        >
          {/*
            复习屏不做聚焦高亮 —— 那时输入框已经不存在了（status === "review"），
 没有 focus 事件可挂。highlightAnswerWord 虽然在复习屏
            也能生效（它只找 `.answer-reveal-panel.show`），但复习屏里那个
            浮层是收起的，实际永远不触发。
          */}
          <StructuredAnswerView answer={structure} />
        </div>
      ) : hasSentence ? (
        <div className="annotated-sentence">
          <div className={`sentence-line${annotation.hasPhonetics ? " has-phonetics" : ""}`}>
            {annotation.segments.map((seg, i) =>
              seg.kind === "plain" ? (
                <span className="sentence-plain" key={`p${i}`}>
                  {seg.pieces.map((piece, j) => {
                    if (piece.kind === "space") return piece.text
                    if (piece.kind === "phonetic" && piece.phonetic) {
                      return (
                        <span className="sentence-word plain-with-phonetic" key={`pw${j}`}>
                          <span className="word-unit-plain">
                            <span className="word-phonetic">{piece.phonetic}</span>
                            <span className="word-text">
                              {piece.query ? (
                                <span className="clickable-word" data-word={piece.query}>
                                  {piece.text}
                                </span>
                              ) : (
                                piece.text
                              )}
                            </span>
                          </span>
                        </span>
                      )
                    }
                    if (piece.query) {
                      return (
                        <span className="clickable-word" data-word={piece.query} key={`pc${j}`}>
                          {piece.text}
                        </span>
                      )
                    }
                    return piece.text
                  })}
                </span>
              ) : (
                <span
                  className={`sentence-word annotated${seg.word.contractionSuffix ? " contraction-suffix" : ""}`}
                  key={seg.word.key}
                >
                  <span className="word-unit" style={seg.word.styleVars as React.CSSProperties}>
                    <span className="word-annotation">
                      <div className="word-chip">
                        <div className="word-translation">{seg.word.chinese}</div>
                      </div>
                    </span>
                    {seg.word.phonetic ? (
                      <div className="word-phonetic">{seg.word.phonetic}</div>
                    ) : annotation.hasPhonetics ? (
                      // 整句有音标但这个词没有 → 输出不可见占位，让中文翻译行对齐。
                      <div className="word-phonetic phonetic-placeholder" aria-hidden="true">
                        &nbsp;
                      </div>
                    ) : null}
                    <span className="word-text">
                      <span className="clickable-word" data-word={seg.word.text}>
                        {seg.word.text}
                      </span>
                    </span>
                    <div className="word-pos-label">{seg.word.posLabel}</div>
                  </span>
                </span>
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="answer-text-plain">{sentence?.english ?? ""}</div>
      )}

      {/*
 内联口语评估入口。门槛：
        `!autoNextEnabled && practiceMode !== 'speaking'`。第一个条件由设置里的
        「自动下一句」决定 —— 开了自动跳转就没有回顾屏停留时间，这条自然不该
        出现。第二个条件在这个组件里**结构上已经满足**：本组件只在
        `status === "review"` 时渲染，而口语模式永远不进 review 态
        （`handleSpeakingAdvance` 只在 `input` / `complete` 之间切），
        所以不必再判一次 mode。
      */}
      {!autoNext && sentence && (
        <InlineSpeakingBar text={sentence.english} sentenceId={sentence.id} />
      )}

      {/*
        单词卡：点击提示浮层/复习屏里的 `.clickable-word` 弹出。
 提示浮层监听的是 document 上的全局 click，
        所以这里渲染位置无所谓 —— 它自己 portal 到 `.practice-shell`
        （不能挂 body：抽取后的样式都收敛在 `.practice-shell` 下）。
        挂载点必须在本组件内，以便拿到当前句的 id 去收藏。
      */}
      <WordDetailCard sentenceId={sentence?.id} />

      {(trial?.truncated || trialAvailable) && (
        <div className="view-switch-container">
          {trialAvailable ? (
            <button type="button" className="skip-fragment-btn" onClick={onClaimTrial}>
              领取 {TRIAL_DAYS} 天体验会员
            </button>
          ) : (
            <a className="skip-fragment-btn" href="/pricing?reason=learn">
              继续学习完整课程
            </a>
          )}
        </div>
      )}

      {/*
 `.grammar-info` 整块只在 `grammarNotes` 存在时才拼出来
        （`if (grammarTags.length > 0)`），标签来自
        `grammarNotes.Tense/Structure/Points`。我们的 `sentences` 表没有
 对应的语法列，所以这里保持「整块不渲染」——与无语法数据时
 的行为一致。此前硬编码的 `答案` 标签是发明出来的，从未被
        `grammarTags.push` 推入（只有那三个来源）。
      */}

      {hasNext && showNextPreview && (
        <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
          {/*
 三处易漏：
            - `data-next-index` 是 0 基下标（`currentSentenceIndex + 1`），
              而 `.nsp-label` 里的数字是 1 基（`currentSentenceIndex + 2`）。
            - `.nsp-enter-hint` 同时有 `title` 和 `aria-label`（同文案）。
            - 有 nextSentence 但没有中文时是「（无中文翻译）」，
              只有 nextSentence 整个缺失才是「下一句数据准备中...」。
          */}
          <div
            className={`next-sentence-preview${nextSentence ? " is-ready" : ""}`}
            data-next-index={currentIndex + 1}
          >
            <div className="nsp-header">
              <span className="nsp-indicator" />
              <span className="nsp-label">即将练习 {currentIndex + 2}/{total}</span>
            </div>
            <div className="nsp-content">
              {nextSentence ? (nextSentence.chinese || "（无中文翻译）") : "下一句数据准备中..."}
            </div>
            <span
              className="nsp-enter-hint"
              title={nextSentence ? "下一句已准备就绪" : "下一句数据准备中"}
              aria-label={nextSentence ? "下一句已准备就绪" : "下一句数据准备中"}
            >↵</span>
          </div>
        </div>
      )}
    </div>
  )
}

function CompletionScreen({
  sentenceCount, elapsedMinutes, accuracy, nextLesson, onNextLesson, onBack,
}: {
  sentenceCount: number
  elapsedMinutes: number
  accuracy: number
  nextLesson: { id: string; title?: string } | null
  onNextLesson: () => void
  onBack: () => void
}) {
  /**
 * 课节完成烟花。
   *
 * 顺序是：先 `currentAudio.pause()` + `currentAudio = null` +
   * `stopAudioVisualizer()` + 退出答案复习模式，**然后**才
   * `triggerCompletionFireworks()`，最后播完成音效。这里同样先掐掉语音，
   * 免得 TTS 拖着「答案复习」的尾音把庆祝盖过去。
   *
 * 注意**不受「答对烟花效果」开关控制**：`triggerCompletionFireworks()`
   * 开头只判 `typeof confetti !== 'function'`，压根不读 `confettiEffectEnabled`
   * —— 那个开关只 gate 答对时的那一发（`createCanvasConfettiEffect`）。
   * 所以这里不要传 `confetti` 进来。
   */
  useEffect(() => {
    stopSpeaking()
    const stop = startCompletionFireworks(6000)
    return () => {
      stop()
      // 画布是模块级单例、挂在 document.body 上，离开完成屏必须回收，
      // 否则残留的粒子会飘到下一句练习上面。
      resetConfetti()
    }
  }, [])

  return (
    <div className="celebration-container">
      <div className="celebration-icon">🎉</div>
      <div className="celebration-title">恭喜完成！</div>
      <div className="celebration-message">
        太棒了！你已经完成该课节的所有练习！
        <br />
        继续保持这样的学习热情！
      </div>
      <div className="celebration-stats">
        <div className="celebration-stat-item">
          <div className="stat-number">{sentenceCount}</div>
          <div className="stat-label">完成句子</div>
        </div>
        <div className="celebration-stat-item">
          <div className="stat-number">{elapsedMinutes}</div>
          <div className="stat-label">用时(分钟)</div>
        </div>
        <div className="celebration-stat-item">
          <div className="stat-number">{accuracy}%</div>
          <div className="stat-label">准确率</div>
        </div>
      </div>
      <div className="celebration-buttons">
        {nextLesson && (
          <button type="button" className="celebration-button next-lesson-btn" onClick={onNextLesson}>
            <span className="btn-icon">▶</span>
            <div className="btn-text">
              <span className="btn-title">继续下一课</span>
              <span className="btn-subtitle">{nextLesson.title}</span>
            </div>
          </button>
        )}
        <button type="button" className="celebration-button secondary-btn" onClick={onBack}>
          返回课程
        </button>
      </div>
      <div className="celebration-shortcuts-hint">
        {nextLesson && <span><kbd>Enter</kbd> 下一课</span>}
        <span><kbd>Space</kbd> 返回课程</span>
      </div>
    </div>
  )
}

function CenteredNotice({ title, hint, onBack }: { title: string; hint?: string; onBack?: () => void }) {
  return (
    <div className="practice-shell" data-theme="dark">
      <div className="cyber-interface">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100dvh", gap: 8 }}>
          <p style={{ fontSize: 14, fontWeight: 500 }}>{title}</p>
          {hint && <p style={{ fontSize: 12, opacity: 0.7 }}>{hint}</p>}
          {onBack && (
            <button type="button" className="dock-btn" onClick={onBack} style={{ marginTop: 8 }}>
              返回课程
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
