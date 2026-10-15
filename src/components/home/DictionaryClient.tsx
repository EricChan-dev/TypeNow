"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  BookmarkCheck, BookmarkPlus, History, Loader2, Search, Trash2, Volume2,
} from "lucide-react"
import { toast } from "sonner"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import { groupSensesByPos, wrapPhonetic, type DictSense } from "@/lib/dict-display"
import { cn } from "@/lib/utils"

interface DictResult {
  word: string
  phonetic?: string | null
  phoneticUk?: string | null
  translations?: string[] | null
  pos?: DictSense[] | null
  synonyms?: string[] | null
  examples?: { en: string; zh: string }[] | null
  inWordbook?: boolean
}

/** 空态给几个可直接点查的示例词 —— 都是能命中词典接口的常用词 */
const EXAMPLE_WORDS = ["adopt", "gravity", "journey", "knowledge"]

const RECENT_KEY = "typenow:dict-recent"
const RECENT_MAX = 12

/** 错误码 → 用户文案（与 /api/dict/word 的返回对齐） */
const ERROR_TEXT: Record<string, string> = {
  not_found: "词典里没有查到这个词，检查一下拼写",
  empty_result: "词典里没有查到这个词，检查一下拼写",
  invalid_word: "请输入英文单词（字母、空格、连字符或撇号）",
  lookup_failed: "查询服务暂时不可用，请稍后再试",
}

/** 与 WordDetailPopover 同一套归一化：只留字母/撇号/空格/连字符并小写 */
function normalizeWord(raw: string): string {
  return raw.replace(/[^a-zA-Z' -]/g, "").trim().toLowerCase()
}

/**
 * 查询历史不是普通 state，而是 localStorage 这个**外部 store**：
 * 用 useSyncExternalStore 订阅，而不是「mount 后 setState 回填」——
 * 后者是 react-hooks/set-state-in-effect 明确反对的模式，且会多一帧渲染。
 * 快照做模块级缓存，保证「store 没变时返回同一引用」这一契约。
 */
const EMPTY_RECENT: string[] = []
let recentCache: string[] | null = null
const recentListeners = new Set<() => void>()

function readRecentFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr)
      ? arr.filter((w): w is string => typeof w === "string").slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

function getRecentSnapshot(): string[] {
  if (recentCache === null) recentCache = readRecentFromStorage()
  return recentCache
}

function subscribeRecent(onChange: () => void): () => void {
  recentListeners.add(onChange)
  return () => recentListeners.delete(onChange)
}

function notifyRecent() {
  for (const listener of recentListeners) listener()
}

function pushRecent(word: string) {
  const prev = getRecentSnapshot()
  const next = [word, ...prev.filter((w) => w !== word)].slice(0, RECENT_MAX)
  recentCache = next
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式等场景写不进就算了 —— 历史只是体验增强，内存态照常生效
  }
  notifyRecent()
}

function clearRecent() {
  recentCache = []
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {
    // 同上
  }
  notifyRecent()
}

/** 区块小标题 —— 字号/颜色对齐 WordbookClient 的展开详情区 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-semibold">{title}</span>
      {children}
    </div>
  )
}

/**
 * 查单词页。数据全部来自现成的 `/api/dict/word`（freedictionaryapi 上游 +
 * word_dictionary_cache 全站缓存），本组件只负责查询交互与展示：
 *
 * - 美/英两个口音按钮直接指定有道音色（youyating / youxiaoying），不走用户
 *   TTS 设置 —— 口音按钮的意义就在于「明确的口音」，音标旁边标着美/英；
 * - 查询历史存 localStorage（RECENT_KEY），纯客户端、不上服务端；
 * - 同义词可点击继续查 —— 基准实现的「探索单词」我们用这条链路替代。
 */
