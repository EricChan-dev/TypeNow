"use client"

/**
 * 口语跟读模式 —— 逐条对齐现行版本基准实现。
 *
 * ── 它在页面里的位置 ────────────────────────────────────────────────────────
 *
 * 基准实现的练习页只有**一个**外壳： 在 `practiceMode ===
 * 'speaking'` 时执行 `initSpeakingMode(document.getElementById('practiceContent'),
 * currentSentence)` —— 也就是把它自己塞进 `.cyber-main#practiceContent`，顶栏、
 * 底部工具栏、进度条、计时器全部照旧。所以本组件**不重造外壳**，而是作为
 * `DictationPractice` 里 `main#practiceContent` 的内容渲染（见那边的 `mode`
 * 分支）。这一点很重要：另起一个满屏组件会让顶栏/底栏/模式切换器全部消失，
 * 与基准实现完全不同。
 *
 * ── 与基准实现的三处**有意**分歧 ──────────────────────────────────────────────
 *
 * 1. **评测后端换成了有道。** 基准实现走讯飞 ISE 的 WebSocket
 *    （`speaking.js:608 speakingStartRecording` 里 `getSpeakingAuthUrl()` +
 *    `new WebSocket(wsUrl)`，`ssb` 起会话、`auw` 推帧），响应是带 XML 的
 *    `xml_result`。我们没有讯飞凭据，用既有的 `POST /api/youdao/evaluate`
 *    （`lib/pronunciation.ts` 已把响应映射成 0–100 的
 *    总分/准确度/流畅度/完整度 + 逐词分）。因此：
 *      · 不合成 `ssb`/`auw` 帧，直接走 HTTP，录完再评；
 * · 基准实现的 `parseSpeakingWordDetails` 要拆 XML 并把 0–5 的 `total_score`
 *        乘 20，我们拿到的是已经是百分制的结构化 JSON —— 这个差异收敛在
 *        `lib/speaking-score.ts` 的注释里。
 * 可见的**界面与文案**与基准实现逐条对齐，这是「一模一样」的落点。
 *
 * 2. **没有「连接」阶段。** 基准实现要先拿鉴权 URL 再建 WebSocket，所以有一个
 *    真实的 `'connecting'` 状态（`speaking.js:643`）。我们没有连接可建，
 * `'connecting'` 只在「查额度」的这段异步里短暂出现，文案沿用基准实现的
 *    「正在连接服务...」。绝不省略这个状态：省了的话按钮在查额度的空窗里
 *    是可点的，连点会开两次录音。
 *
 * 3. **额度来源换成了自己的只读接口。** 基准实现
 *    `speaking.js:184 refreshSpeakingLimitState` 打 `GET /Ise/Api/CheckLimit`，
 *    我们打 `GET /api/youdao/evaluate/limit`（见该路由的注释：它**只读不消费**，
 * 与 evaluate 路由共用同一个额度桶）。基准实现对合伙人无条件放行
 *    （`speaking.js:123`），我们**不**照抄 —— evaluate 路由只认会员身份，
 *    在这里显示「无限次」而路由照旧 429 就是界面撒谎。
 *
 * ── 为什么录音链路复用了 `lib/recorder.ts` ──────────────────────────────────
 *
 * 音频必须与内联口语条（`InlineSpeakingBar.tsx`）产出**同一种**东西：
 * 16k / 16bit / 单声道 WAV（有道只收这个格式）。重采样、mimeType 协商、
 * 权限诊断这些决定点都已经收在 `lib/recorder.ts` 里，两处各抄一份必然漂移
 * —— 同一句话在两个入口评出不同的分。这里只保留口语模式**独有**的部分：
 * 中央大按钮、声波可视化、VAD 自动停止、评测结果卡片。
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { stopSpeaking } from "@/lib/hooks/useTTSSettings"
import {
  blobToEvaluateWavBase64,
  detectRecordingSupport,
  MAX_RECORD_MS,
  micErrorMessage,
  pickMimeType,
  requestEvaluate,
  REQUEST_TIMEOUT_MS,
} from "@/lib/recorder"
import {
  describeEvaluateFailure,
  isYoudaoSuccess,
  mapYoudaoEvaluate,
  type EvaluateResult,
} from "@/lib/pronunciation"
import {
  buildSpeakingLimitMessage,
  formatSpeakingClock,
  getFeedbackMessage,
  getScoreColor,
  getSpeakingScoreLevel,
  mapEvaluateToSpeakingWords,
  speakingWordStatus,
  type SpeakingWordDetail,
} from "@/lib/speaking-score"
import { playTick } from "@/lib/sfx"

const TAG = "[SpeakingPractice]"

/** 对标页的物理去抖（`_lastToggleTime`），单位毫秒。 */
const TOGGLE_DEBOUNCE_MS = 250
/** 基准实现 `SPEAKING_LIMIT_CACHE_TTL_MS`。 */
const LIMIT_CACHE_TTL_MS = 15_000
/** VAD 三阈值，与 `speakingState` 默认值一致（`speaking.js:36-48`）。 */
const VAD_VOICE_THRESHOLD = 15
const VAD_MIN_RECORD_MS = 1000
const VAD_SILENCE_MS = 1500
/** 声波条数量：基准实现模板里是 `Array(20)`。 */
const VISUALIZER_BARS = 20
/** 条高区间：基准实现 `updateSpeakingVisualizerBars`是 4/60。 */
const BAR_MIN_HEIGHT = 4
const BAR_MAX_HEIGHT = 60

