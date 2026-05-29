"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Volume2, BookmarkPlus, BookmarkCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface DictResult {
  word: string
  phonetic?: string | null
  phoneticUk?: string | null
  translations?: string[] | null
  pos?: { pos: string; meaning: string }[] | null
  synonyms?: string[] | null
  examples?: { en: string; zh: string }[] | null
  inWordbook?: boolean
  cached?: boolean
}

interface Props {
  word: string
  sentenceId?: string
  children: React.ReactNode
}

const HOVER_DELAY = 300
const LEAVE_DELAY = 200

export function WordDetailPopover({ word, sentenceId, children }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const enterTimer = useRef<NodeJS.Timeout | null>(null)
  const leaveTimer = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [data, setData] = useState<DictResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyBookmark, setBusyBookmark] = useState(false)
  const [busySpeak, setBusySpeak] = useState(false)

  const normalized = word.replace(/[^a-zA-Z' -]/g, "").trim().toLowerCase()

  const clearTimers = useCallback(() => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    enterTimer.current = null
    leaveTimer.current = null
  }, [])

  const computePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = 340
    const margin = 12
    let left = rect.left + rect.width / 2 - width / 2
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))
    const top = Math.max(margin, rect.top - 12)
    setPos({ top, left })
  }, [])

  const fetchWord = useCallback(async () => {
    if (!normalized) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dict/word?word=${encodeURIComponent(normalized)}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error === "not_found" ? "未收录" : "查询失败")
        setData({ word: normalized, inWordbook: !!j.inWordbook })
      } else {
        const j: DictResult = await res.json()
        setData(j)
      }
    } catch {
      setError("网络错误")
    } finally {
      setLoading(false)
    }
  }, [normalized])

  const handleEnter = () => {
    clearTimers()
    enterTimer.current = setTimeout(() => {
      computePosition()
      setOpen(true)
      if (!data) fetchWord()
    }, HOVER_DELAY)
  }

  const handleLeave = () => {
    clearTimers()
    leaveTimer.current = setTimeout(() => setOpen(false), LEAVE_DELAY)
  }

  const handlePopoverEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }

  useEffect(() => {
    if (!open) return
    const onScroll = () => computePosition()
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
    }
  }, [open, computePosition])

  useEffect(() => () => clearTimers(), [clearTimers])

  async function speak() {
    if (!normalized || busySpeak) return
    setBusySpeak(true)
    try {
      const res = await fetch("/api/youdao/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: normalized }),
      })
      if (!res.ok) throw new Error("tts failed")
      const buf = await res.arrayBuffer()
      const blob = new Blob([buf], { type: "audio/mpeg" })
      const url = URL.createObjectURL(blob)
      if (audioRef.current) audioRef.current.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch {
      toast.error("朗读失败")
    } finally {
      setBusySpeak(false)
    }
  }

  async function toggleBookmark() {
    if (!normalized || busyBookmark || !data) return
    setBusyBookmark(true)
    try {
      if (data.inWordbook) {
        const res = await fetch(`/api/wordbook?word=${encodeURIComponent(normalized)}`, { method: "DELETE" })
        if (!res.ok) throw new Error("delete failed")
        setData({ ...data, inWordbook: false })
        toast.success("已移出单词本")
      } else {
        const res = await fetch("/api/wordbook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: normalized, sourceSentenceId: sentenceId }),
        })
        if (!res.ok) throw new Error("add failed")
        setData({ ...data, inWordbook: true })
        toast.success("已加入单词本")
      }
    } catch {
      toast.error("操作失败")
    } finally {
      setBusyBookmark(false)
    }
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="inline-block"
      >
        {children}
      </span>

      {open && (
        <div
          ref={popoverRef}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handleLeave}
          className="fixed z-[70] w-[340px] -translate-y-full rounded-2xl border border-white/10 bg-[#181826]/97 backdrop-blur-md shadow-2xl text-white"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-2xl font-bold">{data?.word ?? normalized}</span>
                {(data?.phonetic || data?.phoneticUk) && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/55 font-mono">
                    {data.phonetic && <span>美 {data.phonetic}</span>}
                    {data.phoneticUk && <span>英 {data.phoneticUk}</span>}
                  </div>
                )}
              </div>
              <button
                onClick={speak}
                disabled={busySpeak}
                title="朗读"
                className="shrink-0 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors disabled:opacity-50"
              >
                {busySpeak ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-6 text-white/40 text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 查询中…
              </div>
            )}

            {!loading && error && (
              <div className="text-center text-white/50 text-sm py-4">{error}</div>
            )}

            {!loading && !error && data && (
              <>
                {data.translations && data.translations.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">中文释义</span>
                    <div className="text-[13px] text-white/85 leading-relaxed">
                      {data.translations.slice(0, 5).join("；")}
                    </div>
                  </div>
                )}

                {data.pos && data.pos.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">词性 · 释义</span>
                    <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                      {data.pos.slice(0, 5).map((p, i) => (
                        <div key={i} className="flex gap-2 text-[12px]">
                          {p.pos && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono text-[10px] uppercase">
                              {p.pos}
                            </span>
                          )}
                          <span className="text-white/75 leading-snug">{p.meaning}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.synonyms && data.synonyms.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">同义词</span>
                    <div className="flex flex-wrap gap-1.5">
                      {data.synonyms.slice(0, 8).map((s) => (
                        <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/70">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <button
              onClick={toggleBookmark}
              disabled={busyBookmark || !data}
              className={`w-full py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                data?.inWordbook
                  ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                  : "bg-violet-500/85 text-white hover:bg-violet-500"
              } disabled:opacity-50`}
            >
              {busyBookmark ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : data?.inWordbook ? (
                <BookmarkCheck className="h-4 w-4" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
              {data?.inWordbook ? "已在单词本（点击移除）" : "加入单词本"}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