export function DictionaryClient() {
  const [input, setInput] = useState("")
  /** 当前查询词。空串表示还没查过（展示引导态）。 */
  const [query, setQuery] = useState("")
  const [data, setData] = useState<DictResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recent = useSyncExternalStore(subscribeRecent, getRecentSnapshot, () => EMPTY_RECENT)
  const [busyBookmark, setBusyBookmark] = useState(false)
  /** 正在朗读的口音："us" | "uk" | null */
  const [speaking, setSpeaking] = useState<"us" | "uk" | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 查单词是「来了就搜」的场景，进页面直接聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function search(raw: string) {
    const word = normalizeWord(raw)
    if (!word) {
      setQuery(raw.trim())
      setData(null)
      setError("invalid_word")
      return
    }
    if (word.length > 64) {
      toast.error("单词太长了")
      return
    }
    setQuery(word)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dict/word?word=${encodeURIComponent(word)}`)
      const body = (await res.json().catch(() => ({}))) as Partial<DictResult> & { error?: string }
      if (!res.ok) {
        setData(null)
        setError(body.error ?? "lookup_failed")
        return
      }
      setData(body as DictResult)
      pushRecent(word)
    } catch {
      setData(null)
      setError("lookup_failed")
    } finally {
      // 无论成功/失败都要退出加载态 —— 不然卡片永远被「查询中…」挡住
      setLoading(false)
    }
  }

  async function toggleBookmark() {
    if (!data || busyBookmark) return
    setBusyBookmark(true)
    try {
      if (data.inWordbook) {
        const res = await fetch(`/api/wordbook?word=${encodeURIComponent(data.word)}`, { method: "DELETE" })
        if (!res.ok) throw new Error()
        setData({ ...data, inWordbook: false })
        toast.success("已从单词本移除")
      } else {
        const res = await fetch("/api/wordbook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: data.word }),
        })
        if (!res.ok) throw new Error()
        setData({ ...data, inWordbook: true })
        toast.success("已加入单词本")
      }
    } catch {
      toast.error("操作失败")
    } finally {
      setBusyBookmark(false)
    }
  }

  /**
   * 朗读。音色名来自 YOUDAO_EN_VOICES（useTTSSettings）：
   * youyating = 美式·女（默认音色）、youxiaoying = 英式·女。
   */
  async function speak(accent: "us" | "uk") {
    if (!query || speaking) return
    setSpeaking(accent)
    try {
      const ok = await globalSpeak(query, {
        youdaoVoice: accent === "us" ? "youyating" : "youxiaoying",
        count: 1,
      })
      // globalSpeak 如实返回 false 时是浏览器自动播放策略拦截 —— 如实交代
      if (!ok) toast("浏览器未允许自动播放，点击页面后重试")
    } finally {
      setSpeaking(null)
    }
  }

  const phoneticUs = wrapPhonetic(data?.phonetic)
  const phoneticUk = wrapPhonetic(data?.phoneticUk)
  const posGroups = data?.pos ? groupSensesByPos(data.pos, 3) : []

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      {/* 查单词是单列阅读页，容器比单词本（max-w-5xl）窄一档 */}
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">
        <div className="flex items-center gap-2.5">
          <Search className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-bold text-foreground/80">查单词</h1>
          <span className="text-xs text-foreground/40">释义 · 例句 · 同义词</span>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void search(input) }}
          className="relative"
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/35 pointer-events-none" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入英文单词，回车查询"
            aria-label="要查询的英文单词"
            spellCheck={false}
            autoComplete="off"
            className="w-full h-12 pl-11 pr-24 rounded-xl bg-card border border-border text-[15px] text-foreground placeholder:text-foreground/30 outline-none focus:border-sky-500/50 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-4 rounded-lg bg-sky-500/15 text-sky-300 text-[13px] font-medium hover:bg-sky-500/25 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            查询
          </button>
        </form>

        {recent.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <History className="h-3.5 w-3.5 text-foreground/30 shrink-0" />
            {recent.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => { setInput(w); void search(w) }}
                className="px-2.5 py-1 rounded-full bg-foreground/5 hover:bg-foreground/10 text-[12px] text-foreground/60 transition-colors"
              >
                {w}
              </button>
            ))}
            <button
              type="button"
              onClick={clearRecent}
              title="清空查询历史"
              aria-label="清空查询历史"
              className="w-6 h-6 rounded-full hover:bg-red-500/15 text-foreground/35 hover:text-red-400 flex items-center justify-center transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-foreground/40 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> 查询中…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border bg-card/60 px-6 py-10 text-center space-y-1">
            <div className="text-sm font-semibold text-foreground/75">
              {ERROR_TEXT[error] ?? "查询失败，请稍后再试"}
            </div>
            {query && <div className="text-xs text-foreground/40 font-mono">{query}</div>}
          </div>
        ) : data ? (
          <div className="rounded-2xl border border-border bg-card/60 p-5 sm:p-6 space-y-5">
            {/* 词头：单词 + 美/英音标（各带朗读）+ 单词本收藏 */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-2 min-w-0">
                <h2 className="text-3xl font-bold text-foreground break-words">{data.word}</h2>
                <div className="flex items-center gap-4 flex-wrap">
                  {phoneticUs && (
                    <button
                      type="button"
                      onClick={() => speak("us")}
                      disabled={speaking !== null}
                      className="group flex items-center gap-1.5 text-[13px] text-foreground/55 hover:text-sky-300 transition-colors disabled:opacity-50"
                    >
                      <span className="w-6 h-6 rounded-full bg-foreground/5 group-hover:bg-sky-500/15 flex items-center justify-center transition-colors">
                        {speaking === "us"
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Volume2 className="h-3 w-3" />}
                      </span>
                      美 {phoneticUs}
                    </button>
                  )}
                  {phoneticUk && (
                    <button
                      type="button"
                      onClick={() => speak("uk")}
                      disabled={speaking !== null}
                      className="group flex items-center gap-1.5 text-[13px] text-foreground/55 hover:text-sky-300 transition-colors disabled:opacity-50"
                    >
                      <span className="w-6 h-6 rounded-full bg-foreground/5 group-hover:bg-sky-500/15 flex items-center justify-center transition-colors">
                        {speaking === "uk"
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Volume2 className="h-3 w-3" />}
                      </span>
                      英 {phoneticUk}
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleBookmark}
                disabled={busyBookmark}
                className={cn(
                  "shrink-0 h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50",
                  data.inWordbook
                    ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "bg-foreground/5 text-foreground/60 hover:bg-foreground/10"
                )}
              >
                {busyBookmark
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : data.inWordbook
                    ? <BookmarkCheck className="h-3.5 w-3.5" />
                    : <BookmarkPlus className="h-3.5 w-3.5" />}
                {data.inWordbook ? "已在单词本" : "加入单词本"}
              </button>
            </div>

            {data.translations && data.translations.length > 0 && (
              <Section title="中文释义">
                <div className="text-[14px] text-foreground/85 leading-relaxed">
                  {data.translations.join("；")}
                </div>
              </Section>
            )}

            {posGroups.length > 0 && (
              <Section title="词性 · 释义">
                <div className="space-y-2.5">
                  {posGroups.map((g, i) => (
                    <div key={i} className="flex gap-2.5 text-[13px]">
                      <span className="shrink-0 px-1.5 py-0.5 h-fit rounded bg-violet-500/15 text-violet-300 font-mono text-[10px] uppercase">
                        {g.label}
                      </span>
                      <div className="space-y-1 min-w-0">
                        {g.meanings.map((m, j) => (
                          <div key={j} className="text-foreground/75 leading-snug">{m}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {data.examples && data.examples.length > 0 && (
              <Section title="例句">
                <div className="space-y-2">
                  {data.examples.slice(0, 6).map((e, i) => (
                    <div key={i} className="text-[13px] text-foreground/70 leading-relaxed">
                      <div>{e.en}</div>
                      {e.zh && <div className="text-foreground/45">{e.zh}</div>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {data.synonyms && data.synonyms.length > 0 && (
              <Section title="同义词">
                <div className="flex flex-wrap gap-1.5">
                  {data.synonyms.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setInput(s); void search(s) }}
                      className="px-2.5 py-0.5 rounded-full bg-foreground/5 hover:bg-sky-500/15 hover:text-sky-300 text-[12px] text-foreground/65 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {!data.translations?.length && !posGroups.length && !data.examples?.length && !data.synonyms?.length && (
              <div className="text-[13px] text-foreground/45">词典里暂时没有这个词的详细释义</div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card/60 px-6 py-12 text-center space-y-3">
            <div className="text-base font-semibold text-foreground/80">
              输入英文单词，快速查询释义、例句与同义词
            </div>
            <div className="text-[13px] text-foreground/45">
              查询结果全站缓存；练习页里也可以直接悬浮单词查看
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
              {EXAMPLE_WORDS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => { setInput(w); void search(w) }}
                  className="px-3 py-1 rounded-full bg-foreground/5 hover:bg-sky-500/15 hover:text-sky-300 text-[12px] text-foreground/60 transition-colors"
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
