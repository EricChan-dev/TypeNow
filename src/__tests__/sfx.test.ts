/**
 * 音效开关（src/lib/sfx.ts 的设置解析部分）。
 *
 * 存在的理由：练习页每次按键都放一个 2400Hz sine（playTick），
 * 而设置里只有 TTS 音量，**没有任何地方能关掉击键音**。
 * 开关默认开，保持现有行为不变。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  parseSfxEnabled,
  isSfxEnabled,
  setSfxEnabled,
  subscribeSfxEnabled,
  getSfxEnabledSnapshot,
  getSfxEnabledServerSnapshot,
  SFX_STORAGE_KEY,
} from "@/lib/sfx"

describe("parseSfxEnabled — 容错解析，默认开", () => {
  it("没有存过 → 默认开（不改变现有用户体验）", () => {
    expect(parseSfxEnabled(null)).toBe(true)
  })

  it("明确关闭的值 → false", () => {
    expect(parseSfxEnabled("0")).toBe(false)
    expect(parseSfxEnabled("false")).toBe(false)
  })

  it("明确开启的值 → true", () => {
    expect(parseSfxEnabled("1")).toBe(true)
    expect(parseSfxEnabled("true")).toBe(true)
  })

  it("空串与脏数据 → 回落到默认开，绝不静默把声音关掉", () => {
    expect(parseSfxEnabled("")).toBe(true)
    expect(parseSfxEnabled("abc")).toBe(true)
    expect(parseSfxEnabled("{}")).toBe(true)
    expect(parseSfxEnabled("null")).toBe(true)
  })
})

/**
 * 开关是通过 useSyncExternalStore 订阅的（设置面板有练习页内和全局两处入口，
 * 两处必须同步），所以这里用假的 window.localStorage 验证订阅/快照契约。
 */
describe("音效开关订阅 — useSyncExternalStore 契约", () => {
  const store = new Map<string, string>()
  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  }

  beforeEach(() => {
    store.clear()
    vi.stubGlobal("window", fakeWindow)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("服务端快照恒为默认开 —— SSR 与首屏水合必须一致", () => {
    expect(getSfxEnabledServerSnapshot()).toBe(true)
    store.set(SFX_STORAGE_KEY, "0")
    expect(getSfxEnabledServerSnapshot()).toBe(true)
  })

  it("客户端快照跟随存储值", () => {
    expect(getSfxEnabledSnapshot()).toBe(true)
    setSfxEnabled(false)
    expect(getSfxEnabledSnapshot()).toBe(false)
    expect(isSfxEnabled()).toBe(false)
  })

  it("写入开关会通知订阅者，面板与练习页两处才能同步", () => {
    const listener = vi.fn()
    subscribeSfxEnabled(listener)
    setSfxEnabled(false)
    expect(listener).toHaveBeenCalledTimes(1)
    setSfxEnabled(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("取消订阅后不再收到通知（否则组件卸载后还会被 setState）", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSfxEnabled(listener)
    unsubscribe()
    setSfxEnabled(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it("重复写入同一个值不通知 —— 快照不变就不该触发重渲染", () => {
    const listener = vi.fn()
    subscribeSfxEnabled(listener)
    setSfxEnabled(false)
    setSfxEnabled(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
