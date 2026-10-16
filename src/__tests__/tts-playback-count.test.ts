/**
 * 朗读连播次数（`globalSpeak(text, { count })`）。
 *
 * 存在的理由：「自动播放次数」设置（`tts_playback_count`）的预期行为是
 * 一个内部 `for` 循环：一遍播完 → 停 600ms → 再播一遍，共 `playbackCount` 遍。
 * 我们之前把这个设置只接到了「显示」上（指示灯、下拉框选中态、localStorage），
 * `globalSpeak` 根本不收次数参数 —— 选「3 次」和选「1 次」听到的完全一样，
 * 是个死开关。这个用例就是钉住那个循环，防止它再退化成摆设。
 *
 * 口径：
 *   · 不传 count ⇒ 1 次；
 * · count = 0 ⇒ 一声不响（「手动」档）；组件层负责把 0 换成 1（既有
 *     `manualCount` 约定）；
 *   · count = N ⇒ 连播 N 次，遍间等上一遍播完再停 600ms。
 *
 * 因为 vitest 跑在 node 环境（vitest.config.ts:6 `environment: "node"`，没有
 * jsdom），这里自己把 window / Audio / fetch 这几样打桩，而不是引入新依赖。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/** 每次 `new Audio(...).play()` 记一笔，用来数总共响了几遍。 */
let plays: number[] = []
/** `speechSynthesis.speak` 的调用次数（系统语音路径）。 */
let browserSpeaks = 0

const store = new Map<string, string>()

/** 音频对象打桩：`play()` 一调用就记录，10ms 后自己触发 `onended`。 */
class FakeAudio {
  src: string
  onended: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(src: string) {
    this.src = src
  }

  play(): Promise<void> {
    plays.push(Date.now())
    setTimeout(() => this.onended?.(), 10)
    return Promise.resolve()
  }

  pause(): void {
    /* 打桩：什么都不做 */
  }
}

function installGlobals(source: "youdao" | "browser") {
  plays = []
  browserSpeaks = 0
  store.clear()
  // 存一份 v3 配置，避免再走迁移分支把 source 改掉
  store.set(
    "typenow_tts_settings",
    JSON.stringify({ source, voice: "", youdaoVoice: "youyating", volume: 1, rate: 0.9, version: 3 }),
  )

  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    speechSynthesis: {
      cancel: () => {},
      getVoices: () => [],
      // 真实浏览器里 `onend` 会在播完后触发；这里 10ms 后自己触发，
      // 否则连播的遍间等待会一直挂在「上一遍播完了吗」上。
      speak: (u: { onend?: (() => void) | null }) => {
        browserSpeaks++
        setTimeout(() => u.onend?.(), 10)
      },
    },
  }

  vi.stubGlobal("window", fakeWindow)
  vi.stubGlobal("localStorage", fakeWindow.localStorage)
  vi.stubGlobal("Audio", FakeAudio)
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      lang = ""
      rate = 1
      volume = 1
      voice: unknown = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
    },
  )
  // rAF 直接同步执行，让系统语音路径的 speak() 立刻发生
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    fn()
    return 0
  })
  vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} })
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
  }))
}

/** 每个用例都重新 import，好让模块级的 speakSeq / currentAudio 归零。 */
async function loadGlobalSpeak() {
  vi.resetModules()
  const mod = await import("@/lib/hooks/useTTSSettings")
  return mod.globalSpeak
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("globalSpeak — count 控制连播遍数", () => {
  it("不传 count ⇒ 只播 1 遍（词发音/试听/回顾朗读的老口径）", async () => {
    installGlobals("youdao")
    const globalSpeak = await loadGlobalSpeak()

    const played = await globalSpeak("hello world")

    expect(played).toBe(true)
    expect(plays.length).toBe(1)
  })

  it("count = 3 ⇒ 连播 3 遍，且只请求一次音频", async () => {
    installGlobals("youdao")
    const globalSpeak = await loadGlobalSpeak()
    let fetchCalls = 0
    vi.stubGlobal("fetch", async () => {
      fetchCalls++
      return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1])]) }
    })

    const played = await globalSpeak("hello world", { count: 3 })

    expect(played).toBe(true)
    expect(plays.length).toBe(3)
 // audioSourceData 要先取好再在循环里复用，不能每遍都 fetch
    expect(fetchCalls).toBe(1)
  })

  it("count = 0 ⇒ 一声不响（「手动」档），且不请求音频", async () => {
    installGlobals("youdao")
    const globalSpeak = await loadGlobalSpeak()
    let fetchCalls = 0
    vi.stubGlobal("fetch", async () => {
      fetchCalls++
      return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1])]) }
    })

    const played = await globalSpeak("hello world", { count: 0 })

    expect(played).toBe(false)
    expect(plays.length).toBe(0)
    expect(fetchCalls).toBe(0)
  })

  it("count 传脏值（NaN / 负数 / 小数）时归一化，不会卡死或播半遍", async () => {
    installGlobals("youdao")
    const globalSpeak = await loadGlobalSpeak()

    // NaN ⇒ 按 1 遍；负数 ⇒ 0（不发声）；小数 ⇒ 向下取整
    await globalSpeak("a", { count: Number.NaN })
    expect(plays.length).toBe(1)

    await globalSpeak("b", { count: -3 })
    expect(plays.length).toBe(1)

    await globalSpeak("c", { count: 2.9 })
    expect(plays.length).toBe(3)
  })

  it("系统语音路径同样遵守 count", async () => {
    installGlobals("browser")
    const globalSpeak = await loadGlobalSpeak()

    const played = await globalSpeak("hello world", { count: 2 })

    expect(played).toBe(true)
    expect(browserSpeaks).toBe(2)
  })

  it("连播途中被更新的一次朗读顶掉 ⇒ 立刻停下，不把上一句念完", async () => {
    installGlobals("youdao")
    const globalSpeak = await loadGlobalSpeak()
    // 让音频永远不 ended，第一次朗读会卡在 gapBefore 等它播完。
    // 这样「被顶掉」与否完全由令牌决定，不受"恰好播完了"的时序干扰。
    class StuckAudio extends FakeAudio {
      play(): Promise<void> {
        plays.push(Date.now())
        return Promise.resolve()
      }
    }
    vi.stubGlobal("Audio", StuckAudio)

    // 等第一次真正播起来再打断，避免两次调用挤在同一个 tick 里
    // （那样第二次也会拿同样的 mySeq 之前/之后状态，测不准）
    const first = globalSpeak("first sentence", { count: 3 })
    await new Promise((r) => setTimeout(r, 30))
    expect(plays.length).toBe(1)

    const second = globalSpeak("second sentence", { count: 1 })
    await Promise.all([first, second])

    // 第一次朗读响过 1 遍后被顶掉，不再补第 2、3 遍；第二次照常响 1 遍
    expect(plays.length).toBe(2)
  })
})
