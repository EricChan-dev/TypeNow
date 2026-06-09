"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BookText, Loader2, Trash2, Volume2, ChevronDown, ChevronRight } from "lucide-react"
import { toast } from "sonner"

interface WordbookRow {
  id: string
  word: string
  sourceSentenceId: string | null
  addedAt: string
  phonetic: string | null
  phoneticUk: string | null
  translations: string[] | null
  pos: { pos: string; meaning: string }[] | null
  synonyms: string[] | null
  examples: { en: string; zh: string }[] | null
}

function fmt(d: string) {
  try {
    const dt = new Date(d)
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, "0")
    const day = String(dt.getDate()).padStart(2, "0")
    return `${y}/${m}/${day}`
  } catch { return "" }
}

export function WordbookClient() {
  const [items, setItems] = useState<WordbookRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/wordbook?page=1&size=100")
      const j = await res.json()
      setItems(j.items ?? [])
      setTotal(Number(j.total ?? 0))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const removeWord = async (word: string) => {
    setBusy(word)
    try {
      const res = await fetch(`/api/wordbook?word=${encodeURIComponent(word)}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setItems((prev) => prev.filter((w) => w.word !== word))
      setTotal((t) => Math.max(0, t - 1))
      toast.success("已移除")
    } catch {
      toast.error("操作失败")
    } finally {
      setBusy(null)
    }
  }

  const speak = async (word: string) => {
    if (speaking) return
    setSpeaking(word)
    try {
      const res = await fetch("/api/youdao/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: word }),
      })
      if (!res.ok) throw new Error()
      const buf = await res.arrayBuffer()
      const blob = new Blob([buf], { type: "audio/mpeg" })
      const url = URL.createObjectURL(blob)
      if (audioRef.current) audioRef.current.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        setSpeaking(null)
      }
      await audio.play()
    } catch {
      toast.error("朗读失败")
      setSpeaking(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <BookText className="h-5 w-5 text-emerald-400" />
            <h1 className="text-lg font-bold text-foreground/80">单词本</h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300">
              共 {total} 个
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-foreground/40 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card/60 px-6 py-16 text-center space-y-2">
            <div className="text-base font-semibold text-foreground/80">单词本是空的</div>
            <div className="text-sm text-foreground/50">
              在已完成句子上悬浮单词，点击「加入单词本」即可收藏
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card/60 divide-y divide-border/60 overflow-hidden">
            {items.map((row) => {
              const open = expanded.has(row.id)
              const firstTrans = row.translations?.[0] ?? ""
              return (
                <div key={row.id} className="px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => toggleExpand(row.id)}
                      className="shrink-0 w-6 h-6 rounded hover:bg-foreground/5 flex items-center justify-center text-foreground/50"
                      aria-label="展开"
                    >
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>

                    <span className="text-lg font-bold text-foreground/90 min-w-[6rem]">
                      {row.word}
                    </span>

                    {(row.phonetic || row.phoneticUk) && (
                      <span className="text-[12px] text-foreground/50 font-mono">
                        {row.phonetic && <>美 {row.phonetic}</>}
                        {row.phonetic && row.phoneticUk && <span className="mx-1.5 opacity-50">·</span>}
                        {row.phoneticUk && <>英 {row.phoneticUk}</>}
                      </span>
                    )}

                    <button
                      onClick={() => speak(row.word)}
                      disabled={speaking === row.word}
                      className="w-7 h-7 rounded-full bg-foreground/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-50"
                      title="朗读"
                    >
                      {speaking === row.word
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Volume2 className="h-3.5 w-3.5 text-foreground/60" />}
                    </button>

                    <span className="text-sm text-foreground/65 flex-1 min-w-0 truncate">
                      {firstTrans || "（暂无中文释义）"}
                    </span>

                    <span className="text-[11px] text-foreground/40 shrink-0">
                      {fmt(row.addedAt)}
                    </span>

                    <button
                      onClick={() => removeWord(row.word)}
                      disabled={busy === row.word}
                      className="shrink-0 w-7 h-7 rounded-full hover:bg-red-500/15 text-foreground/40 hover:text-red-400 flex items-center justify-center disabled:opacity-50"
                      title="移除"
                    >
                      {busy === row.word
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {open && (
                    <div className="mt-3 pl-9 pr-2 space-y-2.5">
                      {row.translations && row.translations.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-semibold">中文释义</span>
                          <div className="text-[13px] text-foreground/80 leading-relaxed">
                            {row.translations.slice(0, 8).join("；")}
                          </div>
                        </div>
                      )}

                      {row.pos && row.pos.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-semibold">词性 · 释义</span>
                          <div className="flex flex-col gap-1.5">
                            {row.pos.slice(0, 8).map((p, i) => (
                              <div key={i} className="flex gap-2 text-[12px]">
                                {p.pos && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono text-[10px] uppercase">
                                    {p.pos}
                                  </span>
                                )}
                                <span className="text-foreground/75 leading-snug">{p.meaning}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {row.synonyms && row.synonyms.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-semibold">同义词</span>
                          <div className="flex flex-wrap gap-1.5">
                            {row.synonyms.slice(0, 12).map((s) => (
                              <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-foreground/5 text-foreground/65">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {row.examples && row.examples.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-semibold">例句</span>
                          <div className="flex flex-col gap-1">
                            {row.examples.slice(0, 3).map((e, i) => (
                              <div key={i} className="text-[12px] text-foreground/70 leading-relaxed">
                                <div>{e.en}</div>
                                {e.zh && <div className="text-foreground/45">{e.zh}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(!row.translations?.length && !row.pos?.length && !row.synonyms?.length) && (
                        <div className="text-[12px] text-foreground/45">
                          暂无更多详情
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
