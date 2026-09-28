/**
 * 16k/16bit/单声道 PCM WAV 编码器（src/lib/pcm-wav.ts）。
 *
 * 为什么逐字节验头部：有道语音评测会**前置校验**音频格式 —— 实测把 format 传成
 * mp3 直接得到 11001「不支持的语音识别格式」、channel=2 得到 11003。头部里
 * 采样率/声道/位深/字节率任何一个写错，用户看到的就是"评分失败"。
 *
 * 这个编码器的输出已用真实请求验证过：生成的 WAV 发给
 * https://openapi.youdao.com/iseapi 得到 errorCode=108（应用ID无效），
 * 而不是格式类错误码 —— 说明音频被接受。
 */
import { describe, it, expect } from "vitest"
import {
  EVALUATE_SAMPLE_RATE,
  bytesToBase64,
  encodePcm16WavMono,
  resampledLength,
} from "@/lib/pcm-wav"

/** 从 WAV 字节里读第 0 个采样（16bit 小端有符号）。 */
function firstSample(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getInt16(44, true)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

describe("encodePcm16WavMono · 头部字段", () => {
  const samples = new Float32Array(160) // 10ms @16k
  const bytes = encodePcm16WavMono(samples)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  it("RIFF / WAVE / fmt / data 四个标记正确", () => {
    expect(ascii(bytes, 0, 4)).toBe("RIFF")
    expect(ascii(bytes, 8, 4)).toBe("WAVE")
    expect(ascii(bytes, 12, 4)).toBe("fmt ")
    expect(ascii(bytes, 36, 4)).toBe("data")
  })

  it("长度字段自洽（RIFF size 与 data size）", () => {
    const dataBytes = samples.length * 2
    expect(view.getUint32(4, true)).toBe(36 + dataBytes)
    expect(view.getUint32(40, true)).toBe(dataBytes)
    expect(bytes.length).toBe(44 + dataBytes)
  })

  it("PCM / 单声道 / 16k / 16bit —— 有道的硬性要求", () => {
    expect(view.getUint32(16, true)).toBe(16) // fmt 块长度
    expect(view.getUint16(20, true)).toBe(1) // 1 = PCM 未压缩
    expect(view.getUint16(22, true)).toBe(1) // 单声道
    expect(view.getUint32(24, true)).toBe(EVALUATE_SAMPLE_RATE)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16) // 位深
  })

  it("派生字段自洽（字节率与块对齐）", () => {
    expect(view.getUint32(28, true)).toBe(16000 * 1 * 2) // 字节率 = 采样率×声道×位深/8
    expect(view.getUint16(32, true)).toBe(2) // 块对齐 = 声道×位深/8
  })

  it("自定义采样率会被如实写进头部（不写死 16000）", () => {
    const custom = encodePcm16WavMono(new Float32Array(8), 8000)
    const v = new DataView(custom.buffer)
    expect(v.getUint32(24, true)).toBe(8000)
    expect(v.getUint32(28, true)).toBe(16000)
  })
})

describe("encodePcm16WavMono · 采样编码", () => {
  it("把 [-1,1] 映射到 16bit 有符号范围", () => {
    expect(firstSample(encodePcm16WavMono(new Float32Array([1])))).toBe(32767)
    expect(firstSample(encodePcm16WavMono(new Float32Array([-1])))).toBe(-32767)
    expect(firstSample(encodePcm16WavMono(new Float32Array([0])))).toBe(0)
    expect(firstSample(encodePcm16WavMono(new Float32Array([0.5])))).toBe(16384)
  })

  it("越界采样被夹住，而不是溢出成反向尖峰", () => {
    // 重采样振铃会让采样略微超出 ±1；不夹住的话 1.2*32767 取整后写进 int16
    // 会回绕成负数，听感上是"啪"的一声，也会污染评测。
    expect(firstSample(encodePcm16WavMono(new Float32Array([1.5])))).toBe(32767)
    expect(firstSample(encodePcm16WavMono(new Float32Array([-1.5])))).toBe(-32767)
    expect(firstSample(encodePcm16WavMono(new Float32Array([Number.POSITIVE_INFINITY])))).toBe(32767)
  })

  it("多采样按顺序小端写入，可原样读回", () => {
    const input = new Float32Array([0, 0.25, -0.25, 1, -1])
    const bytes = encodePcm16WavMono(input)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < input.length; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(Math.round(input[i] * 32767))
    }
  })

  it("空采样不抛错，产出只有头部的 44 字节", () => {
    const bytes = encodePcm16WavMono(new Float32Array(0))
    expect(bytes.length).toBe(44)
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(0)
  })

  it("1 秒 16k 音频 = 32000 字节数据 + 44 字节头", () => {
    const bytes = encodePcm16WavMono(new Float32Array(16000))
    expect(bytes.length).toBe(44 + 32000)
  })
})

describe("resampledLength", () => {
  it("48k → 16k 是三分之一长度", () => {
    expect(resampledLength(48000, 48000, 16000)).toBe(16000)
  })

  it("四舍五入到整数采样点（小数会造出非法长度）", () => {
    expect(resampledLength(48001, 48000, 16000)).toBe(16000)
    expect(resampledLength(100, 44100, 16000)).toBe(36)
  })

  it("非法入参返回 0（调用方据此判断没有可编码的音频）", () => {
    expect(resampledLength(0, 48000, 16000)).toBe(0)
    expect(resampledLength(-5, 48000, 16000)).toBe(0)
    expect(resampledLength(1000, 0, 16000)).toBe(0)
    expect(resampledLength(1000, 48000, 0)).toBe(0)
  })

  it("同采样率时长度不变（不该因为重采样引入漂移）", () => {
    expect(resampledLength(16000, 16000, 16000)).toBe(16000)
  })
})

describe("bytesToBase64", () => {
  it("能原样往返（服务端要把它当 q 参数发给有道）", () => {
    const bytes = encodePcm16WavMono(new Float32Array([0, 0.5, -0.5]))
    const b64 = bytesToBase64(bytes)
    const back = new Uint8Array(Buffer.from(b64, "base64"))
    expect(Array.from(back)).toEqual(Array.from(bytes))
  })

  it("超过 32KB 也正确（分块拼接不能丢字节）", () => {
    const big = new Uint8Array(70_000)
    for (let i = 0; i < big.length; i++) big[i] = i % 251
    const back = new Uint8Array(Buffer.from(bytesToBase64(big), "base64"))
    expect(back.length).toBe(big.length)
    expect(back[0]).toBe(big[0])
    expect(back[69_999]).toBe(big[69_999])
  })
})
