/**
 * 练习页音效 —— 统一入口，带可持久化的总开关。
 *
 * 存在的理由：练习页每次按键都放一个 2400Hz sine（playTick），
 * 而设置里只有 TTS 音量，**没有任何地方能关掉击键音**。
 * 打字应用一节课要响上千次，用户只能去调系统音量。
 *
 * 另外这里顺手收掉了两处历史问题：
 *   1. ReviewClient 有一份**自己的** playBuzz（220Hz 单音），与练习页的
 *      双音 buzz 完全不同 —— 同一个产品里「错了」的声音却不一样；
 *   2. 那份实现每次按键都 `new AudioContext()`，浏览器对 AudioContext 数量
 *      有上限（Chrome 约 6 个/页），长时间复习会把上下文耗光后彻底静音。
 * 现在全站共用一个惰性创建的 AudioContext。
 *
 * 开关默认开，保证不改变现有用户听到的声音。
 */

export const SFX_STORAGE_KEY = "typenow_sfx_enabled"

/**
 * 解析存下来的开关值。默认开，脏数据也回落到开 ——
 * 静默把声音关掉是比「多响一次」糟糕得多的失败。
 */
export function parseSfxEnabled(raw: string | null): boolean {
  if (raw === null) return true
  if (raw === "0" || raw === "false") return false
  return true
}

/** 当前是否开启音效。SSR / 无 localStorage 时按默认开处理。 */
export function isSfxEnabled(): boolean {
  if (typeof window === "undefined") return true
  try {
    return parseSfxEnabled(window.localStorage.getItem(SFX_STORAGE_KEY))
  } catch {
    return true
  }
}

/** 写入音效开关。localStorage 不可用（隐私模式）时不抛异常，只是不持久化。 */
export function setSfxEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return
  // 值没变就不通知：快照不变还通知，useSyncExternalStore 会白白重渲染一轮
  if (isSfxEnabled() === enabled) return
  try {
    window.localStorage.setItem(SFX_STORAGE_KEY, enabled ? "1" : "0")
  } catch {
    /* ignore */
  }
  notify()
}

// ── 订阅（useSyncExternalStore）────────────────────────────────────────────
//
// 设置面板有两个入口（练习页内的 SettingsModal 与全局 GlobalSettingsModal），
// 它们必须显示同一个状态。用 effect 里 setState 读 localStorage 会同时踩两个坑：
// 首屏水合不一致，以及两处开关各说各话。订阅式读值把这两件事一次解决。

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** 订阅开关变化，返回取消订阅函数。 */
export function subscribeSfxEnabled(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 客户端快照。返回布尔字面量，值不变时引用天然相等。 */
export function getSfxEnabledSnapshot(): boolean {
  return isSfxEnabled()
}

/** 服务端/首屏快照：恒为默认开，保证 SSR 输出与客户端首帧一致。 */
export function getSfxEnabledServerSnapshot(): boolean {
  return true
}


// ── Web Audio ────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!isSfxEnabled()) return null
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    return audioCtx
  } catch {
    return null
  }
}

/** 1. 字符输入 / 词确认 —— 干脆的咔哒声 */
export function playTick(): void {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = "sine"
  osc.frequency.setValueAtTime(2400, now)
  osc.frequency.exponentialRampToValueAtTime(1800, now + 0.02)
  gain.gain.setValueAtTime(0.3, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
  osc.start(now)
  osc.stop(now + 0.03)
}

/** 2. 敲错 —— 尖锐的双音提示 */
export function playBuzz(): void {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  ;[800, 600].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "triangle"
    const t = now + i * 0.08
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.24, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    osc.start(t)
    osc.stop(t + 0.1)
  })
}

/** 3. 整句完成 —— 明亮的上升琶音 */
export function playChime(): void {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  const notes = [880, 1109, 1319, 1760] // A5, C#6, E6, A6
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "sine"
    const t = now + i * 0.08
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(0.24, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    osc.start(t)
    osc.stop(t + 0.25)
  })
}
