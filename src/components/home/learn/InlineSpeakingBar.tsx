"use client"

/**
 * 内联口语评估条 + 评测弹窗。
 *
 * ── 是什么 ──────────────────────────────────────────────────────────────────
 *
 * 基准实现答案回顾屏上那条「口语评估 · 点击或按空格键」的胶囊入口，以及点开后的
 * 评测弹窗。听写模式下它**是可见的** —— 门槛是
 * `!autoNextEnabled && practiceMode !== 'speaking'`（`practice.js:4851`），
 * 而我们的 自动下一句 默认就是 off（`lib/practice-prefs.ts` 的 `loadAutoNext`
 * 读 `=== "on"`，默认 false）。
 *
 * ── 与基准实现的两处**有意**分歧 ──────────────────────────────────────────────
 *
 * 1. **评测后端换成了有道。** 基准实现走讯飞 ISE 的 WebSocket
 *    （`speaking.js:1460 new RecorderManager("/js/ise")`，`ssb` 起会话、`auw`
 *    推帧）。我们没有讯飞凭据，用的是既有的 `POST /api/youdao/evaluate`
 *    （有道的语音评测，`lib/pronunciation.ts` 已把响应映射成 0–100 的
 *    总分/准确度/流畅度/完整度）。因此：
 *      · 不合成 `ssb`/`auw` 帧，直接走 HTTP；
 * · 基准实现的 `handleInlineResult` 要 `atob` 再 XML 解析，我们拿到的是
 *        已经是结构化 JSON。
 * 可见的**界面与文案**与基准实现逐条对齐，这是「一模一样」的落点。
 *
 * 2. **弹窗用 portal 挂到 `.practice-shell` 上，而不是就地渲染。**
 * 基准实现是 `document.body.appendChild(modal)`。
 *    我们不能挂 body：`practice.css` 全部收敛在 `.practice-shell` 下
 *    （生成器 `scripts/extract-practice-css.py`），挂到 body 会一条 `.isp-*`
 *    都命中不了、CSS 变量（`--score-excellent` 等）也解析不到。
 *    但也**不能就地渲染** —— 这条是实测出来的坑：
 *    `.learning-container` 带着 `animation: fadeInUp 0.5s ease forwards`
 *    （`practice-cyber.css:3652`，收尾帧 `transform: translateY(0)`），
 *    `forwards` 让它**永久保留** `transform: matrix(1,0,0,1,0,0)` —— 非 none，
 *    于是它成了 `position: fixed` 后代的 containing block。
 *    实测 375 下 overlay 的 rect 是 `x:60 w:405`（= `.learning-container` 的盒子）
 *    而不是 `x:0 w:375`（视口）；1440 下则是 `w:1100`，左右各留 170px 缺口 ——
 *    遮罩根本盖不满屏，`.isp-modal` 也被按 `width: 90%` 算到了那个窄盒子上。
 *    所以挂到 `.practice-shell`：它自身 `transform: none`（已实测），
 *    `position: fixed` 仍以视口为 containing block，`overflow: hidden` 不裁剪它。
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
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
  type EvaluateWordScore,
} from "@/lib/pronunciation"

/** 日志前缀（与 `lib/recorder` 的 `tag` 参数配套）。 */
const TAG = "[InlineSpeaking]"

/**
 * 空格键的物理去抖。与基准实现同一个值（
 * `if (now - _lastToggleTime < 250) return`）。
 *
 * 为什么需要：空格**按住不放**时会连续触发 keydown（`e.repeat` 只挡掉了
 * 自动重复，挡不住「松开又立刻按下」的物理抖动），而开录音要过权限与
 * 建连接，两次并发调用会让状态机自相矛盾。250ms 是基准实现实测的阈值。
 */
const TOGGLE_DEBOUNCE_MS = 250

/** 弹窗打开后自动开录的延迟（对标页的 300ms）。 */
const AUTO_START_DELAY_MS = 300

/** 频谱条数量。**是 12 还是 16 取决于组件**：入口条 12、弹窗 16（基准实现
 *  `practice.js:4823` vs `speaking.js:1604`），别把两处写成同一个常量。 */
const BAR_VISUALIZER_BARS = 12
const MODAL_VISUALIZER_BARS = 16

/** 频谱条高度：`Math.max(3, (val/255)*40)`（`speaking.js:2018`）。 */
const VIS_BAR_MIN_HEIGHT = 3
const VIS_BAR_MAX_HEIGHT = 40

