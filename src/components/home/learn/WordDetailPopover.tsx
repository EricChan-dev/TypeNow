"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import { Volume2, BookmarkPlus, BookmarkCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { groupSensesByPos, wrapPhonetic, type DictSense } from "@/lib/dict-display"

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

/** 浮层宽度。比原来的 340 宽一些：释义/词性/同义词挤在 340px 里会频繁折行。 */
const POPOVER_WIDTH = 380
/** 与可视区域边缘留的空隙 */
const VIEWPORT_MARGIN = 12
/** 浮层与单词之间的间距 */
const ANCHOR_GAP = 10

function clamp(v: number, min: number, max: number): number {
  // max 可能小于 min（窗口比浮层还窄），此时取 min，保证至少左边缘可见
  return Math.max(min, Math.min(v, Math.max(min, max)))
}

export function WordDetailPopover({ word, sentenceId, children }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const enterTimer = useRef<NodeJS.Timeout | null>(null)
  const leaveTimer = useRef<NodeJS.Timeout | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  /** 首次测量完成前先隐藏，避免看到浮层"跳"到正确位置的那一帧 */
  const [placed, setPlaced] = useState(false)
  const [data, setData] = useState<DictResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyBookmark, setBusyBookmark] = useState(false)
  const [busySpeak, setBusySpeak] = useState(false)

  const normalized = word.replace(/[^a-zA-Z' -]/g, "").trim().toLowerCase()

  /**
   * 词性分组。放在渲染之外算一次：data.pos 每次渲染都是同一个引用，
   * 在 JSX 里现算会每次渲染都重建 Map/数组。
   */
  const posGroups = useMemo(
    () => groupSensesByPos((data?.pos ?? []) as DictSense[]),
    [data?.pos],
  )

  const clearTimers = useCallback(() => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    enterTimer.current = null
    leaveTimer.current = null
  }, [])

  /**
   * 算出浮层应该摆在哪。
   *
   * 旧实现是 `top = rect.top - 12` 再配合 CSS 的 `-translate-y-full`（向上展开），
   * 并且只把**锚点**夹进了可视区（`Math.max(margin, …)`）—— 夹的是单词的坐标，
   * 不是浮层盒子的坐标。于是内容一多，盒子向上溢出屏幕顶部被直接裁掉：
   * 用户看到的是一张缺了上半截的卡片（释义/音标正好在那半截里）。
   *
   * 现在改成按**盒子实际尺寸**摆放，三级优先：
   *   1. 放单词**右侧** —— 横向空间通常比纵向富余，而且不会盖住正在读的句子；
   *   2. 右侧放不下 → 放**下方**；
   *   3. 下方也放不下 → 放**上方**，并且 top 是按盒子高度算出来的真实位置，
   *      不再依赖 translate。
   * 三种情况都用盒子尺寸把 left/top 夹进可视区域，任何窗口大小都不会被裁。
   */
  const computePosition = useCallback(() => {
    const el = triggerRef.current
    const box = popoverRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // 首帧还没渲染出盒子时用估算值兜底（下一帧就会用真实尺寸重算）
    const w = box?.offsetWidth || POPOVER_WIDTH
    const h = box?.offsetHeight || 240

    const fitsRight = rect.right + ANCHOR_GAP + w <= vw - VIEWPORT_MARGIN
    const fitsBelow = rect.bottom + ANCHOR_GAP + h <= vh - VIEWPORT_MARGIN

    /**
     * 默认按"右侧"的横向定位算；只有真的放不下右侧时才回到居中对齐
     * （居中对齐在窄窗口下会把 left 夹到边距上，看着更乱）。
     */
    const centeredLeft = clamp(
      rect.left + rect.width / 2 - w / 2,
      VIEWPORT_MARGIN,
      vw - w - VIEWPORT_MARGIN,
    )

    if (fitsRight) {
      setPos({
        top: clamp(rect.top + rect.height / 2 - h / 2, VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN),
        left: rect.right + ANCHOR_GAP,
      })
    } else if (fitsBelow) {
      setPos({
        top: rect.bottom + ANCHOR_GAP,
        left: centeredLeft,
      })
    } else {
      // 上方：即使 fitsAbove 为 false 也选它，因为此时只有上方还有空间，
      // 后面的 maxHeight 会让内容可滚动而不是被裁掉
      setPos({
        top: clamp(rect.top - ANCHOR_GAP - h, VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN),
        left: centeredLeft,
      })
    }
    setPlaced(true)
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
      setPlaced(false)
      // 先开再测：位置要在浮层真正渲染出来之后才量得准（见下面的 useLayoutEffect）
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

  /**
   * 摆位。用 useLayoutEffect 而不是 useEffect：它在浏览器绘制**之前**执行，
   * 所以"先隐藏、量完再定位"这个过程用户看不到，不会出现浮层先闪现在错误位置
   * 再跳过去的抖动。
   *
   * 依赖里带上 loading/data：加载完成后盒子会从"查询中…"长成完整内容，
   * 尺寸变了必须重算，否则高度按加载态算出来的位置会不准。
   */
  useLayoutEffect(() => {
    if (!open) return
    computePosition()
    // 内容异步到达后再量一次，确保以最终尺寸定位
  }, [open, loading, data, error, computePosition])

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

  /**
    * 朗读这个单词。
    *
    * 走全局的 globalSpeak，而不是自己 POST /api/youdao/tts ——
    * 原来那条请求**不带 voiceName**，后端就回落到它自己的默认音色（youxiaomei），
    * 于是"自动念整句"与"悬浮卡片念单词"是两个人的声音。
    * 现在统一读用户的 TTS 设置，并且会先停掉正在播的那一段。
    */
  async function speak() {
    if (!normalized || busySpeak) return
    setBusySpeak(true)
    try {
      const ok = await globalSpeak(normalized)
      if (!ok) toast.error("朗读失败")
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
          /*
            不再用 -translate-y-full 做"向上展开"：translate 让 CSS 位置与
            JS 计算出的 top 之间隔了一层语义，夹取可视区域时极易算错（旧实现
            就是只夹了锚点坐标，导致内容一多就从屏幕顶部被裁掉）。
            现在 top/left 就是盒子的最终位置，配合 useLayoutEffect 里的真实尺寸测量。

            maxHeight + overflow-y-auto：极长的词条（词性+释义+同义词+例句）
            在矮窗口里也不会溢出屏幕，而是内部滚动。
            width 用 CSS 变量兜底到 max-w，窄屏时不会超出可视宽度。
          */
          className="fixed z-[70] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card/97 backdrop-blur-md shadow-2xl text-foreground"
          style={{
            top: pos.top,
            left: pos.left,
            width: POPOVER_WIDTH,
            maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
            maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
            visibility: placed ? "visible" : "hidden",
          }}
        >
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-2xl font-bold">{data?.word ?? normalized}</span>
                {(data?.phonetic || data?.phoneticUk) && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground font-mono">
                    {data.phonetic && <span>美 {wrapPhonetic(data.phonetic)}</span>}
                    {data.phoneticUk && <span>英 {wrapPhonetic(data.phoneticUk)}</span>}
                  </div>
                )}
              </div>
              <button
                onClick={speak}
                disabled={busySpeak}
                title="朗读"
                className="shrink-0 w-9 h-9 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center transition-colors disabled:opacity-50"
              >
                {busySpeak ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-6 text-muted-foreground/70 text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 查询中…
              </div>
            )}

            {!loading && error && (
              <div className="text-center text-muted-foreground text-sm py-4">{error}</div>
            )}

            {!loading && !error && data && (
              <>
                {data.translations && data.translations.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">中文释义</span>
                    <div className="text-[13px] text-foreground/85 leading-relaxed">
                      {data.translations.slice(0, 5).join("；")}
                    </div>
                  </div>
                )}

                {/*
                  词性用**中文**，并且**按词性分组**。

                  原来是把上游的 (partOfSpeech, definition) 平铺最多 5 条：
                    · partOfSpeech 是英文单词（noun / adverb / pronoun…），
                      没登记中文就原样露出来 —— 用户看到的 "pronoun" 就是它；
                    · 一个词通常只有 2 个词性，但每个词性下有 2~4 条义项，
                      平铺后同一词性重复出现，看起来像"一个单词有那么多词性"；
                    · definition 是**英文句子**（"On the day after the present day."），
                      和上面的「中文释义」混在一起，中英对不上。

                  分组之后：每个词性只出现一次、中文标签在前，它下面挂最多 2 条释义。
                  释义保留英文是**如实标注**——那是词典原文，我们没有离线翻译能力，
                  所以把标题写成「词性 · 英文释义」，让人一眼知道这块本来就是英文，
                  而不是"中文没显示出来"。
                */}
                {posGroups.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                      词性 · 英文释义
                    </span>
                    <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
                      {posGroups.map((g) => (
                        <div key={g.pos || "none"} className="flex flex-col gap-0.5">
                          <span className="self-start shrink-0 px-2 py-0.5 rounded bg-violet-500/20 text-violet-200 text-[11px] font-semibold">
                            {g.label}
                          </span>
                          {g.meanings.map((m, i) => (
                            <span key={i} className="text-[12px] text-foreground/70 leading-snug">
                              {m}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.synonyms && data.synonyms.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">同义词</span>
                    <div className="flex flex-wrap gap-1.5">
                      {data.synonyms.slice(0, 8).map((s) => (
                        <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-foreground/8 text-foreground/70">{s}</span>
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
