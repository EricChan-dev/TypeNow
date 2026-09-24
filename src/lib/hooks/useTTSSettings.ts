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
 *
 * 为什么必须有版本号：`load()` 是 `{...defaults, ...localStorage}`，老用户的
 * localStorage 里**已经存了** `source:"browser"`，只改 defaults 对他们完全无效，
 * 声音依旧不统一。所以 v1 → v2 迁移时强制把 source 刷成 youdao；用户之后仍可在
 * 设置里自己改回系统语音（那时 version 已是 2，不会再被覆盖）。
 */
const SETTINGS_VERSION = 2

const defaults: TTSSettings = {
  source: "youdao",
  voice: "",
  youdaoVoice: "youxiaomei",
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
  if (!stored?.version || stored.version < SETTINGS_VERSION) {
    merged.source = "youdao"
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
let cachedVoices: SpeechSynthesisVoice[] = []

function speakWithBrowser(text: string, opts: { voice: string; rate: number; volume: number }) {
  const synth = window.speechSynthesis
  synth.cancel()
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
  requestAnimationFrame(() => synth.speak(u))
}

export function globalSpeak(
  text: string,
  overrides?: { voice?: string; youdaoVoice?: string; source?: TTSSource },
) {
  if (typeof window === "undefined" || !text) return
  const s = load()
  const voice = overrides?.voice ?? s.voice
  const youdaoVoice = overrides?.youdaoVoice ?? s.youdaoVoice
  // 设置页试听要能试听「非当前来源」的发音人，所以 source 也允许覆盖。
  const source = overrides?.source ?? s.source
  const browserFallback = () => speakWithBrowser(text, { voice, rate: s.rate, volume: s.volume })

  if (source === "browser") {
    browserFallback()
    return
  }

  fetch("/api/youdao/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voiceName: youdaoVoice,
      speed: s.rate,
      volume: s.volume,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.blob()
    })
    .then((blob) => {
      const audio = new Audio(URL.createObjectURL(blob))
      audio.play().catch(() => { /* autoplay may be blocked */ })
    })
    .catch((err) => {
      // 有道不可用（未配密钥 / 配额用尽 / 超时）时静默无声是最糟的结果：
      // 打字应用宁可退回系统语音，也要让用户听到发音。降级必须留下痕迹。
      console.warn("[TTS] 有道语音不可用，已降级到系统语音:", err)
      browserFallback()
    })
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