/**
 * 静音自动停录（基准实现的 VAD，）。
 *
 * 三个常量一起决定「什么时候认为用户读完了」：至少要录满
 * `VAD_MIN_RECORD_MS`，且距最后一次检测到人声超过 `VAD_SILENCE_MS`。
 * 没有这段，用户读完还得手动按一次空格，而弹窗上写的是「正在聆听...」。
 */
const VAD_VOICE_THRESHOLD = 15
const VAD_MIN_RECORD_MS = 1000
const VAD_SILENCE_MS = 1500

/** 分数等级。文案是英文，与基准实现一致。 */
function scoreLevel(score: number): string {
  if (score >= 90) return "Outstanding"
  if (score >= 80) return "Excellent"
  if (score >= 60) return "Good"
  return "Keep Trying"
}

/**
 * 分数→颜色。
 *
 * 这里**不用** `lib/pronunciation` 的 `scoreColor`：那个返回的是具体色值
 * （`#22c55e`…），而基准实现的 `.isp-*` 弹窗用的是 CSS 变量
 * （`var(--score-excellent)`，`speaking.js:972-977`），浅色主题下会自动换成
 * 另一组值。两套色表本来就该分开 —— 混用会让弹窗在浅色主题下颜色错位。
 */
function ringColor(score: number): string {
  if (score >= 90) return "var(--score-excellent)"
  if (score >= 80) return "var(--score-good)"
  if (score >= 60) return "var(--score-fair)"
  return "var(--score-poor)"
}

/** 评语（`speaking.js:979-985`）。 */
function feedbackMessage(score: number): string {
  if (score >= 90) return "发音完美，甚至超越了原音！"
  if (score >= 80) return "发音清晰，非常地道！"
  if (score >= 70) return "不错，继续保持！"
  if (score >= 60) return "勉强及格，多加练习。"
  return "请大声一点，或者再多听几遍原音。"
}

/**
 * 逐词状态。
 *
 * 基准实现按讯飞的 `dp_message === 1` 判「漏读」，我们的
 * 有道映射器不产出这个字段 —— 漏读信息只体现在 `integrity`（完整度）上。
 * 所以这里**不发明**漏读判定，只按分数归档，且 `null` 分数保持中性：
 * 那是「有道没给这个字段」，不是「读错了」（`lib/pronunciation.ts` 的
 * `EvaluateWordScore.score` 明确区分这两者）。
 */
function wordStatus(w: EvaluateWordScore): string {
  if (w.score === null) return ""
  if (w.score < 60) return "error"
  if (w.score < 80) return "warning"
  return "correct"
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")
  return `${m}:${s}`
}