type Status = "idle" | "connecting" | "recording" | "processing"

interface LimitState {
  allowed: boolean
  used: number
  maxCount: number
  remaining: number
  message: string
  needUpgrade: boolean
}

/**
 * 拉取额度。**纯函数、不碰 React state** —— 模块级而不是组件内。
 *
 * 拆出来是为了绕开 `react-hooks/set-state-in-effect`：那条规则会**穿透**
 * 被调用的函数去追 `setState`，所以只要挂载 effect 直接调用一个内部
 * `setLimit` 的 `refreshLimit`，就会被判成「在 effect 体内同步 setState」。
 * 把「取数据」与「落状态」分开后，effect 里只剩 `promise.then(落状态)`，
 * 落状态发生在回调里、不在 effect 体内，规则与运行时语义都干净：
 * 首帧先渲染「未知额度」，数据回来再补 —— 这本就是外部系统订阅该有的样子。
 */
async function fetchEvaluateLimit(): Promise<LimitState | null> {
  try {
    const res = await fetch("/api/youdao/evaluate/limit")
    if (!res.ok) return null
    const data = (await res.json()) as Partial<LimitState>
    return {
      allowed: data.allowed !== false,
      used: Number(data.used ?? 0),
      maxCount: Number(data.maxCount ?? 0),
      remaining: Number(data.remaining ?? 0),
      message: typeof data.message === "string" ? data.message : "",
      needUpgrade: data.needUpgrade === true,
    }
  } catch (err) {
    console.error(`${TAG} 查询评测额度失败:`, err)
    return null
  }
}

