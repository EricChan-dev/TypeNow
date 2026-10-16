import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `src/lib/confetti.ts` 的回归测试。
 *
 * vitest 跑在 `environment: "node"`（vitest.config.ts:6），没有 jsdom，所以这里
 * 自己把 `window` / `document` / `canvas` / `requestAnimationFrame` 打桩。
 * 测的是**我们不能丢的那部分行为**：
 *   · 模块导入期不碰浏览器全局（SSR 安全）；
 *   · 非浏览器环境下所有导出都安静 no-op，不抛；
 * · 各 API 的粒子数与调色板与练习页的既定观感一致
 *     （答对 50 粒、默认 12 色；完成 每侧 3 粒、7 色、每 250ms 一发、6 秒收工）。
 */

const DEFAULT_COLORS = [
  "#f59e0b", "#ef4444", "#22c55e", "#6366f1", "#ec4899", "#06b6d4",
  "#f97316", "#a855f7", "#10b981", "#fbbf24", "#f43f5e", "#fb923c",
]

const COMPLETION_COLORS = [
  "#ff0040", "#fbbf24", "#3b82f6", "#8b5cf6", "#ec4899", "#10b981", "#00ffff",
]

interface Drawn { x: number; y: number; color: string }

/** 造一个假的 2d 上下文，把每次 ellipse 的落点与颜色记下来。 */
function makeFakeCtx(drawn: Drawn[]) {
  let tx = 0
  let ty = 0
  const stack: Array<[number, number]> = []
  return {
    globalAlpha: 1,
    fillStyle: "#000",
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    save() { stack.push([tx, ty]) },
    restore() { const p = stack.pop(); if (p) { tx = p[0]; ty = p[1] } },
    translate(x: number, y: number) { tx = x; ty = y },
    rotate: vi.fn(),
    ellipse() { drawn.push({ x: tx, y: ty, color: String(this.fillStyle) }) },
  }
}

/** 装好浏览器桩，返回解码后的帧调度器与画布记录。 */
function installBrowserStubs() {
  const drawn: Drawn[] = []
  const ctx = makeFakeCtx(drawn)
  const canvases: Array<Record<string, unknown>> = []
  let pending: FrameRequestCallback | null = null

  const win = {
    innerWidth: 1000,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  }

  const doc = {
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => {
      const el: Record<string, unknown> = {
        style: { cssText: "" },
        dataset: {},
        isConnected: true,
        width: 0,
        height: 0,
        setAttribute: vi.fn(),
        remove: vi.fn(function (this: Record<string, unknown>) {
          // 拆画布时把 isConnected 置假，保证下次 confetti() 会重建。
          this.isConnected = false
        }),
        getContext: () => ctx,
      }
      canvases.push(el)
      return el
    }),
  }

  vi.stubGlobal("window", win)
  vi.stubGlobal("document", doc)
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending = cb
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())

  return {
    drawn,
    canvases,
    ctx,
    /** 手动跑一帧（rAF 桩不会自动跑）。 */
    step() {
      const cb = pending
      pending = null
      cb?.(0)
    },
    /**
     * 清空绘制记录后跑一帧，返回**本帧存活的粒子数**。
     *
     * `drawn` 是逐帧累积的绘制调用记录；不清空的话「不再发射」这类断言会被
     * 之前帧的重绘稀释掉 —— 粒子不会因为 `advanceTimersByTime` 变老，只有
     * 跑帧才会，所以「N 次发射后存活 6N 粒」是确定性的。
     */
    stepFresh() {
      drawn.length = 0
      this.step()
      return drawn.length
    },
    hasPending: () => pending !== null,
  }
}

async function loadModule() {
  vi.resetModules()
  return import("@/lib/confetti")
}