export function InlineSpeakingBar({
  text,
  sentenceId,
}: {
 /** 要朗读的句子（基准实现的 `inlineSpeakingState.text`）。 */
  text: string
  /**
   * 落库用的**练习项 id**：原句 id，或分块句展开后的 `<原句 id>_c<order>`。
   * 不能在这里改写成原句 id —— 一句多个分块各有各的分行，改写会让后录的
   * 覆盖先录的（同一约定见 `VoicePanel.tsx` 与 evaluate 路由的 `isPracticeItemId`）。
   */
  sentenceId: string
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<"idle" | "connecting" | "recording" | "processing">("idle")
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<EvaluateResult | null>(null)
  const [failure, setFailure] = useState<{ title: string; detail: string; canRetry: boolean } | null>(
    null,
  )
  /**
   * 弹窗的 portal 宿主 = `.practice-shell`。
   *
   * 不能就地渲染（会被 `.learning-container` 的 `transform` 困住，见文件头注释），
   * 也不能挂 `document.body`（`.isp-*` 样式与 CSS 变量都在 `.practice-shell` 下）。
   * 必须等挂载后才能查 DOM，所以用 state 而**不是** `useMemo` —— `useMemo` 在
   * 首次渲染时 `document` 可能还查不到 `.practice-shell`，且不会自我纠正。
   */
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)

  // ── 录音机与频谱 ────────────────────────────────────────────────────────
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  /** 卸载/关闭弹窗时置位：让 onstop 知道这次录音已作废，不要发起评分。 */
  const discardRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoStartRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 弹窗打开时置位，空格键按下会清掉它，避免「按了空格又开始自动录」。 */
  const autoStartPendingRef = useRef(false)
 /** 空格键物理去抖与「按住不放」标记（基准实现 `_lastToggleTime` /
   *  `inlineSpeakingSpacePressed`，`speaking.js:1449`/`:1517`）。 */
  const lastToggleRef = useRef(0)
  const spaceDownRef = useRef(false)

  // 频谱
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const visBarsRef = useRef<HTMLDivElement | null>(null)
 /** VAD 状态（基准实现 `vadLastVoiceTime` / `vadHasDetectedVoice`）。 */
  const vadLastVoiceRef = useRef(0)
  const vadDetectedRef = useRef(false)
  const startTimeRef = useRef(0)

  const support = useRef(detectRecordingSupport()).current

  const stopVisualization = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) void ctx.close().catch(() => {})
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
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
    if (autoStartRef.current) {
      clearTimeout(autoStartRef.current)
      autoStartRef.current = null
    }
  }, [])

  const finish = useCallback(
    (view: { title: string; detail: string; canRetry: boolean } | null, data?: EvaluateResult) => {
      setFailure(view)
      setResult(data ?? null)
      setPhase("idle")
    },
    [],
  )

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

  const startRecording = useCallback(async () => {
    if (!support.ok) {
      toast.error(support.reason ?? "此浏览器不支持录音")
      return
    }

    // 互斥：参考音必须先停。否则扬声器外放会被麦克风采进去，评出虚高的分
    // —— 那会让基于分数的判断全部失真。
    stopSpeaking()
    setFailure(null)
    setResult(null)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch (err) {
      // 需要 await：要读一次站点权限状态才能判断到底是"站点被拒"还是
      // "站点已允许、系统层面拦住了"
      const msg = await micErrorMessage(err, TAG)
      finish({ title: "无法访问麦克风", detail: msg, canRetry: true })
      return
    }

    const mime = pickMimeType()
    let recorder: MediaRecorder
    try {
      // 协商出来的 mimeType 才传；拿不到就让浏览器用默认容器，
      // 而不是硬编码一个该浏览器不支持的（Safari 会直接抛错）
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch (err) {
      console.error(`${TAG} MediaRecorder 构造失败:`, err)
      stream.getTracks().forEach((t) => t.stop())
      finish({
        title: "此浏览器不支持录音",
        detail: "请在电脑上用 Chrome / Edge 练习。",
        canRetry: false,
      })
      return
    }

    streamRef.current = stream
    recorderRef.current = recorder
    chunksRef.current = []
    discardRef.current = false

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      clearTimers()
      // 频谱与麦克风一起释放，但**流要留着**让 onstop 之后再收尾
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
        finish({
          title: "没有录到声音",
          detail: "请确认麦克风可用、对着它读完这句再试。",
          canRetry: true,
        })
        return
      }

      setPhase("processing")
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
          finish({
            title: "录音格式无法处理",
            detail: "请更新浏览器后重试，或改用电脑版 Chrome / Edge。",
            canRetry: true,
          })
          return
        }

        const outcome = await requestEvaluate(wav, text, sentenceId, controller.signal)
        if (!outcome.ok) {
          finish({
            ...describeEvaluateFailure(outcome.status, outcome.payload, {
              timedOut: outcome.timedOut,
            }),
          })
          return
        }
        // 服务端在成功分支直接回 `EvaluateResult`（落库时额外带 comment/saved）。
        // 仍然过一遍 `mapYoudaoEvaluate`：路由是唯一写入方，但万一它以后改成
        // 透传有道原始响应，这里能识别出来而不是渲染出一堆 undefined。
        const mapped = isYoudaoSuccess(outcome.data) ? mapYoudaoEvaluate(outcome.data) : null
        const data = mapped ?? (outcome.data as EvaluateResult)
        setResult(data)
        setFailure(null)
        setPhase("idle")
        if (data.score >= 80) toast.success(`发音评分 ${data.score} 分`, { duration: 2000 })
      } catch (err) {
        console.error(`${TAG} 评测失败:`, err)
        finish({
          ...describeEvaluateFailure(null, null),
        })
      } finally {
        clearTimeout(timeoutId)
        abortRef.current = null
        stopVisualization()
      }
    }

    recorder.start()
    setPhase("recording")
    setElapsed(0)
    startTimeRef.current = Date.now()
    vadLastVoiceRef.current = Date.now()
    vadDetectedRef.current = false

    // 频谱 + VAD。合并成一个 rAF 循环：两者都要读 analyser，分成两个循环
    // 会让同一帧里读两次、还各自维护自己的 rAF id。
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioCtor) {
      try {
        const ctx = new AudioCtor()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)
        audioCtxRef.current = ctx
        analyserRef.current = analyser

        const data = new Uint8Array(analyser.frequencyBinCount)
        const animate = () => {
          const a = analyserRef.current
          if (!a) return
          a.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          const avg = sum / data.length

          const bars = visBarsRef.current?.children
          if (bars) {
            for (let i = 0; i < bars.length; i++) {
              const val = data[Math.floor((i * data.length) / bars.length)] ?? 0
              ;(bars[i] as HTMLElement).style.height = `${Math.max(
                VIS_BAR_MIN_HEIGHT,
                (val / 255) * VIS_BAR_MAX_HEIGHT,
              )}px`
            }
          }

          // VAD：检测到人声就刷新时间戳；此后静音超过阈值即认为读完了
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
            stopRecording()
            return
          }
          rafRef.current = requestAnimationFrame(animate)
        }
        rafRef.current = requestAnimationFrame(animate)
      } catch (err) {
        // 频谱只是装饰，拿不到 analyser 不该让录音失败
        console.error(`${TAG} 频谱初始化失败:`, err)
      }
    }

    tickTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    capTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORD_MS)
  }, [clearTimers, finish, stopRecording, stopVisualization, support, text, sentenceId])

  const toggle = useCallback(() => {
    // 物理去抖（见 TOGGLE_DEBOUNCE_MS 的说明）
    const now = Date.now()
    if (now - lastToggleRef.current < TOGGLE_DEBOUNCE_MS) return
    lastToggleRef.current = now

    if (phase === "recording") {
      stopRecording()
      return
    }
    if (phase === "connecting" || phase === "processing") return
    void startRecording()
  }, [phase, startRecording, stopRecording])

  const close = useCallback(() => {
    discardRef.current = true
    clearTimers()
    autoStartPendingRef.current = false
    abortRef.current?.abort()
    stopRecording()
    stopVisualization()
    setOpen(false)
    setPhase("idle")
    setResult(null)
    setFailure(null)
    setElapsed(0)
  }, [clearTimers, stopRecording, stopVisualization])

  const openModal = useCallback(() => {
    setOpen(true)
    setResult(null)
    setFailure(null)
    setPhase("idle")
    setElapsed(0)
    // portal 宿主在**打开时**解析，而不是挂在 effect 里 setState ——
    // `react-hooks/set-state-in-effect` 会拦，且首帧本就没必要渲染弹窗。
    // `.practice-shell` 是静态外壳，不会中途换人，查一次就够。
    setPortalHost(document.querySelector<HTMLElement>(".practice-shell"))
 // 基准实现打开弹窗后自动开录，但按了空格就取消
    autoStartPendingRef.current = true
    autoStartRef.current = setTimeout(() => {
      if (autoStartPendingRef.current) {
        autoStartPendingRef.current = false
        void startRecording()
      }
    }, AUTO_START_DELAY_MS)
  }, [startRecording])

  // 弹窗打开时的键盘：Space 开关录音、Q 退出（`speaking.js:1490-1511` + `:1620`）
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return

      if (e.key === "q" || e.key === "Q") {
        close()
        return
      }
      if (e.code !== "Space") return
      e.preventDefault()
      if (e.repeat || spaceDownRef.current) return
      spaceDownRef.current = true
      // 按了空格就别再自动开录了 —— 否则松开后 setTimeout 还会再开一次
      autoStartPendingRef.current = false
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
  }, [open, close, toggle])

  // 卸载即释放麦克风。少了这段，录着音按 Enter 进下一句，麦克风会一直被占用。
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

  const bar = (
    <div id="inlineSpeakingContainer">
      <div
        className="inline-speaking-bar"
        id="inlineSpeakingBar"
        onClick={openModal}
        role="button"
        tabIndex={0}
        title="口语评估 · 点击或按空格键"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.code === "Space") {
            e.preventDefault()
            openModal()
          }
        }}
      >
        <div className="inline-mic-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
        <span className="inline-speaking-text" id="inlineSpeakingText">
          口语评估 · 点击或按空格键
        </span>
        <div className="inline-visualizer" id="inlineVisualizer" style={{ display: "none" }}>
          {Array.from({ length: BAR_VISUALIZER_BARS }, (_, i) => (
            <div className="vis-bar" key={i} />
          ))}
        </div>
        <span className="inline-speaking-timer" id="inlineSpeakingTimer" style={{ display: "none" }}>
          00:00
        </span>
      </div>
    </div>
  )

  if (!open) return bar

  const score = result?.score ?? 0
  const color = ringColor(score)

  const overlay = (
      <div
        className="isp-modal-overlay"
        id="inlineSpeakingModal"
        onClick={(e) => {
          // 点遮罩关闭（`speaking.js:1613`）
          if (e.target === e.currentTarget) close()
        }}
      >
        <div className="isp-modal">
          <button className="isp-close-btn" onClick={close} aria-label="关闭">
            ✕
          </button>
          <div className="isp-sentence">{text}</div>

          <div
            className="isp-recording-area"
            id="ispRecordingArea"
            style={{ display: result || failure ? "none" : "block" }}
          >
            <button
              className={`isp-mic-btn${phase === "recording" ? " recording" : ""}`}
              id="ispMicBtn"
              onClick={toggle}
              disabled={phase === "connecting" || phase === "processing"}
              style={{ opacity: phase === "connecting" || phase === "processing" ? 0.6 : 1 }}
              aria-label="开始或停止录音"
            >
              <div className="isp-mic-icon">
                <svg
                  width="28"
                  height="28"
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
            <div className="isp-hint" id="ispHint">
              {phase === "connecting"
                ? "连接中..."
                : phase === "recording"
                  ? "正在聆听..."
                  : phase === "processing"
                    ? "评测中..."
                    : "点击或按空格键开始跟读"}
            </div>
            <div
              className="isp-visualizer"
              id="ispVisualizer"
              ref={visBarsRef}
              style={{ display: phase === "recording" ? "flex" : "none" }}
            >
              {Array.from({ length: MODAL_VISUALIZER_BARS }, (_, i) => (
                <div className="isp-vis-bar" key={i} />
              ))}
            </div>
            <div
              className="isp-timer"
              id="ispTimer"
              style={{ display: phase === "recording" ? "block" : "none" }}
            >
              {formatClock(elapsed)}
            </div>
          </div>

          <div
            className="isp-result-area"
            id="ispResultArea"
            style={{ display: result || failure ? "block" : "none" }}
          >
            {failure ? (
              <div className="isp-limit-exhausted-card">
                <div className="isp-limit-icon">
                  <svg
                    viewBox="0 0 24 24"
                    width="40"
                    height="40"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 7v5" />
                    <path d="M12 16h.01" />
                  </svg>
                </div>
                <div className="isp-limit-title">{failure.title}</div>
                <div className="isp-limit-message">{failure.detail}</div>
                {failure.canRetry ? (
                  <button className="isp-limit-upgrade-btn" onClick={() => void startRecording()}>
                    再试一次
                  </button>
                ) : null}
              </div>
            ) : result ? (
              <>
                <div className="isp-result-header">
                  <div className="isp-score-ring">
                    <svg viewBox="0 0 36 36" className="circular-chart">
                      <path
                        className="circle-bg"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="circle"
                        strokeDasharray={`${score}, 100`}
                        style={{ stroke: color }}
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <div className="isp-score-num" style={{ color }}>
                      {Math.round(score)}
                    </div>
                  </div>
                  <div className="isp-result-info">
                    <div className="isp-result-level" style={{ color }}>
                      {scoreLevel(score)}
                    </div>
                    <div className="isp-result-msg">{feedbackMessage(score)}</div>
                  </div>
                </div>

                <div className="isp-metrics">
                  {[
                    { label: "准确度", value: result.accuracy, grad: "linear-gradient(90deg, #38bdf8, #0ea5e9)" },
                    { label: "流畅度", value: result.fluency, grad: "linear-gradient(90deg, #818cf8, #6366f1)" },
                    { label: "完整度", value: result.integrity, grad: "linear-gradient(90deg, #c084fc, #a855f7)" },
                  ].map((m) => (
                    <div className="isp-metric-item" key={m.label}>
                      <div className="isp-metric-label">{m.label}</div>
                      <div className="isp-metric-bar">
                        <div
                          className="isp-metric-fill"
                          style={{ width: `${m.value ?? 0}%`, background: m.grad }}
                        />
                      </div>
                      <div className="isp-metric-value">{m.value === null ? "—" : Math.round(m.value)}</div>
                    </div>
                  ))}
                </div>

                {result.words.length > 0 && (
                  <div className="isp-words">
                    {result.words.map((w, i) => (
                      <span className={`speaking-word ${wordStatus(w)}`} key={`${w.word}-${i}`}>
                        <span className="word-text">{w.word}</span>
                        <span className="word-score">
                          {w.score === null ? "—" : Math.round(w.score)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="isp-action-bar">
                  <button className="isp-retry-btn" onClick={() => void startRecording()}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                    再试一次
                  </button>
                  <div className="isp-shortcuts-hint">
                    <span>
                      <kbd>Space</kbd> 重试
                    </span>
                    <span>
                      <kbd>Q</kbd> 退出
                    </span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
  )

  // 宿主尚未解析出来时（首帧）就地渲染兜底：宁可遮罩沿用旧行为，也不要弹窗消失。
  return (
    <>
      {bar}
      {portalHost ? createPortal(overlay, portalHost) : overlay}
    </>
  )
}
