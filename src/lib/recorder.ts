/**
 * 录音 → 16k 单声道 WAV 的公共底座。
 *
 * ── 为什么单独抽出来 ────────────────────────────────────────────────────────
 *
 * 跟读评分有两处入口，录出来的音频必须是**同一种**东西：
 *
 *   1. `components/home/learn/VoicePanel.tsx` —— 侧栏里的跟读面板；
 *   2. `components/home/learn/InlineSpeakingBar.tsx` —— 听写回顾屏上的内联
 *      口语评估条（参考站 `practice.js:4813-4829` 的 `#inlineSpeakingBar`）。
 *
 * 两处最初各抄一份，随后必然漂移：一处改了重采样、另一处忘了，同一句话在
 * 两个入口评出不同的分。所以音频链路的四个决定点都收在这里：
 *
 *   - **特性探测**：iOS Safari / 微信内置浏览器不支持 MediaRecorder 录 webm，
 *     必须提前说明，而不是给一个永远失败的按钮；
 *   - **mimeType 协商**：不能硬编码 webm（Safari 直接抛错）；
 *   - **重采样到 16k**：有道只接受 16k/16bit/单声道 WAV，传 webm 会被
 *     11001/11002/11003 拒绝；
 *   - **权限诊断**：区分「站点被拒」与「站点已允许但系统层面拦住」。
 *
 * 这里只放**不依赖 React** 的部分：纯函数与浏览器 API 调用。录音机状态机
 * 留在各自的组件里，因为两处的交互（面板是倒计时按钮、内联条是空格键开关）
 * 并不一样。
 */

import { bytesToBase64, encodePcm16WavMono, EVALUATE_SAMPLE_RATE, resampledLength } from "@/lib/pcm-wav"
import { describeMicError } from "@/lib/mic-error"

/** 单次录音上限。够读完一节课里最长的句子，又不至于让用户对着按钮发呆。 */
export const MAX_RECORD_MS = 10_000
/** 评分请求超时（服务端自身对有道的超时是 20 秒，这里留出余量）。 */
export const REQUEST_TIMEOUT_MS = 30_000

/** 按优先级协商一个浏览器支持的录音容器。 */
export const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4", // Safari 走这条
] as const

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  for (const type of CANDIDATE_MIME_TYPES) {
    // isTypeSupported 在某些实现里缺失，缺失时不要因此判定"不支持"
    if (typeof MediaRecorder.isTypeSupported !== "function") return null
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

export function detectRecordingSupport(): { ok: boolean; reason?: string } {
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
export async function queryMicPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
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
 *
 * @param tag 日志前缀，用来区分是哪个入口触发的（`[VoicePanel]` / `[InlineSpeaking]`）。
 */
export async function micErrorMessage(err: unknown, tag: string): Promise<string> {
  const name = (err as { name?: string } | null)?.name ?? ""
  // 原始错误名打进 console：用户截图或复述时能直接定位
  console.error(`${tag} getUserMedia 失败:`, name, err)
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
export async function blobToEvaluateWavBase64(blob: Blob): Promise<string> {
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

/**
 * 发起一次跟读评分。
 *
 * `sentenceId` 是**练习项自己的 id**：有 chunks 的句子会被展开成
 * `<原句 id>_c<order>`，每个分块独立朗读、独立评分，各有各的分行。这里不做
 * `baseSentenceId()` 改写（改写了会让一句多个分块只剩一个分数格，后录的覆盖前录的）。
 *
 * 返回统一的判别结果：`ok` 时带 `EvaluateResult`，否则带 HTTP 状态与原始负载，
 * 交给 `describeEvaluateFailure` 决定话术。
 */
export type EvaluateOutcome =
  | { ok: true; data: unknown }
  | { ok: false; status: number; payload: unknown; timedOut: boolean }

export async function requestEvaluate(
  wavBase64: string,
  text: string,
  sentenceId: string,
  signal: AbortSignal,
): Promise<EvaluateOutcome> {
  try {
    const res = await fetch("/api/youdao/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // sentenceId 必传：路由只认这个字段来决定分数挂在哪个练习项上
      body: JSON.stringify({ audio: wavBase64, text, sentenceId }),
      signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, payload: data, timedOut: false }
    return { ok: true, data }
  } catch (err) {
    const timedOut = (err as { name?: string } | null)?.name === "AbortError"
    // 网络层失败没有 HTTP 状态，用 null 而不是 0/500，让 describeEvaluateFailure
    // 走「网络」分支而不是误判成服务端故障。
    return { ok: false, status: 0, payload: null, timedOut }
  }
}
