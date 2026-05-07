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
}

const STORAGE_KEY = "typenow_tts_settings"

const defaults: TTSSettings = {
  source: "browser",
  voice: "",
  youdaoVoice: "youxiaomei",
  volume: 1,
  rate: 0.9,
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

function load(): TTSSettings {
  if (typeof window === "undefined") return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return defaults
}

// ---- Global speak (always reads fresh settings from localStorage) ----
let cachedVoices: SpeechSynthesisVoice[] = []

export function globalSpeak(
  text: string,
  overrides?: { voice?: string; youdaoVoice?: string },
) {
  if (typeof window === "undefined" || !text) return
  const s = load()
  const voice = overrides?.voice ?? s.voice
  const youdaoVoice = overrides?.youdaoVoice ?? s.youdaoVoice

  if (s.source === "browser") {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = "en-GB"
    u.rate = s.rate
    u.volume = s.volume
    if (voice) {
      const voices = cachedVoices.length ? cachedVoices : synth.getVoices()
      cachedVoices = voices
      const v = voices.find((x) => x.name === voice)
      if (v) u.voice = v
    }
    requestAnimationFrame(() => synth.speak(u))
  } else {
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
        if (!res.ok) throw new Error("TTS failed")
        return res.blob()
      })
      .then((blob) => {
        const audio = new Audio(URL.createObjectURL(blob))
        audio.play().catch(() => { /* autoplay may be blocked */ })
      })
      .catch(() => { /* ignore */ })
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
