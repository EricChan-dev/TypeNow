"use client"

import { useState, useEffect, useCallback } from "react"

export type TTSSource = "browser" | "youdao"

export interface YoudaoVoice {
  name: string
  label: string
}

export interface TTSSettings {
  source: TTSSource
  voice: string
  youdaoVoice: string
  volume: number
  rate: number
  /** 配置结构版本，只用于一次性迁移，不参与 UI。 */
  version: number
}

const STORAGE_KEY = "typenow_tts_settings"

/**
 * 配置结构版本。
 *   v1 — source 默认 "browser"（系统语音），有道只是可选
 *   v2 — source 默认 "youdao"，全站朗读统一走有道
 *   v3 — 默认音色改为「有雅婷 (美式·女)」（原先是有小美）
 *
 * 为什么必须有版本号：`load()` 是 `{...defaults, ...localStorage}`，老用户的
 * localStorage 里**已经存了** `source:"browser"`，只改 defaults 对他们完全无效，
 * 声音依旧不统一。所以 v1 → v2 迁移时强制把 source 刷成 youdao；用户之后仍可在
 * 设置里自己改回系统语音（那时 version 已是 2，不会再被覆盖）。
 *
 * v2 → v3 同理，而这次是**音色**：localStorage 里躺着 `youdaoVoice:"youxiaomei"`
 * 的人（包括从没进过设置页的 —— 任何一次 updateSettings 都会把整个对象写回去）
 * 光改 defaults 是听不出变化的。所以 v3 迁移强制刷成 youyating。代价是"特意选过
 * youxiaomei 的人"也会被改一次：他只会在设置页再点一次，而反过来（不强制）
 * 则等于"改了默认值却对所有老用户无效"。
 */
const SETTINGS_VERSION = 3

/** 默认音色：有雅婷（美式·女）。设置页可从 YOUDAO_EN_VOICES 里换。 */
const DEFAULT_YOUDAO_VOICE = "youyating"

const defaults: TTSSettings = {
  source: "youdao",
  voice: "",
  youdaoVoice: DEFAULT_YOUDAO_VOICE,
  volume: 1,
  rate: 0.9,
  version: SETTINGS_VERSION,
}

export const YOUDAO_EN_VOICES: YoudaoVoice[] = [
  { name: "youxiaomei", label: "有小美 (美式·女)" },
  { name: "youxiaoying", label: "有小英 (英式·女)" },
  { name: "youxiaoguan", label: "有小官 (英式·男)" },
  { name: "youyating", label: "有雅婷 (美式·女)" },
  { name: "Saila", label: "Saila (英式·女)" },
  { name: "Auriana", label: "Auriana (英式·女)" },
  { name: "youxiaodao", label: "有小道 (美式·女)" },
]

/**
 * 把「localStorage 里存的配置」补全并做一次性迁移。纯函数，便于单测。
 *
 * v1 的默认是 browser，老用户即便从没动过设置，localStorage 里也可能已经躺着
 * `source:"browser"`（任何一次 updateSettings 都会把整个对象写回去）。
 * 因此这里必须主动改写 source，而不是只依赖 defaults。
 */
export function migrateTTSSettings(stored: Partial<TTSSettings> | null | undefined): TTSSettings {
  const merged: TTSSettings = { ...defaults, ...(stored ?? {}) }
  const from = stored?.version ?? 0

  if (from < 2) {
    merged.source = "youdao"
  }
  if (from < 3) {
    // 音色：老配置存着旧默认 youxiaomei，不刷的话"改了默认值"对所有人无效
    merged.youdaoVoice = DEFAULT_YOUDAO_VOICE
  }
  if (from < SETTINGS_VERSION) {
    merged.version = SETTINGS_VERSION
  }
  return merged
}

function load(): TTSSettings {
  if (typeof window === "undefined") return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const merged = migrateTTSSettings(JSON.parse(raw) as Partial<TTSSettings>)
    // 迁移结果要落盘，否则每次朗读都会重新走一遍迁移分支
    if (raw !== JSON.stringify(merged)) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)) } catch { /* ignore */ }
    }
    return merged
  } catch { /* ignore */ }
  return defaults
}

