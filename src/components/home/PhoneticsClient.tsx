"use client"

/**
 * 音标学习（第一期）：47 个国际音标总览 + 单音详情 + 示例词听读。
 *
 * 纯静态数据（src/lib/phonetics.ts），第一期不接数据库、不记进度。
 * 口音用页内切换（美音 youyating / 英音 youxiaoying），与查单词页同源：
 * globalSpeak 如实返回 false 是浏览器自动播放策略拦截，toast 交代。
 */
import { useState } from "react"
import { toast } from "sonner"
import { ArrowLeft, AudioLines, Volume2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import { PHONEME_GROUPS, type Phoneme } from "@/lib/phonetics"

type Accent = "us" | "uk"

const youdaoVoiceOf = (accent: Accent) => (accent === "us" ? "youyating" : "youxiaoying")

export function PhoneticsClient() {
  const [selected, setSelected] = useState<Phoneme | null>(null)

  if (selected) {
    return <PhonemeDetail phoneme={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-6">
        <div className="flex items-center gap-2.5">
          <AudioLines className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-bold text-foreground/80">音标</h1>
          <span className="text-xs text-foreground/40">47 个国际音标 · 点开听示例词</span>
        </div>

        {PHONEME_GROUPS.map((group) => (
          <section key={group.type} className="space-y-3">
            <h2 className="text-sm font-medium text-foreground/60">
              {group.label}
              <span className="ml-1.5 text-xs text-foreground/35">{group.items.length} 个</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
              {group.items.map((p) => (
                <button
                  key={p.ipa}
                  type="button"
                  onClick={() => setSelected(p)}
                  className="rounded-xl border border-border bg-card px-2 py-3 text-center transition-colors hover:border-sky-400/50 hover:bg-sky-400/5"
                >
                  <span className="block text-xl font-semibold text-foreground">{p.ipa}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {p.name}（{p.mnemonic}）
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function PhonemeDetail({ phoneme, onBack }: { phoneme: Phoneme; onBack: () => void }) {
  const [accent, setAccent] = useState<Accent>("us")

  const speak = async (word: string) => {
    const ok = await globalSpeak(word, { youdaoVoice: youdaoVoiceOf(accent), count: 1 })
    if (!ok) toast("浏览器未允许自动播放，点击页面后重试")
  }

  const playGroup = async () => {
    for (const { word } of phoneme.examples) {
      const ok = await globalSpeak(word, { youdaoVoice: youdaoVoiceOf(accent), count: 1 })
      if (!ok) {
        toast("浏览器未允许自动播放，点击页面后重试")
        return
      }
      // 逐词连播：等上一词出声后再停一拍
      await new Promise((r) => setTimeout(r, 900))
    }
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          全部音标
        </button>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-4xl font-bold text-foreground">{phoneme.ipa}</span>
                <span className="text-sm text-muted-foreground">
                  {phoneme.name}（{phoneme.mnemonic}）
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground/70">{phoneme.tip}</p>
            </div>
            <div
              className="flex shrink-0 rounded-lg border border-border overflow-hidden"
              role="group"
              aria-label="口音切换"
            >
              {(["us", "uk"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAccent(a)}
                  className={cn(
                    "px-2.5 py-1 text-xs transition-colors",
                    accent === a
                      ? "bg-sky-400/15 text-sky-400"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {a === "us" ? "美音" : "英音"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={playGroup}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-400 transition-colors hover:bg-sky-400/20"
          >
            <Volume2 className="h-3.5 w-3.5" />
            连播示例词
          </button>
        </div>

        <ul className="space-y-2">
          {phoneme.examples.map(({ word, zh }) => (
            <li
              key={word}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <button
                type="button"
                onClick={() => speak(word)}
                aria-label={`播放 ${word}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-400/10 text-sky-400 transition-colors hover:bg-sky-400/20"
              >
                <Volume2 className="h-4 w-4" />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{word}</span>
                <span className="block text-xs text-muted-foreground">{zh}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
