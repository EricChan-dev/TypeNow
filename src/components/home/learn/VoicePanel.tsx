"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  globalSpeak,
  isSpeaking,
  stopSpeaking,
  subscribeSpeaking,
} from "@/lib/hooks/useTTSSettings"
import { Volume2, Mic, MicOff, Loader2, Info, RotateCw } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  EVALUATE_SAMPLE_RATE,
  bytesToBase64,
  encodePcm16WavMono,
  resampledLength,
} from "@/lib/pcm-wav"
import {
  describeEvaluateFailure,
  type EvaluateFailureView,
  type EvaluateResult,
} from "@/lib/pronunciation"
import { describeMicError } from "@/lib/mic-error"
import { baseSentenceId } from "@/lib/sentence-id"
import type { Sentence } from "@/types"
import { PronunciationCard } from "@/components/home/learn/PronunciationCard"
import { PronunciationModal } from "@/components/home/learn/PronunciationModal"

/**
 * 跟读评分面板。
 *
 * ── 这一版修掉的问题 ────────────────────────────────────────────────────────
 *
 * 旧实现有几处互相叠加的缺陷，合起来让这个功能既不可用、又难以排查：
 *
 *   1. **录的是 webm/opus，却对有道声明 format=wav。** 该接口只接受
 *      wav（16k/16bit/单声道），实测传 mp3 会被前置校验以 11001 直接拒绝。
 *      现在录音后经 decodeAudioData + OfflineAudioContext 重采样到 16k 单声道，
 *      再用 lib/pcm-wav 编码成真正的 WAV。
 *   2. **没有任何特性探测。** 任何异常都被报成「无法访问麦克风，请检查权限」，
 *      而 iOS Safari / 微信内置浏览器根本不支持 MediaRecorder 录 webm ——
 *      用户去改权限永远修不好。现在先探测、再协商 mimeType，不支持时
 *      直接说明并隐藏入口，而不是给一个永远失败的按钮。
 *   3. **朗读与录音不互斥。** 录音时参考音还在响 → 被麦克风采进去 → 假高分。
 *      现在开录前先 stopSpeaking()，录音期间朗读按钮禁用。
 *   4. **10 秒定时器不清理**，且闭包引用的是 ref 而非当次 recorder ——
 *      连续录音时第一次的定时器会把第二次掐断。现在保存 id、停止与卸载时清理，
 *      并在界面上显示倒计时（用户不再莫名其妙被截断）。
 *   5. **卸载不释放麦克风**：录着音按 Enter 进下一句，麦克风会一直被占用到
 *      定时器触发（浏览器录音指示不灭，用户会以为被偷听）。现在卸载即释放，
 *      并丢弃这次录音、不发起评分。
 *   6. **失败一律是「评分失败，请重试」**，且服务端错误码被原样抛给用户
 *      （「评分失败(2022)」）。现在按「未配置 / 额度用尽 / 录音问题 / 网络」
 *      分类给话术，见 lib/pronunciation 的 describeEvaluateFailure。
 */

/** 单次录音上限。够读完一节课里最长的句子，又不至于让用户对着按钮发呆。 */
const MAX_RECORD_MS = 10_000
/** 评分请求超时（服务端自身对有道的超时是 20 秒，这里留出余量）。 */
const REQUEST_TIMEOUT_MS = 30_000

/** 按优先级协商一个浏览器支持的录音容器。 */
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4", // Safari 走这条
]

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  for (const type of CANDIDATE_MIME_TYPES) {
    // isTypeSupported 在某些实现里缺失，缺失时不要因此判定"不支持"
    if (typeof MediaRecorder.isTypeSupported !== "function") return null
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

function detectRecordingSupport(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { ok: false, reason: "当前环境不支持录音" }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason: "此浏览器不支持录音（需要 HTTPS 与较新的浏览器）。请在电脑上用 Chrome / Edge 练习。",
    }
  }
  if (typeof MediaRecorder === "undefined") {
    return { ok: false, reason: "此浏览器不支持录音。请在电脑上用 Chrome / Edge 练习。" }
  }
  return { ok: true }
}

/**
 * 读站点级的麦克风权限状态。
 *
 * 浏览器不支持这个查询时（Firefox / Safari 不提供 microphone）返回 "unknown"，
 * 而不是抛错 —— 拿不到权限状态只是少一条线索，不该让整条错误提示失败。
 */
