"use client"

/**
 * 单词卡（点击可点单词时弹出的浮层）+ 它的「更多」详情弹窗。
 *
 * 关键设计决策（完整理由见下方各处注释）：
 *
 * 1. **挂载点是 `.practice-shell` 而不是 `document.body`。**
 *    本仓 `practice.css` 是抽取产物，选择器全部收敛在 `.practice-shell` 下
 *    （`scripts/extract-practice-css.py`），挂 body 会一条 `.word-card-*` /
 *    `.word-detail-*` 都命中不了、CSS 变量也解析不到。这与 `InlineSpeakingBar`
 *    的处置相同。也不能就地渲染 —— `.learning-container` 带
 *    `animation: fadeInUp … forwards`，收尾帧 `transform` 非 none，会成为
 *    `position: fixed` 后代的 containing block（详见 `InlineSpeakingBar` 文件头）。
 *    `.practice-shell` 自身 `transform: none`，fixed 仍以视口为基准。
 *
 * 2. **数据源是 `/api/dict/word`，单接口一次就返回**
 *    `word/phonetic/phoneticUk/translations/pos/synonyms/examples/inWordbook`，
 *    已经覆盖小卡片**和**详情弹窗要的字段。所以：
 *      · 不做「先简版再详情」的二次拉取；
 *      · 详情弹窗不出现「加载详细信息中…」那一帧（单接口恒有详情字段）。
 *
 * 3. **图标用 lucide 而不是 remixicon。** 本仓没装 remixicon（全仓零引用），
 *    既有约定是换成 lucide 组件。字体图标靠 `font-size` 撑尺寸的几条规则
 *    （`.word-card-not-found i { font-size: 2rem }`、
 *    `.word-modal-section-title i { font-size: 1.1rem; margin-right: 8px; opacity: .8 }`
 *    等）在 svg 上不生效，所以这些**数值**以内联 `style` 落到 svg 上。
 *    CSS 是生成物、不手改（见生成器文件头），所以只能这么做。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { ChevronRight, FileText, ImageOff, SearchX, Star, Volume2 } from "lucide-react"
import { globalSpeak } from "@/lib/hooks/useTTSSettings"
import { distinctPosLabels, wrapPhonetic, type DictSense } from "@/lib/dict-display"

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

/** 锚点（被点的 `.clickable-word`）在**点击当帧**的视口坐标。 */
interface AnchorRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * 卡片定位量不到真实尺寸时用的两个估算值。
 *
 * 注意 CSS 里 `.word-detail-card` 的 `width` 是 **320px**，比常量 300 宽
 * 20px —— 用过窄的常量夹取，贴右边缘时会露出去。所以优先用渲染后的真实尺寸量，
 * 量不到（首帧、还没提交）才回落到这两个值。
 */
const FALLBACK_CARD_WIDTH = 300
const FALLBACK_CARD_HEIGHT = 280
/** 夹取口径：`Math.max(10, …)` 与 `window.innerWidth - cardWidth - 10`。 */
const CARD_MARGIN = 10
/** 与锚点的垂直间距：`rect.bottom + 10`。 */
const ANCHOR_GAP = 10