// ---- Global speak (always reads fresh settings from localStorage) ----

/**
 * 当前正在播放的音频（全站唯一）。
 *
 * 为什么必须集中管理：原先每个调用点各自 `new Audio(...)`，谁也不管谁 ——
 * 于是"练完一课退出、再进另一课"会把两课的第一句**同时**念出来（前一句的
 * audio 没人停）。而按钮念、悬浮单词念、自动念三处音色不一致，根源也是它们
 * 各自发请求、各自带着（或不带）音色参数。
 *
 * 现在所有播放都走这里面，播新的之前先把旧的停掉。
 */
let currentAudio: HTMLAudioElement | null = null

/**
 * 朗读请求序号。**后发优先**：每次朗读领一个号，音频取回来时如果号已经不是最新的，
 * 就说明期间又有人要念别的内容，这次直接丢弃。
 *
 * 为什么需要它：globalSpeak 是先 fetch 音频再播放的，取回来要几百毫秒。
 * 并发两次调用时（进练习页会先后触发两次：先恢复会话、再自动播放本轮句子），
 * 先发的那次完全可能**后**取回音频 —— 没有这道判断，它就会把后发的那一句盖掉，
 * 甚至两段一起出声。
 */
let speakSeq = 0

/**
 * 当前这次播放的「播完」deferred。
 *
 * 为什么要单独开一套：`globalSpeak` 的返回值语义是**有没有开始播**（有道路径里
 * 它是 `await audio.play()` 的产物，而 `play()` 一开始播就 resolve）。「词发音
 * 按钮的脉冲动画」「念完再干下一件事」这类场景要的却是**播完了没有**。
 * 把两者混在一个 promise 上，调用方只能二选一：要么按钮永远不亮，要么
 * 「停止」按钮失效。
 */
let endDeferred: { promise: Promise<void>; resolve: () => void } | null = null
let endTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 播放超时兜底（15s）：
 * `ended` / `pause` / `error` 都不触发时（解码卡死、设备被拔），
 * 没有它等待方会永远挂着。
 */
const PLAYBACK_TIMEOUT_MS = 15000

/** 开始一次播放：先叫醒上一个等待方，再给这次建一个新的 deferred。 */
function beginPlayback(): void {
  resolveEnd()
  let resolveFn!: () => void
  const promise = new Promise<void>((r) => {
    resolveFn = r
  })
  endDeferred = { promise, resolve: resolveFn }
  endTimer = setTimeout(resolveEnd, PLAYBACK_TIMEOUT_MS)
}

/** 收尾：叫醒等待方。幂等，重复调用安全。 */
function resolveEnd(): void {
  if (endTimer) {
    clearTimeout(endTimer)
    endTimer = null
  }
  const d = endDeferred
  endDeferred = null
  d?.resolve()
}

/**
 * 等当前这次朗读播完。此刻没有朗读在播时立即 resolve。
 *
 * 与 `globalSpeak` 的分工：`globalSpeak` 回答「出声了没有」（用于自动播放被拦时
 * 提示用户），本函数回答「播完了没有」（用于播放中的视觉状态、念完再进下一步）。
 */
export function waitForSpeechEnd(): Promise<void> {
  return endDeferred ? endDeferred.promise : Promise.resolve()
}

/**
 * 「此刻是否有朗读在响」的订阅式状态。
 *
 * 为什么需要它：`globalSpeak` 返回的布尔值只说明**有没有开始播**——
 * 有道路径里它是 `await audio.play()` 的产物，而 `play()` 在**开始播放**的
 * 瞬间就 resolve，不等播完。于是「朗读/停止」按钮的 `playing` 状态会立刻复位，
 * 停止分支只在 fetch 音频的那几百毫秒内可达 —— 用户看到的就是「长句念起来停不掉」，
 * 只能退出页面。更糟的是它连带影响跟读评分：录音时参考音还在响，会被麦克风采进去，
 * 评出虚高的分。
 *
 * 按仓库既有约定（见 lib/sfx.ts、lib/desktop-only.ts）用模块级订阅而不是 Context：
 * 这类状态只有「开/关」两态，且要被练习页之外的地方读。
 */