describe("confetti（SSR 安全）", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("在 node（无 window/document）下导入不抛，且所有导出安静 no-op", async () => {
    const mod = await loadModule()
    expect(typeof mod.confetti).toBe("function")
    expect(() => mod.confetti({ particleCount: 10 })).not.toThrow()
    expect(() => mod.fireSuccessBurst()).not.toThrow()
    expect(() => mod.resetConfetti()).not.toThrow()
    const stop = mod.startCompletionFireworks()
    expect(typeof stop).toBe("function")
    expect(() => stop()).not.toThrow()
  })
})

describe("confetti（打桩浏览器）", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

 it("fireSuccessBurst 用答对参数：中心 50 粒、默认调色板", async () => {
    const b = installBrowserStubs()
    const { fireSuccessBurst } = await loadModule()

    fireSuccessBurst()
    b.step() // 第一帧把所有粒子画出来

    // 参数约定：`{ particleCount: 50, spread: 80, origin: { y: 0.55 }, … }`
    expect(b.drawn.length).toBe(50)
    for (const d of b.drawn) expect(DEFAULT_COLORS).toContain(d.color)
    // origin.y = 0.55 × 800 = 440（第一帧已有位移，所以放宽容差）。
    for (const d of b.drawn) {
      expect(Math.abs(d.x - 500)).toBeLessThan(1000)
      expect(Math.abs(d.y - 440)).toBeLessThan(1000)
    }
  })

  it("startCompletionFireworks：每 250ms 双侧各 3 粒、7 色，到点自动收工", async () => {
    const b = installBrowserStubs()
    const { startCompletionFireworks } = await loadModule()

    const stop = startCompletionFireworks(1000)
 // setInterval 语义：第一发在 250ms 之后，不是立刻。
    expect(b.drawn.length).toBe(0)

    vi.advanceTimersByTime(250)
    // 一帧里画出来 6 粒 = 左右各 3 粒。
    expect(b.stepFresh()).toBe(6)
    for (const d of b.drawn) expect(COMPLETION_COLORS).toContain(d.color)
    // 左上（origin.x=1 ⇒ x≈1000 向左上飞）与右上（origin.x=0 ⇒ x≈0 向右上飞）
    // 都从屏幕外往中间打，所以横向散得开。
    expect(b.drawn.some((d) => d.x < 500)).toBe(true)
    expect(b.drawn.some((d) => d.x > 500)).toBe(true)

    // 超过 1000ms 的 duration 之后 interval 必须自己收掉。
    vi.advanceTimersByTime(2000)
    expect(vi.getTimerCount()).toBe(0)
    stop() // 幂等，不该抛
  })

  it("stop() 之后立刻停发，且不需要等 duration 到期", async () => {
    const b = installBrowserStubs()
    const { startCompletionFireworks } = await loadModule()

    const stop = startCompletionFireworks(6000)
    vi.advanceTimersByTime(250)
    expect(b.stepFresh()).toBe(6)
    expect(vi.getTimerCount()).toBe(1)

    stop()
    expect(vi.getTimerCount()).toBe(0)

    // 再放 2 秒也不会有新粒子进来：清空记录后跑一帧，存活数不增长。
    vi.advanceTimersByTime(2000)
    expect(b.stepFresh()).toBe(6)
  })

  it("粒子寿命走完就拆掉画布，不留空转的 rAF 和全屏节点", async () => {
    const b = installBrowserStubs()
    const { fireSuccessBurst, resetConfetti } = await loadModule()

    fireSuccessBurst()
    expect(b.canvases.length).toBe(1)
    // ticks=50 ⇒ 跑满 51 帧后粒子清空并 teardown。
    for (let i = 0; i < 60; i++) {
      if (!b.hasPending()) break
      b.step()
    }
    expect(b.hasPending()).toBe(false)
    expect(b.canvases[0].remove).toHaveBeenCalled()

    // 再发一次应该重建画布（复用同一个 canvas 变量但重新 createElement）。
    fireSuccessBurst()
    expect(b.canvases.length).toBe(2)
    resetConfetti()
  })
})