export function WordDetailCard({ sentenceId }: { sentenceId?: string }) {
  /** portal 宿主。点击时解析一次（`.practice-shell` 是静态外壳，不会中途换人）。 */
  const [host, setHost] = useState<HTMLElement | null>(null)

  const [card, setCard] = useState<{ word: string; data: DictResult | null } | null>(null)
  const [shown, setShown] = useState(false)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [modalOpen, setModalOpen] = useState(false)
  /**
   * 弹窗自己的数据槽。
   *
 * 为什么不能复用 `card.data`：打开弹窗时先关掉小卡片
 * （`openModal()` 里 `setCard(null)`），弹窗数据是**先取出来**再独立渲染的。
   * 于是 `card` 一空，任何从 `card` 派生的值都会跟着变 null —— 弹窗必须带一份
   * 自己的数据，否则刚打开就渲染不出来。
   */
  const [modalData, setModalData] = useState<DictResult | null>(null)
  const [busyFavorite, setBusyFavorite] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const fetchingRef = useRef(0)
 /** 关闭动画的定时器。摘 `.show` 后元素仍在，靠 CSS transition 淡出。 */
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const data = card?.data ?? null

  /**
 * 取词走 `/api/dict/word`（见文件头第 2 条）。
   *
 * `fetchingRef` 是「防快速切换」的守卫 —— 给每次请求编号，
   * 只有最后一次的结果能落地。
   */
  const fetchWord = useCallback(async (w: string) => {
    const seq = ++fetchingRef.current
    try {
      const res = await fetch(`/api/dict/word?word=${encodeURIComponent(w)}`)
      const j = (await res.json().catch(() => ({}))) as DictResult & { error?: string; inWordbook?: boolean }
      if (fetchingRef.current !== seq) return
      if (!res.ok) {
 // 没查到词也渲染「未找到该单词」的兜底分支，
        // 而不是留空 —— 空卡片看起来像坏了。
        setCard({ word: w, data: { word: w, inWordbook: !!j.inWordbook } })
        return
      }
      setCard({ word: w, data: j })
    } catch {
      if (fetchingRef.current !== seq) return
      setCard({ word: w, data: { word: w } })
    }
  }, [])

  /**
 * 打开卡片。换词时先收起旧卡片再重建，**每次都重放展开动画**
 * （先无 `.show`，`requestAnimationFrame` 后才加）。
   *
 * 双 `requestAnimationFrame`：React 提交后首帧样式才能被浏览器算进
 * transition 起点，所以多等一帧。否则第二次点同一个词会「直接出现、没有淡入」。
   */
  const openCard = useCallback(
    (w: string, el: Element) => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      const r = el.getBoundingClientRect()
      setHost(document.querySelector<HTMLElement>(".practice-shell"))
      setAnchor({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
      setCard({ word: w, data: null })
      setShown(false)
      setModalOpen(false)
 // 先按估算值摆一次，避免首帧闪现在 (0,0)
      setPos({ top: Math.max(CARD_MARGIN, r.bottom + ANCHOR_GAP), left: CARD_MARGIN })
      requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      void fetchWord(w)
    },
    [fetchWord],
  )

 /** 关闭：只摘 `.show`，元素不销毁。 */
  const closeCard = useCallback(() => {
    setShown(false)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    // 300ms = CSS transition 时长（`.word-detail-card` 的 `opacity .3s`），
    // 等淡出跑完再卸载，否则会「啪」地消失。
    closeTimerRef.current = setTimeout(() => {
      setCard(null)
      setAnchor(null)
    }, 300)
  }, [])

  const closeModal = useCallback(() => setModalOpen(false), [])

  /**
   * 全局 click：命中 `.clickable-word` 就开卡；点卡片/弹窗内部忽略；
 * 点别处关卡片。
   *
   * 空依赖：这个监听在挂载期只需装一次，且它只用稳定的 setter，
   * 不需要读任何会变的 state（关闭动作对已关闭状态是幂等的）。
   */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      const wordEl = t.closest(".clickable-word")
      if (wordEl) {
        const w = (wordEl as HTMLElement).dataset.word || wordEl.textContent?.trim() || ""
        if (w) openCard(w.replace(/[^a-zA-Z' -]/g, "").trim().toLowerCase(), wordEl)
        return
      }
      // 看答案浮层/复习屏里的结构视图关闭按钮等，点在卡片外但属于
 // 「本页别的交互」时也走这一支 —— 点到卡片外就关卡片。
      if (t.closest(".word-detail-card") || t.closest(".word-detail-modal")) return
      closeCard()
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [openCard, closeCard])

  /**
 * ESC：先关详情弹窗，否则关卡片。
   *
 * 注意这里是**独立**的一个 document keydown，和关闭答案提示浮层的
   * 那个并存 —— ESC 同时命中两者时，卡片与提示浮层会一起关。
   * 这是刻意行为（`DictationPractice` 里那个 ESC effect 不动）。
   */
  useEffect(() => {
    if (!card && !modalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (modalOpen) {
        closeModal()
      } else {
        closeCard()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [card, modalOpen, closeCard, closeModal])

  /** 卸载时清掉未跑完的淡出定时器，避免对已卸载组件 setState。 */
  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    },
    [],
  )

  /**
 * 定位：
   *   水平 —— 以锚点居中，再夹进 `[10, innerWidth - cardWidth - 10]`；
   *   垂直 —— 优先放锚点下方 `bottom + 10`，若放不下则放上方 `top - cardHeight - 10`，
   *          最后 `Math.max(10, top)`。
   * 区别只在 cardWidth/cardHeight 取真实测量值（见常量处说明）。
   *
   * 用 `useLayoutEffect`：它在绘制前跑，所以「先隐藏、量完再落位」不会被看到；
   * 依赖里带 `shown`/`data` 是因为内容从「查询中…」长成完整词条后盒子尺寸变了，
   * 必须按最终尺寸重算，否则高度按加载态算出来的 top 会偏。
   */
  useLayoutEffect(() => {
    if (!anchor || !card) return
    const box = cardRef.current
    const w = box?.offsetWidth || FALLBACK_CARD_WIDTH
    const h = box?.offsetHeight || FALLBACK_CARD_HEIGHT
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = anchor.left + anchor.width / 2 - w / 2
    left = Math.max(CARD_MARGIN, Math.min(left, vw - w - CARD_MARGIN))

    let top = anchor.bottom + ANCHOR_GAP
    if (top + h > vh - 20) top = anchor.top - h - ANCHOR_GAP
    top = Math.max(CARD_MARGIN, top)

    setPos({ top, left })
  }, [anchor, card, shown, data])

 /** 朗读单词：统一走全局 TTS
   *  （同 `WordDetailPopover` 的处置：它带用户的音色设置）。 */
  const speak = useCallback((w: string) => {
    if (!w) return
    void globalSpeak(w)
  }, [])

  /**
 * 收藏/取消收藏走 `/api/wordbook`（POST/DELETE，见 `src/app/api/wordbook/route.ts`），
   * 传 `word` + `sourceSentenceId`。
   */
  const toggleFavorite = useCallback(async () => {
    if (!data || busyFavorite) return
    setBusyFavorite(true)
    try {
      if (data.inWordbook) {
        const res = await fetch(`/api/wordbook?word=${encodeURIComponent(data.word)}`, { method: "DELETE" })
        if (!res.ok) throw new Error("delete failed")
        setCard((c) => (c ? { ...c, data: { ...c.data!, inWordbook: false } } : c))
        toast.success("已移出单词本", { duration: 2000 })
      } else {
        const res = await fetch("/api/wordbook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: data.word, sourceSentenceId: sentenceId }),
        })
        if (!res.ok) throw new Error("add failed")
        setCard((c) => (c ? { ...c, data: { ...c.data!, inWordbook: true } } : c))
        toast.success(`已收藏单词: ${data.word}`, { duration: 2000 })
      }
    } catch {
      toast.error("操作失败，请稍后重试", { duration: 2000 })
    } finally {
      setBusyFavorite(false)
    }
  }, [data, busyFavorite, sentenceId])

 /** 打开详情弹窗。先关小卡片，再开弹窗。 */
  const openModal = useCallback(() => {
    if (!data) return
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    // 先把数据搬到弹窗自己的槽里，再关小卡片 —— 顺序反了数据就没了
    // （`setCard(null)` 会让 `data` 变 null）。
    setModalData(data)
    setShown(false)
    setCard(null)
    setAnchor(null)
    setModalOpen(true)
  }, [data])

  // portal 宿主还没解析出来时不渲染（首帧），点击后才会有。
  if (!host) return null

  const posLabels = distinctPosLabels((data?.pos ?? []) as DictSense[])
  const translations = data?.translations ?? []
  const found = !!data && !!(data.word && (translations.length > 0 || (data.pos?.length ?? 0) > 0))

  // 弹窗的数据与派生值都要从 `modalData` 取 —— 它和 `card` 是两条独立的命
  // （见 `modalData` 声明处的说明）。
  const modalPosLabels = distinctPosLabels((modalData?.pos ?? []) as DictSense[])
  const modalTranslations = modalData?.translations ?? []
  const modalExamples = modalData?.examples ?? []

  return createPortal(
    <>
      {card && (
        <div
          id="wordDetailCard"
          ref={cardRef}
          className={`word-detail-card${shown ? " show" : ""}`}
          style={{ top: pos.top, left: pos.left }}
 /* 阻止冒泡，免得点卡片里的按钮顺带触发上面的「点别处关卡片」。 */
          onClick={(e) => e.stopPropagation()}
        >
          {!data ? (
 /* 查询未返回前的加载态。 */
            <div className="word-card-loading">
              <div className="spinner" />
              <div style={{ marginTop: 10 }}>查询中...</div>
            </div>
          ) : !found ? (
            <div className="word-card-not-found">
              <SearchX size={32} strokeWidth={1.6} style={{ display: "block", margin: "0 auto 8px", color: "rgba(255,255,255,0.3)" }} />
              <div>未找到该单词</div>
            </div>
          ) : (
            <>
 {/* 有图给图，没图给 `.no-image`。
                  本库没有任何句子/单词配图数据源（39 张表无图片列），
 所以永远走 no-image 分支。 */}
              <div className="word-card-image">
                <div className="no-image">
                  <ImageOff size={32} strokeWidth={1.5} style={{ color: "rgba(255,255,255,0.3)" }} />
                </div>
              </div>
              <div className="word-card-info">
                <div className="word-card-header">
                  <div className="word-card-title-group">
                    <span className="word-card-word">{data.word}</span>
                    <span className="word-card-phonetic">
                      {(() => {
 // 音标优先取美式，缺失时回落到英式。
                        // 本仓没有口音偏好项，固定取这套默认。
                        const p = wrapPhonetic(data.phonetic || data.phoneticUk)
                        return p ? p : ""
                      })()}
                    </span>
                  </div>
                  {(data.phonetic || data.phoneticUk) && (
                    <button
                      type="button"
                      className="word-card-play-btn"
                      title="播放发音"
                      onClick={() => speak(data.word)}
                    >
                      <Volume2 size={18} />
                    </button>
                  )}
                </div>
                <div className="word-card-translation">
 {/* 只展示第一条翻译，词性前缀放在同一行。 */}
                  {posLabels[0] ? <span className="word-card-pos">{posLabels[0]}</span> : null}
                  {translations[0] ?? ""}
                </div>
                <div className="word-card-actions">
                  <button
                    type="button"
                    className={`word-card-favorite-btn${data.inWordbook ? " favorited" : ""}`}
                    title="收藏单词"
                    disabled={busyFavorite}
                    onClick={(e) => {
                      e.stopPropagation()
                      void toggleFavorite()
                    }}
                  >
                    <Star
                      size={13}
                      fill={data.inWordbook ? "currentColor" : "none"}
                      style={data.inWordbook ? { color: "#f59e0b" } : undefined}
                    />
                    {data.inWordbook ? "已收藏" : "收藏"}
                  </button>
                  <button
                    type="button"
                    className="word-card-more-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      openModal()
                    }}
                  >
                    更多 <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && modalData && (
        <div
          id="wordDetailModalOverlay"
          className="word-detail-modal-overlay show"
 /* 只有点在遮罩**自身**（不是弹窗内部）才关。 */
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="word-detail-modal" style={{ position: "relative" }}>
            <button type="button" className="word-modal-close" onClick={closeModal}>
              ×
            </button>
            <div className="word-modal-header">
              <div className="word-modal-image">
                <div
                  className="no-image"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    background: "#1a1f25",
                    color: "rgba(255,255,255,0.3)",
                    fontSize: "2rem",
                  }}
                >
                  <ImageOff size={32} strokeWidth={1.5} />
                </div>
              </div>
              <div className="word-modal-info">
                <div className="word-modal-word">{modalData.word}</div>
                <div className="word-modal-phonetic">
 {/* 美式在上；英式与美式不同才另起一个，可点朗读。 */}
                  {modalData.phonetic ? (
                    <span
                      className="clickable-phonetic"
                      title="点击播放美式发音"
                      onClick={() => speak(modalData.word)}
                    >
                      🇺🇸 {wrapPhonetic(modalData.phonetic)}
                    </span>
                  ) : null}
                  {modalData.phoneticUk && modalData.phoneticUk !== modalData.phonetic ? (
                    <span
                      className="clickable-phonetic"
                      title="点击播放英式发音"
                      onClick={() => speak(modalData.word)}
                    >
                      🇬🇧 {wrapPhonetic(modalData.phoneticUk)}
                    </span>
                  ) : null}
                </div>
                <div className="word-modal-translations">
 {/* `word-modal-trans-item` 每条自带词性 + 中文释义。
                      上游把「词性」与「中文释义」拆成两个平行列表，没有 1:1 配对，
                      所以按下标 zip，缺位回落到第一个词性标签。 */}
                  {modalTranslations.map((t, i) => (
                    <div className="word-modal-trans-item" key={i}>
                      {modalPosLabels[i] ?? modalPosLabels[0] ? (
                        <span className="pos">{modalPosLabels[i] ?? modalPosLabels[0]}</span>
                      ) : null}
                      {t}
                    </div>
                  ))}
                </div>
 {/* 词形变化（`word-modal-forms`）：
 我们的接口不返回词形，
                    字段缺失时整块不渲染。 */}
              </div>
            </div>
            <div className="word-modal-body">
              {/* 记忆技巧（`remember`）同理缺失，不渲染。 */}
              {modalExamples.length > 0 && (
                <div className="word-modal-section">
                  <div className="word-modal-section-title">
                    <FileText size={18} strokeWidth={2} style={{ marginRight: 8, opacity: 0.8 }} />
                    例句
                  </div>
                  {modalExamples.slice(0, 3).map((s, i) => (
                    <div className="word-modal-sentence" key={i}>
                      <div className="en">{s.en}</div>
                      {s.zh ? <div className="cn">{s.zh}</div> : null}
                    </div>
                  ))}
                </div>
              )}
              {/* 短语（`phrases`）与「收录词汇本」（`containingBooks`）我们都没有，跳过。 */}
            </div>
          </div>
        </div>
      )}
    </>,
    host,
  )
}