let speaking = false
const speakingListeners = new Set<() => void>()

function setSpeaking(next: boolean): void {
  if (speaking === next) return
  speaking = next
  for (const listener of speakingListeners) listener()
}

/** 当前是否有朗读在响。作为 useSyncExternalStore 的 getSnapshot。 */
export function isSpeaking(): boolean {
  return speaking
}

/**
 * 当前正在播放的音频元素（没有则为 null）。
 *
 * 导出的目的：声音频谱条需要把这个元素接进 AnalyserNode 才能取到频谱数据。
 * 只读，不转移所有权 —— 元素的 play/pause 生命周期仍由本模块管理。
 */
export function getCurrentAudioElement(): HTMLAudioElement | null {
  return currentAudio
}

/** 订阅朗读状态变化；返回取消订阅函数（用法与 useSyncExternalStore 一致）。 */
export function subscribeSpeaking(listener: () => void): () => void {
  speakingListeners.add(listener)
  return () => {
    speakingListeners.delete(listener)
  }
}

/**
 * 停掉当前正在播放的朗读（有道音频与系统语音都停）。
 *
 * 导出的目的：调用方在离开练习页/切课时可以主动收声，而不必等下一次朗读
 * 才被"顺带"停掉。
 */
export function stopSpeaking(): void {
  // 推进序号：让还在路上的朗读请求回来时自动作废，不再补出一句
  // （离开练习页时正是这种情况）
  speakSeq++
  if (currentAudio) {
    try {
      currentAudio.pause()
      // 清 src 是为了让浏览器立刻释放网络/解码资源，而不是等它自己播完
      currentAudio.src = ""
    } catch { /* ignore */ }
    currentAudio = null
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
  // pause() 不会触发 ended，所以这里必须自己收尾，否则订阅方会一直以为还在响
  setSpeaking(false)
  // 同理，等「播完」的调用方也收不到 ended —— 主动叫醒，别让它们挂死。
  resolveEnd()
}

let cachedVoices: SpeechSynthesisVoice[] = []

function speakWithBrowser(
  text: string,
  opts: { voice: string; rate: number; volume: number },
  seq: number,
) {
  // 「播完」的 deferred 必须**同步**建好：调用方 `await globalSpeak()` 拿到 true
  // 之后立刻 `await waitForSpeechEnd()`，而下面的 rAF 还没执行 —— 建晚了就会
  // 拿到「当前没有朗读」的空 promise，`speakingWordIndex` 会立刻被清掉。
  beginPlayback()
  const synth = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(text)
  u.lang = "en-GB"
  u.rate = opts.rate
  u.volume = opts.volume
  if (opts.voice) {
    const voices = cachedVoices.length ? cachedVoices : synth.getVoices()
    cachedVoices = voices
    const v = voices.find((x) => x.name === opts.voice)
    if (v) u.voice = v
  }
  // rAF 是为了避开 Chrome「cancel() 之后紧接着 speak() 会被吞掉」的怪癖。
  // 但它也让这段话逃出了 stopSpeaking() 的 cancel —— 期间若有更新的朗读请求，
  // 这里必须自己放弃，否则会把新的一句盖掉（同样是"两个人声"的来源之一）。
  requestAnimationFrame(() => {
    if (seq !== speakSeq) return
    // 系统语音没有可靠的"开始播放"事件，只能按调用即视为在响；
    // onend / onerror 收尾。若浏览器吞掉了这次 speak（Chrome 的已知怪癖），
    // 状态会停在 true —— 由下一次 stopSpeaking() 或新的朗读纠正。
    setSpeaking(true)
    const done = () => {
      if (seq === speakSeq) {
        setSpeaking(false)
        resolveEnd()
      }
    }
    u.onend = done
    u.onerror = done
    synth.speak(u)
  })
}

/**
 * 朗读。返回**是否真的出声了**。
 *
 * 为什么要把这个布尔值暴露出来：浏览器自动播放策略会拦掉「页面加载后、用户还没
 * 有任何操作」时的音频播放，而练习页的第一句恰恰就是在挂载时自动播的。旧实现把
 * `audio.play()` 的失败整个吞掉（`.catch(() => {})`），结果是**第一句永远静音，
 * 而且没有任何提示** —— 用户只会觉得「这软件发音时好时坏」。
 *
 * 现在如实返回 false，由调用方决定怎么交代（练习页给一个「点一下开启发音」的按钮）。
 *
 * `overrides.count` 是**连播次数**，口径：
 *   · 不传 ⇒ 1 次（词发音、设置页试听、回顾屏朗读都是这个口径）；
 * · 0 ⇒ **一声不响**，即「自动播放次数 = 手动」那一档，连播循环体一次都不进；
 *   · N>1 ⇒ 连播 N 次，每次等上一遍**播完**再停 600ms。
 * 手动点播放按钮时调用方要把 0 换成 1。
 */
export async function globalSpeak(
  text: string,
  overrides?: { voice?: string; youdaoVoice?: string; source?: TTSSource; count?: number },
): Promise<boolean> {
  if (typeof window === "undefined" || !text) return false
  const mySeq = ++speakSeq
  const s = load()
  const voice = overrides?.voice ?? s.voice
  const youdaoVoice = overrides?.youdaoVoice ?? s.youdaoVoice
  // 设置页试听要能试听「非当前来源」的发音人，所以 source 也允许覆盖。
  const source = overrides?.source ?? s.source
  // 未传按 1 次；0 是「手动档」的合法值，不能被 ?? 或 || 吞掉。
  const rawCount = overrides?.count
  const count =
    rawCount === undefined || !Number.isFinite(rawCount) ? 1 : Math.max(0, Math.floor(rawCount))
  // 手动档：本次不发声。序号已经在上面自增，正在途中的朗读会因 `mySeq !== speakSeq`
  // 自行放弃，所以不会「设成手动了却还在念上一句」。
  if (count === 0) return false
  // 停掉上一段 + 浏览器路径都带上本次序号
  const browserFallback = () =>
    speakWithBrowser(text, { voice, rate: s.rate, volume: s.volume }, mySeq)

  /**
 * 连播时的遍间等待：先等上一遍播完，再停 600ms。
   * 返回 false 表示期间有更新的朗读把它顶掉了，循环应立即退出。
   *
   * **失效令牌不能用最初的 `mySeq`**：循环里每一遍都要先 `stopSpeaking()`
   * （见下面那段注释），而 `stopSpeaking()` 自己就会 `speakSeq++` —— 它推进
   * 序号是为了作废"还在路上的 fetch"，不是宣告"有新的朗读"。拿最初的 mySeq 去
   * 比对的话，我们自己每停一次就把自己判成"已被顶掉"，循环第一遍之后必然退出，
   * `count` 形同虚设（这正是「自动播放次数」曾经是死开关的根因）。
   *
   * 所以令牌是**可认领的**：每遍 `stopSpeaking()` 之后立刻把它认领成当前
   * `speakSeq`（那次推进算我们自己的），此后只有**别人**再推进才表示被顶掉。
   */
  let token = mySeq
  const superseded = () => speakSeq > token

  const gapBefore = async (i: number): Promise<boolean> => {
    if (i === 0) return true
    await waitForSpeechEnd()
    if (superseded()) return false
    await new Promise((r) => window.setTimeout(r, 600))
    return !superseded()
  }

  if (source === "browser") {
    let playedAny = false
    for (let i = 0; i < count; i++) {
      if (!(await gapBefore(i))) return false
      browserFallback()
      playedAny = true
    }
    // speechSynthesis 不出声时不会抛错也不会给事件，没有可靠的探测手段。
    // 谎报 false 会让所有系统语音用户都看到一个多余的按钮，所以按「成功」处理。
    return playedAny
  }

  try {
    const res = await fetch("/api/youdao/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceName: youdaoVoice,
        speed: s.rate,
        volume: s.volume,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    // 期间又有人要念别的内容：这次丢弃。不加这道判断，先发后到的请求会把
    // 后发的那一句盖掉（进练习页会先后触发两次朗读）
    if (mySeq !== speakSeq) return false

    let playedAny = false
 // 音频只取一次，之后复用同一个 blob，不重复请求接口。
    for (let i = 0; i < count; i++) {
      if (!(await gapBefore(i))) return playedAny
      /**
       * **就在播放前**停掉上一段。
       *
       * 这一行原先在函数开头（fetch 之前），那是错的：两次并发调用会各自
       * "先停、再取"，取回音频的先后顺序不确定 —— 先发的那次若后取回，
       * 它会在没人停它的状态下直接 play，于是两段音频同时出声
       * （用户报的"同时发音 greeting 和 good"就是它）。
       * 只有紧挨着 play 之前停，才能保证同一时刻只有一段在响。
       */
      stopSpeaking()
      // 认领令牌：这次 `speakSeq++` 是我们自己停上一遍造成的，不算"被顶掉"。
      token = speakSeq
      // stopSpeaking() 刚把上一段的等待方叫醒，这里紧接着为本次播放建新的
      // deferred —— 顺序不能反，否则会把自己这次的等待方立刻放走。
      beginPlayback()
      const audio = new Audio(URL.createObjectURL(blob))
      currentAudio = audio
      // 收尾必须带 `currentAudio === audio` 的判断：期间可能有更新的朗读把
      // currentAudio 换成别的音频，那时这次的回调不该去改全局状态。
      // 只有**仍然是当前这段**时才收尾并叫醒等待方：被更新的朗读顶掉时，
      // `stopSpeaking()` 已经叫醒过等待方了；这里若无条件叫醒，会把*新*那段
      // 的等待方提前放走（旧音频的 ended 总是晚于新朗读的开始）。
      const settle = () => {
        if (currentAudio === audio) {
          currentAudio = null
          setSpeaking(false)
          resolveEnd()
        }
      }
      audio.onended = () => {
        URL.revokeObjectURL(audio.src)
        settle()
      }
      audio.onerror = () => {
        settle()
      }
      try {
        await audio.play()
        // play() 在**开始播放**时即 resolve，所以这里标记"在响"，
        // 由 onended 负责收尾 —— 这正是「停止」按钮能用的前提。
        if (currentAudio === audio) setSpeaking(true)
        playedAny = true
      } catch {
        // 自动播放被拦。这**不是**「有道不可用」，所以不能顺手降级成系统语音 ——
        // 系统语音被同一条策略管着，一样发不出声，降级只会让失败更难被看见。
        if (currentAudio === audio) {
          currentAudio = null
          setSpeaking(false)
        }
        // 第一遍就播不出来 ⇒ 整次朗读失败，如实回报给调用方去提示用户；
        // 连播途中才失败 ⇒ 前面已经响过，按成功处理，别让按钮又亮一次。
        return playedAny
      }
    }
    return playedAny
  } catch (err) {
    // 有道不可用（未配密钥 / 配额用尽 / 超时）时静默无声是最糟的结果：
    // 打字应用宁可退回系统语音，也要让用户听到发音。降级必须留下痕迹。
    if (mySeq !== speakSeq) return false
    console.warn("[TTS] 有道语音不可用，已降级到系统语音:", err)
    browserFallback()
    return true
  }
}

// ---- Hook for settings UI ----
export function useTTSSettings() {
  const [settings, setSettings] = useState<TTSSettings>(defaults)
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    setSettings(load())
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const update = () => {
      const v = window.speechSynthesis.getVoices()
      cachedVoices = v
      setBrowserVoices(v)
    }
    update()
    window.speechSynthesis.addEventListener("voiceschanged", update)
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update)
  }, [])

  const ALLOWED_VOICES = [
    "Daniel", "Eddy", "Flo", "Fred", "Junior",
    "Karen", "Moira", "Ralph", "Samantha", "Tessa",
  ]
  const enVoices = browserVoices.filter(
    (v) =>
      v.lang.startsWith("en") &&
      ALLOWED_VOICES.some((name) => v.name.startsWith(name)),
  )

  const updateSettings = useCallback((patch: Partial<TTSSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* */ }
      return next
    })
  }, [])

  return { settings, updateSettings, enVoices }
}