async function queryMicPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName })
    return (status?.state as "granted" | "denied" | "prompt") ?? "unknown"
  } catch {
    return "unknown"
  }
}

/**
 * 组装诊断输入（要读一次站点权限状态），判定与文案在 lib/mic-error ——
 * 那里是纯函数、有单测覆盖。
 *
 * 提示文本是用户唯一能看到的诊断信息：这一处曾经把三种不同的失败混成一句
 * 「点锁图标允许麦克风」，而用户明明已经允许了。所以它值得被单独测。
 */
async function micErrorMessage(err: unknown): Promise<string> {
  const name = (err as { name?: string } | null)?.name ?? ""
  // 原始错误名打进 console：用户截图或复述时能直接定位
  console.error("[VoicePanel] getUserMedia 失败:", name, err)
  return describeMicError({
    name,
    permission: await queryMicPermission(),
    userAgent: navigator.userAgent,
  })
}

/**
 * 把录到的音频转成有道要求的 16k / 16bit / 单声道 WAV（base64）。
 *
 * 重采样用 OfflineAudioContext 而不是自己做线性插值：48k→16k 直接抽取会产生
 * 混叠，而混叠会实实在在压低评测得分（听起来像杂音）。交给音频引擎做带抗混叠的
 * 重采样，代价只有几行。
 */
async function toWavBase64(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer()
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtor) throw new Error("AudioContext unavailable")

  const ctx = new AudioCtor()
  try {
    // 传副本：decodeAudioData 会 detach 传入的 ArrayBuffer
    const decoded = await ctx.decodeAudioData(bytes.slice(0))
    const target = Math.max(
      1,
      resampledLength(decoded.length, decoded.sampleRate, EVALUATE_SAMPLE_RATE),
    )
    const offline = new OfflineAudioContext(1, target, EVALUATE_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return bytesToBase64(encodePcm16WavMono(rendered.getChannelData(0), EVALUATE_SAMPLE_RATE))
  } finally {
    void ctx.close()
  }
}

