/**
 * 16kHz / 16bit / 单声道 PCM WAV 编码器。
 *
 * 为什么必须自己编码：有道语音评测**只接受**「wav、不压缩 PCM、16k 采样率、
 * 16bit 位深、单声道」（见官方文档
 * https://ai.youdao.com/DOCSIRMA/html/tts/api/yypc/index.html）。
 * 而浏览器 MediaRecorder 能录出来的只有 webm/opus（Chrome）或 mp4/aac（Safari），
 * 全都不是 wav —— 于是旧实现在「录的是 webm、却对有道声明 format=wav」之间自相矛盾，
 * 这正是评分失败的根因之一（实测把 format 换成 mp3 会被有道以 11001
 * 「不支持的语音识别格式」直接拒绝，说明格式是**前置校验**的）。
 *
 * 正确链路：MediaRecorder 录音 → decodeAudioData 解码 → OfflineAudioContext
 * 重采样到 16k 单声道 → 本模块编码成 WAV。
 *
 * 本模块是**纯函数**（不碰 WebAudio / DOM），因此能在 node 环境的单测里
 * 逐字节校验头部字段 —— 这些字段错一个，有道就拒收。
 *
 * 该编码器的输出已用真实请求验证过：把生成的 WAV 发给
 * https://openapi.youdao.com/iseapi，返回 errorCode=108（应用ID无效），
 * 而不是 11001/11002/11003（格式/采样率/声道不支持）—— 说明音频被接受。
 */

/** 有道评测要求的采样率。 */
export const EVALUATE_SAMPLE_RATE = 16000

/** WAV 头长度：RIFF(4) + size(4) + WAVE(4) + "fmt "(4) + 16 + 数据 chunk 头(8) */
const HEADER_BYTES = 44

/**
 * 把 [-1, 1] 的浮点采样编码成 16bit 单声道 PCM WAV。
 *
 * @param samples    单声道浮点采样（WebAudio 的 getChannelData 就是 Float32Array）
 * @param sampleRate 采样率，必须是 16000（有道只接受这个）
 */
export function encodePcm16WavMono(
  samples: Float32Array,
  sampleRate: number = EVALUATE_SAMPLE_RATE,
): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true) // 除 "RIFF"+size 之外的全部长度
  writeAscii(8, "WAVE")

  // fmt chunk
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true) // PCM 的 fmt 块固定 16 字节
  view.setUint16(20, 1, true) // 音频格式：1 = PCM（未压缩）
  view.setUint16(22, 1, true) // 声道数：1 = 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // 字节率 = 采样率 × 声道数 × 位深/8
  view.setUint16(32, 2, true) // 块对齐 = 声道数 × 位深/8
  view.setUint16(34, 16, true) // 位深

  // data chunk
  writeAscii(36, "data")
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < samples.length; i++) {
    // 先夹到 [-1, 1]：解码后的采样偶尔会略微越界（重采样振铃），
    // 直接乘 32767 再取整会溢出成反向的尖峰噪声。
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    // 负半轴用 32768（而不是 32767）才是对称的：16bit 有符号范围是 -32768..32767。
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * 32767), true)
  }

  return new Uint8Array(buffer)
}

/**
 * 目标采样率下这段音频应有的采样点数。
 *
 * 用于给 OfflineAudioContext 申请正好够长的缓冲区（多退少补都会让
 * 音频时长与文本对不上，进而拉低完整度/流利度得分）。
 */
export function resampledLength(inputLength: number, fromRate: number, toRate: number): number {
  if (fromRate <= 0 || toRate <= 0 || inputLength <= 0) return 0
  return Math.round((inputLength * toRate) / fromRate)
}

/** Uint8Array → base64（浏览器与 node 都可用）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000 // 分块避免 apply 的参数长度上限
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  // btoa 在浏览器有、node 没有；node 侧走 Buffer 以支持单测
  if (typeof btoa === "function") return btoa(binary)
  return Buffer.from(binary, "binary").toString("base64")
}
