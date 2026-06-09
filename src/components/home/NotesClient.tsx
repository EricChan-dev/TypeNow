"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FileText, Plus, Trash2, Loader2, Check } from "lucide-react"
import { toast } from "sonner"

interface NoteRow {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

function fmtRelative(d: string) {
  try {
    const dt = new Date(d).getTime()
    const diff = Date.now() - dt
    if (diff < 60_000) return "刚刚"
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`
    const day = Math.floor(diff / 86_400_000)
    if (day < 7) return `${day} 天前`
    const date = new Date(d)
    return `${date.getMonth() + 1}/${date.getDate()}`
  } catch { return "" }
}

const AUTOSAVE_MS = 800

export function NotesClient() {
  const [items, setItems] = useState<NoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [busyCreate, setBusyCreate] = useState(false)
  const [busyDelete, setBusyDelete] = useState<string | null>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const skipNextAutoSave = useRef(false)

  const active = useMemo(() => items.find((n) => n.id === activeId) ?? null, [items, activeId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/notes?page=1&size=100")
      const j = await res.json()
      const list: NoteRow[] = j.items ?? []
      setItems(list)
      if (list.length > 0 && !activeId) {
        setActiveId(list[0].id)
        skipNextAutoSave.current = true
        setDraftTitle(list[0].title ?? "")
        setDraftContent(list[0].content ?? "")
      }
    } finally {
      setLoading(false)
    }
  }, [activeId])

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  // Switch active note → load draft from row
  useEffect(() => {
    if (!active) {
      skipNextAutoSave.current = true
      setDraftTitle("")
      setDraftContent("")
      return
    }
    skipNextAutoSave.current = true
    setDraftTitle(active.title ?? "")
    setDraftContent(active.content ?? "")
  }, [active])

  // Autosave on draft change
  useEffect(() => {
    if (!activeId) return
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        const res = await fetch("/api/notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: activeId, title: draftTitle, content: draftContent }),
        })
        const j = await res.json()
        if (j.note) {
          setItems((prev) => {
            const next = prev.map((n) => (n.id === j.note.id ? j.note : n))
            next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            return next
          })
          setSavedAt(Date.now())
        }
      } catch {
        toast.error("保存失败")
      } finally {
        setSaving(false)
      }
    }, AUTOSAVE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [draftTitle, draftContent, activeId])

  const createNote = async () => {
    if (busyCreate) return
    setBusyCreate(true)
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "未命名笔记", content: "" }),
      })
      const j = await res.json()
      if (j.note) {
        setItems((prev) => [j.note, ...prev])
        setActiveId(j.note.id)
        skipNextAutoSave.current = true
        setDraftTitle(j.note.title)
        setDraftContent(j.note.content)
      }
    } catch {
      toast.error("新建失败")
    } finally {
      setBusyCreate(false)
    }
  }

  const deleteNote = async (id: string) => {
    if (busyDelete) return
    setBusyDelete(id)
    try {
      const res = await fetch(`/api/notes?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setItems((prev) => {
        const next = prev.filter((n) => n.id !== id)
        if (activeId === id) {
          const first = next[0]
          if (first) {
            setActiveId(first.id)
            skipNextAutoSave.current = true
            setDraftTitle(first.title ?? "")
            setDraftContent(first.content ?? "")
          } else {
            setActiveId(null)
          }
        }
        return next
      })
      toast.success("已删除")
    } catch {
      toast.error("删除失败")
    } finally {
      setBusyDelete(null)
    }
  }

  return (
    <div className="h-full overflow-hidden">
      <div className="w-full max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-2.5 mb-4">
          <FileText className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-bold text-foreground/80">笔记本</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300">
            共 {items.length} 条
          </span>
        </div>

        <div className="rounded-2xl border border-border bg-card/60 overflow-hidden h-[calc(100%-3.5rem)] flex">
          {/* Left list */}
          <aside className="w-64 shrink-0 border-r border-border/60 flex flex-col">
            <div className="p-3 border-b border-border/60">
              <button
                onClick={createNote}
                disabled={busyCreate}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-500/85 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {busyCreate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                新建笔记
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-none">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-foreground/40 gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-foreground/45">
                  暂无笔记
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {items.map((n) => {
                    const isActive = n.id === activeId
                    return (
                      <li key={n.id}>
                        <div
                          onClick={() => setActiveId(n.id)}
                          className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                            isActive ? "bg-foreground/5" : "hover:bg-white/[0.03]"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className={`text-[13px] truncate ${
                              isActive ? "text-foreground/95 font-semibold" : "text-foreground/80 font-medium"
                            }`}>
                              {n.title || "未命名笔记"}
                            </div>
                            <div className="text-[11px] text-foreground/40 mt-0.5 truncate">
                              {fmtRelative(n.updatedAt)}
                              {n.content && (
                                <span className="ml-1.5 opacity-70">· {n.content.slice(0, 24).replace(/\n/g, " ")}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteNote(n.id) }}
                            disabled={busyDelete === n.id}
                            className="shrink-0 w-6 h-6 rounded hover:bg-red-500/15 text-foreground/35 hover:text-red-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                            aria-label="删除"
                          >
                            {busyDelete === n.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Trash2 className="h-3 w-3" />}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Right editor */}
          <section className="flex-1 min-w-0 flex flex-col">
            {!active ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-foreground/50">
                <FileText className="h-10 w-10 opacity-40" />
                <div className="text-sm">还没有笔记，新建一条试试</div>
                <button
                  onClick={createNote}
                  disabled={busyCreate}
                  className="px-4 py-1.5 rounded-lg bg-violet-500/85 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  新建笔记
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-5 pt-4 pb-2 border-b border-border/40">
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="标题"
                    className="flex-1 bg-transparent text-lg font-bold text-foreground/90 placeholder:text-foreground/30 outline-none"
                    maxLength={200}
                  />
                  <div className="text-[11px] text-foreground/45 flex items-center gap-1 shrink-0">
                    {saving ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> 保存中</>
                    ) : savedAt ? (
                      <><Check className="h-3 w-3 text-emerald-400" /> 已保存</>
                    ) : null}
                  </div>
                </div>

                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="在这里写下你的想法…"
                  className="flex-1 min-h-0 resize-none px-5 py-4 bg-transparent text-sm text-foreground/85 placeholder:text-foreground/30 outline-none leading-relaxed scrollbar-none"
                />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
