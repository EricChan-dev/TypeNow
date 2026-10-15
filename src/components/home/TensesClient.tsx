"use client"

/**
 * 英语 16 时态知识库（第一期）：按「时间 × 体」总览 + 单时态详情 + 例句听读。
 *
 * 纯静态数据（src/lib/tenses.ts），与音标页同构：不接数据库、不记进度。
 * 例句朗读复用 globalSpeak（美音），浏览器自动播放被拦截时 toast 交代。
 */
import { useState } from "react"
import { toast } from "sonner"
import { ArrowLeft, CalendarClock, Volume2 } from "lucide-react"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import {
  ASPECT_LABELS,
  TENSES,
  TENSE_GROUPS,
  TIME_LABELS,
  type TenseInfo,
} from "@/lib/tenses"

export function TensesClient() {
  const [selected, setSelected] = useState<TenseInfo | null>(null)

  if (selected) {
    return <TenseDetail tense={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-6">
        <div className="flex items-center gap-2.5">
          <CalendarClock className="h-5 w-5 text-violet-400" />
          <h1 className="text-lg font-bold text-foreground/80">16 时态</h1>
          <span className="text-xs text-foreground/40">
            {TENSES.length} 个时态 · 时间 × 体 · 点开看构成与例句
          </span>
        </div>

        {TENSE_GROUPS.map((group) => (
          <section key={group.time} className="space-y-3">
            <h2 className="text-sm font-medium text-foreground/60">
              {TIME_LABELS[group.time]}
              <span className="ml-1.5 text-xs text-foreground/35">{group.items.length} 种</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {group.items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className="rounded-xl border border-border bg-card px-2 py-3 text-center transition-colors hover:border-violet-400/50 hover:bg-violet-400/5"
                >
                  <span className="block text-sm font-semibold text-foreground">{t.name}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {t.enName}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-violet-400/70">
                    {ASPECT_LABELS[t.aspect]}
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

function FormulaRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2">
      <span className="mt-0.5 w-9 shrink-0 text-center text-[11px] font-medium text-foreground/50">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm text-foreground/85">{text}</span>
    </div>
  )
}

function TenseDetail({ tense, onBack }: { tense: TenseInfo; onBack: () => void }) {
  const speak = async (text: string) => {
    const ok = await globalSpeak(text, { youdaoVoice: "youyating", count: 1 })
    if (!ok) toast("浏览器未允许自动播放，点击页面后重试")
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
          全部时态
        </button>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-2xl font-bold text-foreground">{tense.name}</span>
              <span className="text-sm text-muted-foreground">{tense.enName}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/70">{tense.usage}</p>
          </div>

          <div className="space-y-1.5">
            <FormulaRow label="肯定" text={tense.formula} />
            <FormulaRow label="否定" text={tense.negative} />
            <FormulaRow label="疑问" text={tense.question} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {tense.markers.map((m) => (
              <span
                key={m}
                className="rounded-full bg-violet-400/10 px-2.5 py-0.5 text-[11px] text-violet-400"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        <ul className="space-y-2">
          {tense.examples.map(({ en, zh }) => (
            <li
              key={en}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <button
                type="button"
                onClick={() => speak(en)}
                aria-label={`播放 ${en}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-400/10 text-violet-400 transition-colors hover:bg-violet-400/20"
              >
                <Volume2 className="h-4 w-4" />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{en}</span>
                <span className="block text-xs text-muted-foreground">{zh}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