export function VoicePanel({ sentence }: { sentence: Sentence }) {
  const english = sentence.english
  /**
   * 落库用的是**原句 id**，不是练习项的 id。
   *
   * 有 chunks 的句子会被 LearnClient 展开成 `<原句 id>_c<order>`（见 expandSentences），
   * 而数据库里没有 `xxx_c0` 这一行：列宽是 VARCHAR(36)，`_c0` 后缀会把 id 顶到 39 字符，
   * pronunciation-store 会**直接拒写并只留一行日志** —— 用户看到分数、库里什么都没有，
   * 正是这次改版要消灭的静默丢分。所以统一走 baseSentenceId（非分块句子是 no-op）。
   */
  const sentenceId = baseSentenceId(sentence.id)
  const [recording, setRecording] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(MAX_RECORD_MS / 1000)
  /**
   * 结果与失败都**连同句子一起存**，而不是换句子时用 effect 去清空。
   *
   * 两种写法的差别不只是风格：在 effect 里同步 setState 会触发级联渲染
   * （React 明确不推荐，本仓库的 lint 规则也拦住了它）。更重要的是，
   * "把句子和它的评分绑在一起"本身就表达了正确的语义 —— 评分属于某一句话，
   * 换了句子它自然就不该显示，不需要额外的清理逻辑。
   */
  const [result, setResult] = useState<{ forSentence: string; data: EvaluateResult } | null>(null)
  /**
   * 本次会话内上一次的分数（用于弹窗上的「61 → 84」）。重录前先存这里。
   *
   * 必须在 handleRecord 里 setResult(null) **之前**取值 —— 所以它是在 onstop 里
   * 从当次渲染的闭包读 shownResult，而不是等结果回来再读（那时旧的已经清掉了）。
   */
  const [previousScore, setPreviousScore] = useState<number | null>(null)
  /** 弹窗开关。评分回来时自动打开，也能从下面的卡片点开；关闭后回到卡片上。 */
  const [modalOpen, setModalOpen] = useState(false)
  const [failure, setFailure] = useState<{
    forSentence: string
    view: EvaluateFailureView
  } | null>(null)
  const [support] = useState(detectRecordingSupport)

  // 只展示属于**当前这句**的评分/失败
  const shownResult = result?.forSentence === english ? result.data : null
  const shownFailure = failure?.forSentence === english ? failure.view : null

  // 朗读状态来自模块级订阅（见 useTTSSettings 的说明）：globalSpeak 的返回值
  // 只代表"有没有开始播"，不能拿来驱动"停止"按钮。
  const speaking = useSyncExternalStore(subscribeSpeaking, isSpeaking, () => false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** 卸载/取消时置位：让 onstop 知道这次录音已经作废，不要发起评分。 */
  const discardRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current)
      tickTimerRef.current = null
    }
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  // 换句子时不需要显式清理：结果带着自己的句子，渲染时匹配不上就不会显示
  // （见上面 shownResult / shownFailure 的说明）

  // 卸载：释放麦克风、清定时器、丢弃在途请求与本次录音。
  // 少了这段，用户录着音按 Enter 进下一句，麦克风会一直被占用到定时器触发。
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
      releaseStream()
    }
  }, [clearTimers, releaseStream])

  async function handleTTS() {
    if (speaking) {
      stopSpeaking()
      return
    }
    // 与自动朗读、悬浮卡片走同一条路径（同一个音色、会先停掉上一段）
    const ok = await globalSpeak(english)
    if (!ok) toast.error("朗读失败，可能是浏览器拦截了自动播放")
  }

  async function handleRecord() {
    if (recording) {
      recorderRef.current?.stop()
      return
    }

    setResult(null)
    setFailure(null)
    // 重录必须把弹窗收起来：弹窗是 fixed inset-0 z-50，会盖住面板上的
    // 录音倒计时、「停止录音」和失败提示。尤其在有历史分时，弹窗会转而渲染
    // 那条**旧的**历史分（sentence.pronunciation 是首屏快照，upsert 后不会更新），
    // 于是用户点了「再试一次」，屏幕上看到的分数反而退回去了。
    // 收起后评分成功会由 onstop 里的 setModalOpen(true) 重新打开。
    setModalOpen(false)

    if (!support.ok) {
      toast.error(support.reason ?? "此浏览器不支持录音")
      return
    }

    // 互斥：参考音必须先停。否则扬声器外放会被麦克风采进去，
    // 评出虚高的分 —— 那会让基于分数的判断全部失真。
    stopSpeaking()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch (err) {
      // 需要 await：要读一次站点权限状态才能判断到底是"站点被拒"还是
      // "站点已允许、系统层面拦住了"（见 micErrorMessage）
      toast.error(await micErrorMessage(err))
      return
    }

    const mime = pickMimeType()
    let recorder: MediaRecorder
    try {
      // 协商出来的 mimeType 才传；拿不到就让浏览器用默认容器，
      // 而不是硬编码一个该浏览器不支持的（旧实现硬编码 webm，Safari 直接抛错）
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch (err) {
      console.error("[VoicePanel] MediaRecorder 构造失败:", err)
      stream.getTracks().forEach((t) => t.stop())
      toast.error("此浏览器不支持录音，请在电脑上用 Chrome / Edge 练习")
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
      releaseStream()
      setRecording(false)
      // 卸载或主动作废的录音不评分
      if (discardRef.current) return

      if (chunksRef.current.length === 0) {
        setFailure({
          forSentence: english,
          view: {
            title: "没有录到声音",
            detail: "请确认麦克风可用、对着它读完这句再试。",
            canRetry: true,
          },
        })
        return
      }

      // 记下上一次的分数（如果这次会话里录过），用于弹窗上的变化显示。
      // 读的是**这次渲染闭包**里的 shownResult：handleRecord 已经 setResult(null)，
      // 等结果回来再读就永远是 null，「61 → 84」也就永远不显示。
      setPreviousScore(shownResult?.score ?? null)
      setEvaluating(true)
      const controller = new AbortController()
      abortRef.current = controller
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" })

        let audio: string
        try {
          audio = await toWavBase64(blob)
        } catch (err) {
          console.error("[VoicePanel] 音频转码失败:", err)
          setFailure({
            forSentence: english,
            view: {
              title: "录音格式无法处理",
              detail: "请更新浏览器后重试，或改用电脑版 Chrome / Edge。",
              canRetry: true,
            },
          })
          return
        }

        const res = await fetch("/api/youdao/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // sentenceId 必传：路由只认这个字段来决定分数挂在哪句上，
          // 而且是**原句 id**（分块练习项必须还原，见上面 sentenceId 的说明）
          body: JSON.stringify({ audio, text: english, sentenceId }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setFailure({ forSentence: english, view: describeEvaluateFailure(res.status, data) })
          return
        }
        setResult({ forSentence: english, data: data as EvaluateResult })
        // 拿到结果就弹窗：用户刚读完，逐词分析正是此刻要看的
        setModalOpen(true)
      } catch (err) {
        const timedOut = (err as { name?: string } | null)?.name === "AbortError"
        setFailure({
          forSentence: english,
          view: describeEvaluateFailure(null, null, { timedOut }),
        })
      } finally {
        clearTimeout(timeoutId)
        abortRef.current = null
        setEvaluating(false)
      }
    }

    recorder.start()
    setRecording(true)
    setSecondsLeft(MAX_RECORD_MS / 1000)

    stopTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop()
    }, MAX_RECORD_MS)
    tickTimerRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="flex items-center gap-3">
        <button
          onClick={handleTTS}
          // 录音期间禁用朗读：两者同时进行会让参考音被录进去
          disabled={recording}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
            speaking
              ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
              : "bg-muted text-foreground/70 border-border hover:border-blue-500/40 hover:text-blue-400",
            recording && "opacity-40 cursor-not-allowed",
          )}
        >
          <Volume2 className="h-4 w-4" />
          {speaking ? "停止" : "朗读"}
        </button>

        {support.ok ? (
          <button
            onClick={handleRecord}
            disabled={evaluating}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
              recording
                ? "bg-red-500/20 text-red-400 border-red-500/40 animate-pulse"
                : "bg-muted text-foreground/70 border-border hover:border-violet-500/40 hover:text-violet-400",
              evaluating && "opacity-60 cursor-wait",
            )}
          >
            {evaluating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {evaluating ? "评分中…" : recording ? `停止录音（${secondsLeft}s）` : "跟读评分"}
          </button>
        ) : (
          <span className="flex items-center gap-2 text-xs text-muted-foreground max-w-[260px]">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {support.reason}
          </span>
        )}
      </div>

      {shownFailure && (
        <div className="flex flex-col items-center gap-2 max-w-sm text-center">
          <p className="text-sm font-medium text-foreground">{shownFailure.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{shownFailure.detail}</p>
          {shownFailure.canRetry && (
            <button
              onClick={handleRecord}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <RotateCw className="h-3 w-3" />
              重新录音
            </button>
          )}
        </div>
      )}

      {/* 本次没录、但库里有历史分（设计 §3.6）：显示历史卡片，点开看详情。
          ⚠️ 这张卡片与下面「本次评分」卡片互斥（一个 !shownResult、一个 shownResult），
          所以任何时刻最多只有一张卡片 —— 不会出现两张分数卡叠在一起。 */}
      {!shownResult && !modalOpen && sentence.pronunciation && (
        <PronunciationCard
          score={sentence.pronunciation.score}
          accuracy={sentence.pronunciation.accuracy}
          fluency={sentence.pronunciation.fluency}
          integrity={sentence.pronunciation.integrity}
          updatedAt={new Date(sentence.pronunciation.updatedAt)}
          onClick={() => setModalOpen(true)}
        />
      )}

      {/* 有本次评分时显示卡片；点击重开弹窗。
          不传 updatedAt：这是本次刚录出来的分，"3 天前"那种相对时间只属于历史分。 */}
      {shownResult && !modalOpen && (
        <PronunciationCard
          score={shownResult.score}
          accuracy={shownResult.accuracy}
          fluency={shownResult.fluency}
          integrity={shownResult.integrity}
          onClick={() => setModalOpen(true)}
        />
      )}

      {/* 弹窗要传 recording：录音期间必须禁用「听发音 / 再试一次」，
          否则参考音被麦克风采进去会评出假高分，而评分是覆盖式落库的。 */}
      {modalOpen && shownResult && (
        <PronunciationModal
          words={shownResult.words}
          result={shownResult}
          previousScore={previousScore}
          speaking={speaking}
          evaluating={evaluating}
          recording={recording}
          onSpeak={handleTTS}
          onRetry={handleRecord}
          onClose={() => setModalOpen(false)}
        />
      )}

      {modalOpen && !shownResult && sentence.pronunciation && (
        <PronunciationModal
          words={sentence.pronunciation.words}
          result={sentence.pronunciation}
          previousScore={null}
          speaking={speaking}
          evaluating={evaluating}
          recording={recording}
          onSpeak={handleTTS}
          onRetry={handleRecord}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
