"use client"

import { useState, useEffect } from "react"
import {
  Volume2, Loader2, MessageSquare, Globe, BookMarked,
  PencilLine, Landmark, MessageCircle, Quote, Sparkles, Database,
} from "lucide-react"
import type { Sentence } from "@/types"
import type { SentenceKnowledge as TKnowledge } from "@/types/course"
import { getMockKnowledge } from "@/lib/mock-data/knowledge"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import { dedupRequest } from "@/lib/dedup"

interface BlockShellProps {
  icon: React.ReactNode
  title: string
  accentClass: string
  children: React.ReactNode
}

function BlockShell({ icon, title, accentClass, children }: BlockShellProps) {
  return (
    <div className={`rounded-xl border ${accentClass} overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-inherit bg-white/[0.02]">
        <span className="shrink-0">{icon}</span>
        <h4 className="text-[14px] font-bold text-white/85">{title}</h4>
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </div>
  )
}

interface SentenceKnowledgeProps {
  sentence: Sentence
}

export function SentenceKnowledge({ sentence }: SentenceKnowledgeProps) {
  const [knowledge, setKnowledge] = useState<TKnowledge | null>(null)
  const [loading, setLoading] = useState(false)
  const [isMock, setIsMock] = useState(false)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setIsMock(false)
      try {
        const json = await dedupRequest(`knowledge:${sentence.english}`, async () => {
          const res = await fetch("/api/knowledge/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sentence: sentence.english }),
            signal: controller.signal,
          })
          if (!res.ok) throw new Error("API error")
          return res.json()
        })
        if (!cancelled) {
          setKnowledge(json.data as TKnowledge)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setKnowledge(getMockKnowledge(sentence.id))
          setIsMock(true)
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true; controller.abort() }
  }, [sentence.id, sentence.english])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-accent/20 blur-xl" />
          <Loader2 className="h-10 w-10 text-accent animate-spin relative" />
        </div>
        <p className="text-sm text-white/40">AI 正在分析句子…</p>
      </div>
    )
  }

  if (!knowledge) return null

  return (
    <div className="space-y-4">
      {/* Header: original sentence + offline badge */}
      <div className="flex items-center gap-3 px-1">
        <Sparkles className="h-4 w-4 text-accent shrink-0" />
        <p className="text-xl font-bold text-white leading-relaxed">{sentence.english}</p>
        <button
          onClick={() => globalSpeak(sentence.english)}
          className="p-2 rounded-full bg-white/10 hover:bg-accent/30 hover:text-accent transition-all shrink-0"
        >
          <Volume2 className="h-4 w-4" />
        </button>
        {isMock && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-medium text-amber-400/70 shrink-0">
            <Database className="h-3 w-3" />
            缓存数据
          </span>
        )}
      </div>

      {/* Chinese + English explanation */}
      <div className="grid grid-cols-1 gap-3">
        <BlockShell
          icon={<MessageSquare className="h-4 w-4 text-amber-400" />}
          title="中文解释"
          accentClass="border-amber-500/20 bg-amber-500/[0.03]"
        >
          <p className="text-[15px] text-amber-100/80 leading-relaxed">{knowledge.chineseExplanation}</p>
        </BlockShell>

        <BlockShell
          icon={<Globe className="h-4 w-4 text-sky-400" />}
          title="英文解释"
          accentClass="border-sky-500/20 bg-sky-500/[0.03]"
        >
          <p className="text-[15px] text-sky-100/75 leading-relaxed">{knowledge.englishExplanation}</p>
        </BlockShell>
      </div>

      {/* Word Annotations */}
      <BlockShell
        icon={<BookMarked className="h-4 w-4 text-emerald-400" />}
        title="单词短语注解"
        accentClass="border-emerald-500/20 bg-emerald-500/[0.03]"
      >
        <div className="text-[14px] text-emerald-100/70 leading-relaxed whitespace-pre-line">
          {knowledge.wordAnnotations}
        </div>
      </BlockShell>

      {/* Grammar Analysis */}
      <BlockShell
        icon={<PencilLine className="h-4 w-4 text-violet-400" />}
        title="语法分析"
        accentClass="border-violet-500/20 bg-violet-500/[0.03]"
      >
        <div className="text-[14px] text-violet-100/70 leading-relaxed whitespace-pre-line">
          {knowledge.grammarAnalysis}
        </div>
      </BlockShell>

      {/* Culture Notes */}
      <BlockShell
        icon={<Landmark className="h-4 w-4 text-rose-400" />}
        title="文化与实用知识"
        accentClass="border-rose-500/20 bg-rose-500/[0.03]"
      >
        <div className="text-[14px] text-rose-100/70 leading-relaxed whitespace-pre-line">
          {knowledge.cultureNotes}
        </div>
      </BlockShell>

      {/* Usage Scenarios */}
      <BlockShell
        icon={<MessageCircle className="h-4 w-4 text-orange-400" />}
        title="功能和使用场景"
        accentClass="border-orange-500/20 bg-orange-500/[0.03]"
      >
        <div className="text-[14px] text-orange-100/70 leading-relaxed whitespace-pre-line">
          {knowledge.usageScenarios}
        </div>
      </BlockShell>

      {/* Related Examples */}
      <BlockShell
        icon={<Quote className="h-4 w-4 text-cyan-400" />}
        title="相关例句"
        accentClass="border-cyan-500/20 bg-cyan-500/[0.03]"
      >
        <div className="space-y-2.5">
          {knowledge.relatedExamples.split("\n").filter(Boolean).map((example, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/[0.04] px-3.5 py-2.5"
            >
              <span className="text-[11px] font-bold text-white/15 shrink-0 mt-0.5 tabular-nums">
                {i + 1}
              </span>
              <p className="text-[14px] text-cyan-100/70 leading-relaxed">{example}</p>
            </div>
          ))}
        </div>
      </BlockShell>
    </div>
  )
}
