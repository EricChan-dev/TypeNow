"use client"

import { useState } from "react"
import { X, Volume2 } from "lucide-react"
import { useTTSSettings, globalSpeak, YOUDAO_EN_VOICES } from "@/lib/hooks/useTTSSettings"
import type { TTSSource } from "@/lib/hooks/useTTSSettings"

interface SettingsModalProps {
  onClose: () => void
}

const SOURCES: { key: TTSSource; label: string }[] = [
  { key: "browser", label: "浏览器" },
  { key: "youdao", label: "有道" },
]

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings, enVoices } = useTTSSettings()
  const [testText] = useState("Hello, this is a test voice.")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[420px] max-h-[80vh] rounded-2xl bg-card border border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 px-5 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground">声音设置</h2>
          <button onClick={onClose} className="p-1 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/10 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Source */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">声音来源</label>
            <div className="flex gap-2">
              {SOURCES.map((src) => (
                <button
                  key={src.key}
                  onClick={() => updateSettings({ source: src.key })}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
                    settings.source === src.key
                      ? "bg-accent/15 border-accent text-accent"
                      : "border-border text-foreground/50 hover:bg-foreground/5"
                  }`}
                >
                  {src.label}
                </button>
              ))}
            </div>
          </div>

          {/* Voice selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">发音人</label>
            <div className="max-h-[200px] overflow-y-auto space-y-1 rounded-lg border border-border p-1">
              {settings.source === "browser" ? (
                enVoices.length === 0 ? (
                  <p className="text-xs text-foreground/30 px-2 py-4 text-center">正在加载发音人列表…</p>
                ) : (
                  enVoices.map((v) => (
                    <div
                      key={v.name}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors cursor-pointer ${
                        settings.voice === v.name ? "bg-accent/10" : "hover:bg-foreground/5"
                      }`}
                      onClick={() => updateSettings({ voice: v.name })}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{v.name}</p>
                        <p className="text-[11px] text-foreground/30">{v.lang}</p>
                      </div>
                      <button
                        className="p-1.5 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors shrink-0"
                        onClick={(e) => { e.stopPropagation(); globalSpeak(testText, { voice: v.name }) }}
                        title="试听"
                      >
                        <Volume2 className="h-3.5 w-3.5 text-foreground/60" />
                      </button>
                    </div>
                  ))
                )
              ) : (
                YOUDAO_EN_VOICES.map((v) => (
                  <div
                    key={v.name}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors cursor-pointer ${
                      settings.youdaoVoice === v.name ? "bg-accent/10" : "hover:bg-foreground/5"
                    }`}
                    onClick={() => updateSettings({ youdaoVoice: v.name })}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{v.label}</p>
                    </div>
                    <button
                      className="p-1.5 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors shrink-0"
                      onClick={(e) => { e.stopPropagation(); globalSpeak(testText, { youdaoVoice: v.name }) }}
                      title="试听"
                    >
                      <Volume2 className="h-3.5 w-3.5 text-foreground/60" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Volume */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">
              音量 <span className="text-foreground/30">{Math.round(settings.volume * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.volume}
              onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
              className="w-full h-1.5 rounded-full appearance-none bg-foreground/10 accent-accent cursor-pointer"
            />
          </div>

          {/* Speed */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">
              语速 <span className="text-foreground/30">{settings.rate.toFixed(2)}x</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={settings.rate}
              onChange={(e) => updateSettings({ rate: parseFloat(e.target.value) })}
              className="w-full h-1.5 rounded-full appearance-none bg-foreground/10 accent-accent cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-foreground/25">
              <span>0.5x 慢</span>
              <span>1.0x 正常</span>
              <span>2.0x 快</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end shrink-0 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-foreground hover:bg-accent/90 transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