export function SpeakingPractice({
  text,
  translation,
  sentenceId,
  onResult,
  onAdvance,
}: {
 /** 当前句英文原文（基准实现 `sentenceData.originalText`）。 */
  text: string
 /** 当前句中文翻译；为空时**整块不渲染**（基准实现模板里的三目）。 */
  translation: string
  /** 练习项 id，透传给评分的落库字段。 */
  sentenceId: string
  /**
   * 评测成功回调。分数阈值（≥70 记完成 / ≥80 成功音效）由父组件判定 ——
   * 那两个阈值牵动的是进度上报与用户偏好（彩蛋开关），不属于本组件的职责。
   */
  onResult: (score: number) => void
 /** Enter 切下一句（对标页的 `enter-speaking` 分支）。 */
  onAdvance: () => void
}) {
  const [status, setStatus] = useState<Status>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<EvaluateResult | null>(null)
  const [words, setWords] = useState<SpeakingWordDetail[] | null>(null)
  /**
   * 三个维度条的宽度**延迟 100ms** 才落值。
   *
 * 基准实现是 `setTimeout(() => updateSpeakingScoreBar(...), 100)`
   * （`speaking.js:940`）。这不是随手写的延迟：`.progress-fill` 带
   * `transition: width 1s ease`，而卡片与它是同时从 `display:none` 变为可见的。
   * 同一帧里既显示又设宽度，浏览器会把起始宽度当成目标宽度、**不做过渡** ——
   * 用户看到的是三条瞬间填满的进度条，而不是从 0 涨上去。
   */
  const [barScores, setBarScores] = useState<{
    accuracy: number | null
    fluency: number | null
    integrity: number | null
  } | null>(null)
  const [limit, setLimit] = useState<LimitState | null>(null)

  // ── refs ──────────────────────────────────────────────────────────────────
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  /** 卸载或重开时置位：让 onstop 知道这次录音已作废，不要发起评分。 */
  const discardRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastToggleRef = useRef(0)
  const spaceDownRef = useRef(false)
  const statusRef = useRef<Status>("idle")

  // 频谱 + VAD
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const barsRef = useRef<HTMLDivElement | null>(null)
  const startTimeRef = useRef(0)
  const vadLastVoiceRef = useRef(0)
  const vadDetectedRef = useRef(false)

 // 额度缓存（基准实现 `speakingLimitState` + `timestamp`）
  const limitRef = useRef<LimitState | null>(null)
  const limitAtRef = useRef(0)

  const support = useRef(detectRecordingSupport()).current

  useEffect(() => {
    statusRef.current = status
  }, [status])

  // ── 额度查询（只读，不消费） ────────────────────────────────────────────────
  const refreshLimit = useCallback(async (force: boolean): Promise<LimitState | null> => {
    const now = Date.now()
    if (!force && limitRef.current && now - limitAtRef.current < LIMIT_CACHE_TTL_MS) {
      return limitRef.current
    }
    const next = await fetchEvaluateLimit()
    if (!next) return null
    limitRef.current = next
    limitAtRef.current = Date.now()
    setLimit(next)
    return next
  }, [])

  useEffect(() => {
    let alive = true
    void fetchEvaluateLimit().then((next) => {
      if (!alive || !next) return
      limitRef.current = next
      limitAtRef.current = Date.now()
      setLimit(next)
    })
    return () => {
      alive = false
    }
  }, [])

  // ── 频谱 / VAD ────────────────────────────────────────────────────────────
  const resetBars = useCallback(() => {
    const bars = barsRef.current?.children
    if (!bars) return
    for (let i = 0; i < bars.length; i++) {
      ;(bars[i] as HTMLElement).style.height = `${BAR_MIN_HEIGHT}px`
    }
  }, [])

  /**
   * 停掉可视化并**释放麦克风**。录音与频谱共用同一个 MediaStream，
   * 所以两者必须一起收尾，否则麦克风指示灯会一直亮着。
   */
  const stopVisualization = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current)
      tickTimerRef.current = null
    }
    analyserRef.current = null
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) void ctx.close().catch(() => {})
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    resetBars()
  }, [resetBars])

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state === "recording") {
      try {
        rec.stop()
      } catch {
        /* 已经停了 */
      }
    }
  }, [])

  const clearTimers = useCallback(() => {
    if (capTimerRef.current) {
      clearTimeout(capTimerRef.current)
      capTimerRef.current = null
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current)
      tickTimerRef.current = null
    }
  }, [])

  // ── 开始录音 ──────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!support.ok) {
      toast.error(support.reason ?? "此浏览器不支持录音")
      return
    }

    // 互斥：参考音必须先停。否则扬声器外放会被麦克风采进去，评出虚高的分。
    stopSpeaking()

 // 查额度。用缓存（15s）—— 与基准实现 ensureSpeakingLimitBeforeStart 一致。
    // 「connecting」这个状态是必须的：不加的话按钮在 await 期间仍可点，
    // 连点会开出第二路录音而第一路的 onstop 没人接。
    setStatus("connecting")
    const state = await refreshLimit(false)
    if (statusRef.current !== "connecting") return // 期间被取消/卸载
    if (state && !state.allowed) {
      setStatus("idle")
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch (err) {
      // 需要 await：要读一次站点权限状态才能判断到底是「站点被拒」
      // 还是「站点已允许、系统层面拦住了」。
      const msg = await micErrorMessage(err, TAG)
      setStatus("idle")
      toast.error(msg)
      return
    }

    const mime = pickMimeType()
    let recorder: MediaRecorder
    try {
      // 协商出来的 mimeType 才传，拿不到就让浏览器用默认容器，而不是硬编码
      // 一个该浏览器不支持的（Safari 会直接抛错）。
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch (err) {
      console.error(`${TAG} MediaRecorder 构造失败:`, err)
      stream.getTracks().forEach((t) => t.stop())
      setStatus("idle")
      toast.error("此浏览器不支持录音，请在电脑上用 Chrome / Edge 练习。")
      return
    }

    streamRef.current = stream
    recorderRef.current = recorder
    chunksRef.current = []
    discardRef.current = false

 // 重新开录：清掉上一轮的结果与逐词标注（基准实现 `resetSentenceDisplay()`，
    // `speaking.js:641`；同时把结果卡片 `display:none`）。
    setResult(null)
    setWords(null)
    setBarScores(null)

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      clearTimers()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (discardRef.current) {
        stopVisualization()
        return
      }

      if (chunksRef.current.length === 0) {
        stopVisualization()
        setStatus("idle")
        toast.error("没有录到声音，请确认麦克风可用后重试。")
        return
      }

      setStatus("processing")
      const controller = new AbortController()
      abortRef.current = controller
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" })
        let wav: string
        try {
          wav = await blobToEvaluateWavBase64(blob)
        } catch (err) {
          console.error(`${TAG} 音频转码失败:`, err)
          toast.error("录音格式无法处理，请更新浏览器后重试。")
          return
        }

        const outcome = await requestEvaluate(wav, text, sentenceId, controller.signal)
        if (!outcome.ok) {
          const view = describeEvaluateFailure(outcome.status, outcome.payload, {
            timedOut: outcome.timedOut,
          })
          toast.error(`${view.title}：${view.detail}`)
          return
        }
        // 服务端成功分支直接回 `EvaluateResult`。仍然过一遍 `mapYoudaoEvaluate`：
        // 万一路由以后改成透传有道原始响应，这里能识别而不是渲染出一堆 undefined。
        const mapped = isYoudaoSuccess(outcome.data) ? mapYoudaoEvaluate(outcome.data) : null
        const data = mapped ?? (outcome.data as EvaluateResult)

        setResult(data)
        setWords(mapEvaluateToSpeakingWords(data))
 // 逐词分与三个维度条在基准实现里是分两步落的：句子先换成带标注的版本，
        // 100ms 后进度条才涨上去（见 barScores 的注释）。
        setTimeout(() => {
          setBarScores({
            accuracy: data.accuracy,
            fluency: data.fluency,
            integrity: data.integrity,
          })
        }, 100)

        if (data.score >= 80) toast.success(`发音评分 ${data.score} 分`, { duration: 2000 })
        // 阈值判定交给父组件（≥70 记完成 / ≥80 成功音效）。
        onResult(data.score)
      } catch (err) {
        console.error(`${TAG} 评测失败:`, err)
        const view = describeEvaluateFailure(null, null)
        toast.error(`${view.title}：${view.detail}`)
      } finally {
        clearTimeout(timeoutId)
        abortRef.current = null
        stopVisualization()
        setStatus("idle")
        // 刚消费掉一次额度，强制重查 —— 命中最后一次时卡片要立刻出现。
        void refreshLimit(true)
      }
    }

    recorder.start()
    setStatus("recording")
    setElapsed(0)
    startTimeRef.current = Date.now()
    vadLastVoiceRef.current = Date.now()
    vadDetectedRef.current = false

 // 开录提示音。基准实现播 `/audio/beep-329314.mp3`（gain 0.5，
    // `speaking.js:1292`）—— 那个文件不存在，用 sfx 合成。
    playTick()

    /*
      ⚠️ 计时器必须在**任何 await 之前**武装。
      `startRecording` 是 async 的，下面那段 WebAudio 初始化里有 await
      （`ctx.resume()`）；一旦它不 settle（headless 或没有用户手势上下文时
      就会这样），函数后半段永远不执行 —— 包括这里的 10 秒保底停录。
      实测过：探针里录音跑了 30 秒以上都没被截停。
      保底计时器是「麦克风不会一直开着」的最后一道闸，它不能排在任何可能
      挂起的 await 后面。
    */
    tickTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    capTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORD_MS)

    // 频谱 + VAD。合并成一个 rAF 循环：两者都要读 analyser，分成两个循环
    // 会在同一帧里读两次、还各自维护自己的 rAF id。
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioCtor) {
      try {
        const ctx = new AudioCtor()
        // **不 await**：`resume()` 在没有用户手势上下文时可能永不 settle，
        // 而那会把整个 startRecording 卡死（录音已经在跑了，只是频谱起不来）。
        // 频谱只是装饰，不值得赌上一个挂起的 promise。
        if (ctx.state === "suspended") void ctx.resume().catch(() => {})
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)
        audioCtxRef.current = ctx
        analyserRef.current = analyser

        const data = new Uint8Array(analyser.frequencyBinCount)
 // 基准实现 `updateSpeakingVisualizerBars`的取点口径：
        // 只用前半段频谱（`length / 2`），等距取样。
        const usableLength = Math.floor(data.length / 2)
        const step = Math.max(1, Math.floor(usableLength / VISUALIZER_BARS))

        const animate = () => {
          const a = analyserRef.current
          if (!a) return
          a.getByteFrequencyData(data)

          const bars = barsRef.current?.children
          if (bars) {
            for (let i = 0; i < bars.length; i++) {
              const val = data[i * step] ?? 0
              ;(bars[i] as HTMLElement).style.height = `${Math.max(
                BAR_MIN_HEIGHT,
                (val / 255) * BAR_MAX_HEIGHT,
              )}px`
            }
          }

          // VAD：检测到人声就刷新时间戳；此后静音超过阈值即认为读完了。
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          const avg = sum / data.length
          const now = Date.now()
          if (avg > VAD_VOICE_THRESHOLD) {
            vadLastVoiceRef.current = now
            vadDetectedRef.current = true
          }
          if (
            vadDetectedRef.current &&
            now - startTimeRef.current > VAD_MIN_RECORD_MS &&
            now - vadLastVoiceRef.current > VAD_SILENCE_MS
          ) {
 // 基准实现先置状态再停录音，文案也一致。
            setStatus("processing")
            stopRecording()
            return
          }
          rafRef.current = requestAnimationFrame(animate)
        }
        rafRef.current = requestAnimationFrame(animate)
      } catch (err) {
        // 频谱只是装饰，拿不到 analyser 不该让录音失败。
        console.error(`${TAG} 频谱初始化失败:`, err)
      }
    }
  }, [
    clearTimers,
    onResult,
    refreshLimit,
    sentenceId,
    stopRecording,
    stopVisualization,
    support,
    text,
  ])

  const toggle = useCallback(() => {
    const now = Date.now()
    if (now - lastToggleRef.current < TOGGLE_DEBOUNCE_MS) return
    lastToggleRef.current = now

    if (statusRef.current === "recording") {
      stopRecording()
      return
    }
    if (statusRef.current === "connecting" || statusRef.current === "processing") return
    void startRecording()
  }, [startRecording, stopRecording])

  // ── 键盘：Space 开关录音、Enter 切下一句 ────────────────────────────────────
  //
 // 基准实现是两个监听： handleSpeakingSpaceKey` 管空格，
  // `practice.js:5861` 管 Enter。两处都跳过输入框、都要求没有其它修饰键。
  // Enter 的守卫尤其重要 —— 录音/连接中切句会让评测结果挂到下一句上。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return

      if (e.key === "Enter") {
        if (statusRef.current === "recording" || statusRef.current === "connecting") return
        e.preventDefault()
        onAdvance()
        return
      }
      if (e.code !== "Space") return
      e.preventDefault()
      if (e.repeat || spaceDownRef.current) return
      spaceDownRef.current = true
      toggle()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDownRef.current = false
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("keyup", onKeyUp)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("keyup", onKeyUp)
    }
  }, [onAdvance, toggle])

  // 卸载即释放麦克风。少了这段，录着音切模式/退出页面，麦克风会一直被占用。
  useEffect(() => {
    return () => {
      discardRef.current = true
      clearTimers()
      abortRef.current?.abort()
      const rec = recorderRef.current
      if (rec && rec.state === "recording") {
        try {
          rec.stop()
        } catch {
          /* 已经停了 */
        }
      }
      stopVisualization()
    }
  }, [clearTimers, stopVisualization])

  // ── 派生展示状态 ──────────────────────────────────────────────────────────
  const busy = status === "connecting" || status === "processing"
  const showFullLimit = limit !== null && !limit.allowed && !busy
  const total = result ? Math.round(result.score) : null
  const level = result ? getSpeakingScoreLevel(result.score) : null
  const showWords = words !== null && words.length > 0

  const hint = showFullLimit
    ? "今日评测次数已用完"
    : status === "recording"
      ? "请开始朗读..."
      : status === "processing"
        ? "评测中..."
        : status === "connecting"
          ? "正在连接服务..."
          : result
            ? "点击重新录音"
            : "点击或按空格键开始"
 // 基准实现 order：updateSpeakingStatus 先写 `speaking-hint <status>`，
  // 随后 updateSpeakingLimitUI 在额度耗尽时改写为 `speaking-hint limit-exhausted`。
  const hintClass = showFullLimit ? "speaking-hint limit-exhausted" : `speaking-hint ${status}`

  const dim = (v: number | null | undefined) => {
    if (barScores === null || v === null || v === undefined) return { width: "0%", value: "-" }
    return { width: `${v}%`, value: String(Math.round(v)) }
  }
  const accuracy = dim(barScores?.accuracy)
  const fluency = dim(barScores?.fluency)
  const integrity = dim(barScores?.integrity)

  return (
    /*
 `.centered-layout` 在基准实现 CSS 里**零定义**（死类名），对齐是为了
      DOM 对比时类名列表一致。
    */
    <div className="speaking-mode-container centered-layout">
      {/* ── 句子显示区域 ─────────────────────────────────────────────────── */}
      <div className="speaking-sentence-wrapper">
        <div
          className={`speaking-sentence-content${showWords ? " evaluated" : ""}`}
          id="speakingSentenceWords"
        >
          {showWords ? (
            words.map((w, i) => (
              <span
                className={`speaking-word ${speakingWordStatus(w.totalScore, w.isMissing)}`}
                key={`${w.content}-${i}`}
              >
                <span className="word-text">{w.content}</span>
                <span className="word-score">
                  {w.isMissing ? "漏读" : Math.round(w.totalScore)}
                </span>
              </span>
            ))
          ) : (
            <span className="speaking-sentence-text">{text}</span>
          )}
        </div>
 {/* 有翻译才渲染这一行 —— 基准实现模板里是 `${translation ? … :''}`。 */}
        {translation ? <div className="speaking-translation fade-in">{translation}</div> : null}
      </div>

      {/*
        交互区：三个子块**必须同时在 DOM 里**，可见性靠行内 `display` 翻转。
        移植过来的 CSS 里 `.speaking-visualizer-container`（practice.css:3981）、
        `.speaking-feedback-card`（:4145）、`.speaking-limit-card`（:4086）
        **基础态就是 `display:flex`、且没有 `.show` 类** —— 一旦条件渲染，
 可见/不可见的语义就与基准实现反了。
      */}
      <div className="speaking-interaction-area">
        {/* 1. 录音中：声波 + 计时 */}
        <div
          className="speaking-visualizer-container"
          id="speakingVisualizerContainer"
          style={{ display: status === "recording" ? "flex" : "none" }}
        >
          <div className="speaking-visualizer-bars" id="speakingVisualizerBars" ref={barsRef}>
            {Array.from({ length: VISUALIZER_BARS }, (_, i) => (
              <div className="speaking-bar" key={i} />
            ))}
          </div>
          <div className="speaking-timer" id="speakingVisualizerTimer">
            {formatSpeakingClock(elapsed)}
          </div>
        </div>

        {/* 2. 评测结果卡片 */}
        <div
          className="speaking-feedback-card"
          id="speakingFeedbackCard"
          style={{ display: result ? "flex" : "none" }}
        >
          <div className="feedback-header">
            <div className="feedback-score-ring">
              <svg viewBox="0 0 36 36" className="circular-chart">
                <path
                  className="circle-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                {/*
 基准实现把 `stroke-dasharray` 与 `stroke` 都写在行内
                  （`speaking.js:936`）。颜色走 CSS 变量，不能用
                  `lib/pronunciation.ts` 的 `scoreColor()`（那是硬编码 hex，
                  浅色主题下会是看不清的霓虹）。
                */}
                <path
                  className="circle"
                  id="feedbackScoreCircle"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  style={
                    result
                      ? {
                          strokeDasharray: `${result.score}, 100`,
                          stroke: getScoreColor(result.score),
                        }
                      : { strokeDasharray: "0, 100" }
                  }
                />
              </svg>
              <div className="score-text" id="speakingTotalScore">
                {total ?? "--"}
              </div>
            </div>
            <div className="feedback-summary">
              <div
                className={`feedback-level${level ? ` ${level.className}` : ""}`}
                id="speakingScoreLevel"
              >
                {level?.text ?? "--"}
              </div>
              <div className="feedback-msg" id="speakingFeedbackMsg">
                {result ? getFeedbackMessage(result.score) : "继续加油"}
              </div>
            </div>
          </div>

          <div className="feedback-metrics">
            <div className="metric-item">
              <span className="label">准确度</span>
              <div className="progress-bg">
                <div
                  className="progress-fill"
                  id="speakingAccuracyFill"
                  style={{ width: accuracy.width }}
                />
              </div>
              <span className="value" id="speakingAccuracyScore">
                {accuracy.value}
              </span>
            </div>
            <div className="metric-item">
              <span className="label">流畅度</span>
              <div className="progress-bg">
                <div
                  className="progress-fill"
                  id="speakingFluencyFill"
                  style={{ width: fluency.width }}
                />
              </div>
              <span className="value" id="speakingFluencyScore">
                {fluency.value}
              </span>
            </div>
            <div className="metric-item">
              <span className="label">完整度</span>
              <div className="progress-bg">
                <div
                  className="progress-fill"
                  id="speakingIntegrityFill"
                  style={{ width: integrity.width }}
                />
              </div>
              <span className="value" id="speakingIntegrityScore">
                {integrity.value}
              </span>
            </div>
          </div>
        </div>

        {/* 3. 额度用尽卡片 */}
        <div
          className="speaking-limit-card"
          id="speakingLimitCard"
          style={{ display: showFullLimit ? "flex" : "none" }}
        >
          <div className="speaking-limit-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 7v5" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <div className="speaking-limit-copy">
            <div className="speaking-limit-title" id="speakingLimitTitle">
              今日评测次数已用完
            </div>
            <div className="speaking-limit-message" id="speakingLimitMessage">
              {limit
                ? buildSpeakingLimitMessage({
                    message: limit.message,
                    currentCount: limit.used,
                    maxCount: limit.maxCount,
                  })
                : "明天 00:00 后恢复评测次数。"}
            </div>
          </div>
          {/*
 基准实现指向 `/User/Upgrade`，本仓库的会员中心是 `/home/membership`。
            照抄那个 URL 会 404 —— 文案与位置照抄，路由必须落到我们自己的页面。
          */}
          <a
            className="speaking-limit-action"
            id="speakingLimitAction"
            href="/home/membership"
            style={{ display: limit?.needUpgrade ? "inline-flex" : "none" }}
          >
            升级获取更多次数
          </a>
        </div>
      </div>

      {/* ── 控制按钮 ─────────────────────────────────────────────────────── */}
      <div className="speaking-controls">
        <button
          type="button"
          className={`speaking-main-btn${status === "recording" ? " recording" : ""}${
            showFullLimit ? " limit-exhausted" : ""
          }`}
          id="speakingMainBtn"
          title={limit && !limit.allowed ? limit.message : "开始口语评测"}
          disabled={busy}
          style={{ cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}
          onClick={toggle}
        >
          <div className="mic-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
        </button>
        <div className={hintClass} id="speakingStatusText">
          {hint}
        </div>
      </div>
    </div>
  )
}
