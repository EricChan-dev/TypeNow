"use client"

import { useState, useEffect } from "react"
import {
  Volume2, Loader2, MessageSquare, Globe, BookMarked,
  PencilLine, Landmark, MessageCircle, Quote, Sparkles, RefreshCw,
} from "lucide-react"
import type { Sentence } from "@/types"
import type { SentenceKnowledge as TKnowledge } from "@/types/course"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import { dedupRequest, DedupTimeoutError } from "@/lib/dedup"
import { describeKnowledgeFailure, type KnowledgeFailureView } from "@/lib/knowledge-failure"

interface BlockShellProps {
  icon: React.ReactNode
  title: string
  accentClass: string
  children: React.ReactNode
}

function BlockShell({ icon, title, accentClass, children }: BlockShellProps) {
  return (
    <div className={`rounded-xl border ${accentClass} overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-inherit bg-foreground/[0.02]">
        <span className="shrink-0">{icon}</span>
        <h4 className="text-[14px] font-bold text-foreground/85">{title}</h4>
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
  const [failure, setFailure] = useState<KnowledgeFailureView | null>(null)
  // 递增即触发重新请求。用计数器而不是布尔量，是为了让「再次重试」也能生效。
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setFailure(null)
      try {
        // 刻意不传 AbortController：
        //   dedupRequest 共享的是同一个 Promise，而 AbortSignal 是**每个调用者各自**的。
        //   两者天生冲突 —— 任何一次 cleanup（卸载、切句、StrictMode 的挂载→卸载→重挂载）
        //   一旦 abort，就会把这唯一的在途请求打掉，而 dedup 表里仍留着那个注定失败的
        //   Promise，于是下一个调用者立刻拿到同一个错误之上报「网络连接失败」。
        //   实测在 StrictMode 下必然触发；重试按钮在请求进行中点击也会被同样地废掉。
        //   改为只依赖 cancelled 标记忽略结果，请求本身让它跑完 —— 服务端有
        //   sentence_knowledge_cache，多跑的这一次会命中缓存，代价极低。
        const json = await dedupRequest(`knowledge:${sentence.english}`, async () => {
          const res = await fetch("/api/knowledge/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sentence: sentence.english }),
          })
          if (!res.ok) {
            // 必须读一次 body：服务端用 code 区分「未配置」与「临时故障」，
            // 只凭状态码无法判断重试是否有意义。
            // 读 body 自身也可能失败，故降级为 null 而不是继续抛。
            const payload = await res.json().catch(() => null)
            const err = new Error(`knowledge analyze failed: ${res.status}`) as Error & {
              status?: number
              payload?: unknown
            }
            err.status = res.status
            err.payload = payload
            throw err
          }
          return res.json()
        })
        if (!cancelled) {
          setKnowledge(json.data as TKnowledge)
          setLoading(false)
        }
      } catch (e) {
        if (cancelled) return
        // 被中断的请求不是用户的故障，不该报给他看。
        if (e instanceof DOMException && e.name === "AbortError") return
        const err = e as { status?: number; payload?: unknown }
        // 刻意不再回退到 getMockKnowledge()：那些是硬编码占位文案，
        // 挂个角标也改变不了「把假内容当分析结果给用户看」的事实。
        setKnowledge(null)
        setFailure(
          describeKnowledgeFailure(err.status ?? null, err.payload, {
            timedOut: e instanceof DedupTimeoutError,
          }),
        )
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [sentence.id, sentence.english, reloadKey])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-accent/20 blur-xl" />
          <Loader2 className="h-10 w-10 text-accent animate-spin relative" />
        </div>
        <p className="text-sm text-foreground/40">AI 正在分析句子…</p>
      </div>
    )
  }

  if (failure) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
        <div className="rounded-full bg-foreground/[0.06] p-3">
          <MessageSquare className="h-6 w-6 text-foreground/30" />
        </div>
        <p className="text-[15px] font-semibold text-foreground/80">{failure.title}</p>
        <p className="text-[13px] text-foreground/45 leading-relaxed max-w-sm">{failure.detail}</p>
        {failure.canRetry && (
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/[0.05] px-3.5 py-1.5 text-[13px] font-medium text-foreground/70 hover:border-accent/40 hover:text-accent transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        )}
      </div>
    )
  }

  if (!knowledge) return null

  return (
    <div className="space-y-4">
      {/* Header: original sentence */}
      <div className="flex items-center gap-3 px-1">
        <Sparkles className="h-4 w-4 text-accent shrink-0" />
        <p className="text-xl font-bold text-foreground leading-relaxed">{sentence.english}</p>
        <button
          onClick={() => globalSpeak(sentence.english)}
          className="p-2 rounded-full bg-foreground/10 hover:bg-accent/30 hover:text-accent transition-all shrink-0"
        >
          <Volume2 className="h-4 w-4" />
        </button>
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
              className="flex items-start gap-3 rounded-lg bg-foreground/[0.03] border border-foreground/[0.04] px-3.5 py-2.5"
            >
              <span className="text-[11px] font-bold text-foreground/15 shrink-0 mt-0.5 tabular-nums">
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
