"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * 错题本（复习本）—— 对齐对标页 错题本页 的结构与交互。
 *
 * 数据源映射（与 /api/user/mistake-book* 对齐）：
 * - 错题 ← review_queue（status 全态，userWrong 为本次作答原文，基准实现的 wrongWords 结构我们没有，降级为单条 diff-chip）
 * - 收藏句子    ← sentence_favorites（句子快照文本）
 * - 收藏单词    ← wordbook_items（带来源句上下文）
 *
 * CSS 由 scripts/extract-mistake-book-css.py 从基准实现生成（mistake-book.css），类名与
 * 基准实现一致，禁止手改生成文件。
 */

const PAGE_SIZE = 8
const PAGE_BUTTON_SIZE = 5
const SCROLL_STEP = 400
// 与基准实现 pager 一致：含当前页的 5 页窗口；每页 8 条。

type Kind = "mistake" | "sentence" | "word"
type SourceFilter = "" | Kind

interface MistakeCourse {
  courseId: string
  courseName: string
  coverUrl: string | null
  mistakeCount: number
  dueReviewCount: number
}

interface MistakeLesson {
  lessonId: string
  lessonName: string
  mistakeCount: number
  dueReviewCount: number
}

interface BookStats {
  dueToday: number
  dueTomorrow: number
  mastered: number
  total: number
  todayNew: number
  masteryRate: number
}

interface SourceCounts {
  mistake: number
  sentence: number
  word: number
}

interface BookItem {
  kind: Kind
  key: string
  ts: string
  english: string
  chinese: string
  word: string
  courseTitle: string
  lessonTitle: string
  courseId: string | null
  lessonId: string | null
  userWrong: string | null
  reviewCount: number
}

interface ConfirmState {
  title: string
  msg: string
  resolve: (ok: boolean) => void
}

interface AggregateData {
  courses: MistakeCourse[]
  lessons?: MistakeLesson[]
  stats: BookStats
  source: SourceCounts
}

interface ItemsData {
  items: BookItem[]
  total: number
}

const SOURCE_TABS: { val: SourceFilter; label: string }[] = [
  { val: "", label: "全部" },
  { val: "mistake", label: "错题" },
  { val: "sentence", label: "收藏句子" },
  { val: "word", label: "收藏单词" },
]

const TYPE_MAP: Record<Kind, string> = {
  mistake: "错题",
  sentence: "收藏句子",
  word: "收藏单词",
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function MistakeBookClient() {
  const router = useRouter()

  // ── 数据态 ────────────────────────────────────────────────────────────────
  const [courses, setCourses] = useState<MistakeCourse[]>([])
  const [lessons, setLessons] = useState<MistakeLesson[]>([])
  const [stats, setStats] = useState<BookStats>({
    dueToday: 0, dueTomorrow: 0, mastered: 0, total: 0, todayNew: 0, masteryRate: 0,
  })
  const [source, setSource] = useState<SourceCounts>({ mistake: 0, sentence: 0, word: 0 })
  const [items, setItems] = useState<BookItem[]>([])
  const [totalCount, setTotalCount] = useState(0)

 // ── 筛选态（与基准实现变量一一对应）────────────────────────────────────────
  const [courseId, setCourseId] = useState("")
  const [lessonId, setLessonId] = useState("")
  const [sourceType, setSourceType] = useState<SourceFilter>("")
  const [q, setQ] = useState("")
  const [inputValue, setInputValue] = useState("")
  const [page, setPage] = useState(1)

  // ── UI 态 ────────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [dragging, setDragging] = useState(false)
  const cardsRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; scrollLeft: number } | null>(null)

  const showConfirmModal = useCallback(
    (title: string, msg: string) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ title, msg, resolve })
      }),
    [],
  )

  // 手动重拉计数：清空/删除成功后由事件处理器自增，两个 effect 同时重跑
 //（基准实现删除成功后 loadMistakes+loadReviewStats+loadSourceTypeStats+loadMistakeCourses 四源全刷）
  const [reloadNonce, setReloadNonce] = useState(0)
  const reloadAll = useCallback(() => setReloadNonce((n) => n + 1), [])

  // ── 聚合数据：课程卡/课节签/统计/分布 ────────────────────────────────────
  // react-hooks/set-state-in-effect 禁止 effect 体内同步 setState；
  // setState 全部放进 fetch 的异步回调（与 store/CourseDetailClient 同一范式）。
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (courseId) params.set("courseId", courseId)
    if (lessonId) params.set("lessonId", lessonId)
    fetch(`/api/user/mistake-book?${params.toString()}`)
      .then(async (r) => (r.ok ? ((await r.json()) as AggregateData) : null))
      .then((data) => {
        if (cancelled || !data) return
        setCourses(data.courses ?? [])
        setLessons(courseId ? (data.lessons ?? []) : [])
        setStats(data.stats)
        setSource(data.source)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [courseId, lessonId, reloadNonce])

 // ── 列表：服务端分页（基准实现 pageSize=8）；拉取后勾选/展开一律重置 ──────
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    params.set("page", String(page))
    params.set("pageSize", String(PAGE_SIZE))
    if (sourceType) params.set("sourceType", sourceType)
    if (q) params.set("q", q)
    if (courseId) params.set("courseId", courseId)
    if (lessonId) params.set("lessonId", lessonId)
    fetch(`/api/user/mistake-book/items?${params.toString()}`)
      .then(async (r) => (r.ok ? ((await r.json()) as ItemsData) : null))
      .then((data) => {
        if (cancelled || !data) return
        setItems(data.items ?? [])
        setTotalCount(data.total ?? 0)
        setSelected(new Set())
        setExpanded(new Set())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [courseId, lessonId, sourceType, q, page, reloadNonce])

 // ── 交互：课程/课节/来源/搜索（均回第 1 页，基准实现 reSearch 语义）────────
  const selectCourse = (id: string) => {
    if (id === courseId) return
    setCourseId(id)
    setLessonId("")
    setPage(1)
  }

  const selectLesson = (id: string) => {
    if (id === lessonId) return
    setLessonId(id)
    setPage(1)
  }

  const selectSource = (val: SourceFilter) => {
    if (val === sourceType) return
    setSourceType(val)
    setPage(1)
  }

  const submitSearch = () => {
    const next = inputValue.trim().slice(0, 100)
    setInputValue(next)
    if (next === q) return
    setQ(next)
    setPage(1)
  }

  const clearSearch = () => {
    setInputValue("")
    if (q !== "") {
      setQ("")
      setPage(1)
    }
  }

  // ── 勾选与批量 ───────────────────────────────────────────────────────────
  const itemKeyOf = (it: BookItem) => `${it.kind}:${it.key}`

  const toggleSelectAll = (master: boolean) => {
    setSelected(master ? new Set(items.map(itemKeyOf)) : new Set())
  }

  const toggleSelected = (it: BookItem) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const k = itemKeyOf(it)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const allSelected = items.length > 0 && items.every((it) => selected.has(itemKeyOf(it)))

  const deleteOne = async (it: BookItem) => {
    const isFavorite = it.kind !== "mistake"
    const ok = isFavorite
      ? await showConfirmModal("取消收藏", "确定要取消收藏吗？")
      : await showConfirmModal("删除错题", "确定要删除该错题吗？此操作不可恢复！")
    if (!ok) return
    const params = new URLSearchParams({ kind: it.kind, key: it.key })
    const res = await fetch(`/api/user/mistake-book/items?${params.toString()}`, { method: "DELETE" })
    if (!res.ok) {
      alert("操作失败,请稍后重试")
      return
    }
    reloadAll()
  }

  const batchDeleteSelected = async () => {
    if (selected.size === 0) {
      alert("请先选择要删除的记录")
      return
    }
    const ok = await showConfirmModal(
      "批量删除",
      `确定要删除选中的 ${selected.size} 条记录吗？此操作不可恢复！`,
    )
    if (!ok) return
    const payload = items
      .filter((it) => selected.has(itemKeyOf(it)))
      .map((it) => ({ kind: it.kind, key: it.key }))
    const res = await fetch("/api/user/mistake-book/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload }),
    })
    if (!res.ok) {
      alert("操作失败,请稍后重试")
      return
    }
    reloadAll()
  }

  const clearAllMistakes = async () => {
    const scopeParts: string[] = []
    if (courseId) {
      const name = courses.find((c) => c.courseId === courseId)?.courseName ?? "当前课程"
      scopeParts.push(`课程: ${name}`)
    }
    if (lessonId) {
      const name = lessons.find((l) => l.lessonId === lessonId)?.lessonName ?? "当前课节"
      scopeParts.push(`课节: ${name}`)
    }
    if (sourceType) scopeParts.push(`类型: ${TYPE_MAP[sourceType]}`)
    const scopeText = scopeParts.length > 0 ? `（${scopeParts.join(" / ")}）` : "（全部记录）"
    const ok = await showConfirmModal("清空记录", `确定要清空${scopeText}吗？此操作不可恢复！`)
    if (!ok) return
    const params = new URLSearchParams()
    if (sourceType) params.set("sourceType", sourceType)
    if (courseId) params.set("courseId", courseId)
    if (lessonId) params.set("lessonId", lessonId)
    const res = await fetch(`/api/user/mistake-book?${params.toString()}`, { method: "DELETE" })
    if (!res.ok) {
      alert("操作失败,请稍后重试")
      return
    }
    reloadAll()
  }

  const startReview = () => {
    if (stats.dueToday > 0) {
      const params = new URLSearchParams()
      if (courseId) params.set("courseId", courseId)
      if (lessonId) params.set("lessonId", lessonId)
      const qs = params.toString()
      router.push(qs ? `/home/review/session?${qs}` : "/home/review/session")
    } else {
      alert("暂无待复习项目，继续学习新内容吧！")
    }
  }

 // ── 课程卡横向滚动（拖拽 + 箭头，基准实现 initCardsScroll 语义）───────────
  const updateScrollArrows = useCallback(() => {
    const el = cardsRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 5)
  }, [])

  useEffect(() => {
    updateScrollArrows()
  }, [courses, updateScrollArrows])

  const scrollCards = (dir: number) => {
    cardsRef.current?.scrollBy({ left: dir * SCROLL_STEP, behavior: "smooth" })
  }

  const onCardsMouseDown = (e: React.MouseEvent) => {
 // 基准实现：点在卡片上不进入拖拽（保证点击选课），只在空白处拖动
    if ((e.target as HTMLElement).closest(".course-card")) return
    dragRef.current = { startX: e.clientX, scrollLeft: cardsRef.current?.scrollLeft ?? 0 }
    setDragging(true)
  }

  const onCardsMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current || !cardsRef.current) return
    const walk = (e.clientX - dragRef.current.startX) * 1.5
    cardsRef.current.scrollLeft = dragRef.current.scrollLeft - walk
  }

  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

 // ── 展开/收起（基准实现：.ai-btn 或 .tit 空白处点击切换）──────────────────
  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const onTitClick = (e: React.MouseEvent, key: string) => {
    if ((e.target as HTMLElement).closest(".action-btn, .item-checkbox")) return
    toggleExpanded(key)
  }

  // ── 派生数值 ────────────────────────────────────────────────────────────
  const totalMistakes = courses.reduce((sum, c) => sum + c.mistakeCount, 0)
  const totalDueReview = courses.reduce((sum, c) => sum + c.dueReviewCount, 0)
  const totalAll = source.mistake + source.sentence + source.word
  const pct = (n: number) => `${Math.round((n / (totalAll || 1)) * 100)}%`
  const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const winStart = Math.floor((page - 1) / PAGE_BUTTON_SIZE) * PAGE_BUTTON_SIZE + 1
  const winEnd = Math.min(winStart + PAGE_BUTTON_SIZE - 1, lastPage)
  const countSuffix =
    sourceType === "mistake" ? "错题" : sourceType === "sentence" ? "收藏句子" : sourceType === "word" ? "收藏单词" : "记录"
  const emptyText = totalCount === 0 ? `暂无${countSuffix}` : ""
  const pageNumbers: number[] = []
  for (let n = winStart; n <= winEnd; n += 1) pageNumbers.push(n)

  const goPage = (n: number) => {
    if (n < 1 || n > lastPage || n === page) return
    setPage(n)
  }

  const hideCoverImage = (e: React.SyntheticEvent<HTMLImageElement>) => {
 // 基准实现 onerror：隐藏破图并让容器显示兜底图标
    e.currentTarget.style.display = "none"
    e.currentTarget.parentElement?.classList.add("no-image")
  }

  const renderCardStats = (mistakeCount: number, dueReviewCount: number) => (
    <div className="card-stats">
      <span>
        <i className="ri-file-list-line" />
        {mistakeCount}题
      </span>
      {dueReviewCount > 0 && (
        <span className="due-review">
          <i className="ri-refresh-line" />
          {dueReviewCount}待复习
        </span>
      )}
    </div>
  )

  const renderHero = (it: BookItem) => {
    const isFavorite = it.kind !== "mistake"
    const badgeClass = it.kind === "word" ? " type-fav-word" : it.kind === "sentence" ? " type-fav-sentence" : ""
    const badgeLabel = isFavorite ? TYPE_MAP[it.kind] : "错题"
    if (it.kind === "word") {
      return (
        <>
          <div className="word-hero-row">
            <span className={`error-badge${badgeClass}`}>{badgeLabel}</span>
            <span className="hero-word">{it.word || it.english}</span>
          </div>
          <div className="context-row">
            <span className="context-sentence">{it.english}</span>
          </div>
        </>
      )
    }
    return (
      <div className="sentence-hero-row">
        <span className={`error-badge${badgeClass}`}>{badgeLabel}</span>
        <span className="hero-sentence">{it.english}</span>
      </div>
    )
  }

  return (
    <div className="mainBox">
      <div>
        <div className="maxWidth mistake-book-content">
          <div className="mistake-dashboard">
            {/* 左卡：收录总数 + 开始复习 */}
            <div className="dashboard-card primary-card">
              <div className="header-tools">
                <button className="clear-btn" onClick={clearAllMistakes}>
                  <i className="ri-delete-bin-line" />
                  清空
                </button>
              </div>
              <div className="stats-header">
                <h4>
                  <i className="ri-book-marked-line" />
                  错题本
                  <span className="today-badge">
                    今日 +<span>{stats.todayNew}</span>
                  </span>
                </h4>
              </div>
              <div className="main-metric">
                <span className="big-num">{totalAll}</span>
                <label>当前收录总数</label>
              </div>
              <button className="dashboard-review-btn" onClick={startReview}>
                <i className="ri-play-circle-fill" />
                <span>开始智能复习</span>
                {stats.dueToday > 0 && <span className="badge">{stats.dueToday}</span>}
              </button>
              <div className="review-hint">
                <i className="ri-lightbulb-flash-line" />
                <span>复习计划根据艾宾浩斯记忆曲线自动安排</span>
              </div>
            </div>
            {/* 右卡：今日/明日/掌握率 + 类型分布条 */}
            <div className="dashboard-card analysis-card">
              <div className="analysis-simple-grid">
                <div className="simple-stat-block">
                  <label>
                    <i className="ri-calendar-check-line" />
                    今日需复习
                  </label>
                  <div className="stat-main-value highlight">
                    <span className="animate-num">{stats.dueToday}</span>
                    <small>词条</small>
                  </div>
                  <div className="stat-sub-row">
                    <span>
                      明日: <b>{stats.dueTomorrow}</b>
                    </span>
                  </div>
                </div>
                <div className="simple-stat-block bordered-left">
                  <label>
                    <i className="ri-medal-line" />
                    已掌握
                  </label>
                  <div className="stat-main-value">
                    <span>{stats.mastered}</span>
                  </div>
                  <div className="stat-sub-row">
                    <span>
                      掌握率: <b>{stats.masteryRate}%</b>
                    </span>
                  </div>
                </div>
                <div className="simple-stat-block distribution-block">
                  <div className="stat-group-row">
                    <div className="stat-group-item">
                      <b>{source.mistake}</b>
                      <label>
                        <i className="dot grammar" />
                        错题
                      </label>
                    </div>
                    <div className="stat-group-item">
                      <b>{source.sentence}</b>
                      <label>
                        <i className="dot vocab" />
                        收藏句子
                      </label>
                    </div>
                    <div className="stat-group-item">
                      <b>{source.word}</b>
                      <label>
                        <i className="dot spelling" />
                        收藏单词
                      </label>
                    </div>
                  </div>
                  <div className="dist-bar-container">
                    <div className="dist-bar bar-grammar" style={{ width: pct(source.mistake) }} title="错题" />
                    <div className="dist-bar bar-vocab" style={{ width: pct(source.sentence) }} title="收藏句子" />
                    <div className="dist-bar bar-spelling" style={{ width: pct(source.word) }} title="收藏单词" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 课程卡横滚区 */}
          <div className="course-cards-section">
            <button
              className="scroll-arrow scroll-left"
              style={{ display: canScrollLeft ? "flex" : "none" }}
              onClick={() => scrollCards(-1)}
            >
              <i className="ri-arrow-left-s-line" />
            </button>
            <div
              className={`course-cards-container${dragging ? " dragging" : ""}`}
              ref={cardsRef}
              onScroll={updateScrollArrows}
              onMouseDown={onCardsMouseDown}
              onMouseMove={onCardsMouseMove}
              onMouseUp={endDrag}
              onMouseLeave={endDrag}
            >
              <div className={`course-card${courseId === "" ? " active" : ""}`} onClick={() => selectCourse("")}>
                <div className="card-cover all-courses">
                  <i className="ri-book-shelf-line" />
                </div>
                <div className="card-info">
                  <div className="card-name">全部课程</div>
                  {renderCardStats(totalMistakes, totalDueReview)}
                </div>
              </div>
              {courses.map((c) => (
                <div
                  key={c.courseId}
                  className={`course-card${courseId === c.courseId ? " active" : ""}`}
                  onClick={() => selectCourse(c.courseId)}
                >
                  <div className={`card-cover${c.coverUrl ? "" : " no-image"}`}>
                    {c.coverUrl ? (
 // eslint-disable-next-line @next/next/no-img-element -- 基准实现原样使用 <img>，需要 onerror 兜底
                      <img src={c.coverUrl} alt={c.courseName} onError={hideCoverImage} />
                    ) : (
                      <i className="ri-book-2-line" />
                    )}
                  </div>
                  <div className="card-info">
                    <div className="card-name" title={c.courseName}>
                      {c.courseName}
                    </div>
                    {renderCardStats(c.mistakeCount, c.dueReviewCount)}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="scroll-arrow scroll-right"
              style={{ display: canScrollRight ? "flex" : "none" }}
              onClick={() => scrollCards(1)}
            >
              <i className="ri-arrow-right-s-line" />
            </button>
          </div>

          {/* 课节签（仅选课程后出现） */}
          {courseId && (
            <div className="lesson-filter-section">
              <div className="lesson-tabs">
                <span className={`lesson-tab${lessonId === "" ? " active" : ""}`} onClick={() => selectLesson("")}>
                  全部课节
                </span>
                {lessons.map((l) => (
                  <span
                    key={l.lessonId}
                    className={`lesson-tab${lessonId === l.lessonId ? " active" : ""}`}
                    onClick={() => selectLesson(l.lessonId)}
                  >
                    <span className="lesson-name">{l.lessonName}</span>
                    <span className="lesson-badge">{l.mistakeCount}题</span>
                    {l.dueReviewCount > 0 && <span className="lesson-badge due">{l.dueReviewCount}待复习</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 筛选行 + 批量工具栏 */}
          <div className="secondBox">
            <div className="filter-row">
              <div className="source_tab">
                {SOURCE_TABS.map((t) => (
                  <em
                    key={t.val || "all"}
                    className={sourceType === t.val ? "on" : ""}
                    data-val={t.val}
                    onClick={() => selectSource(t.val)}
                  >
                    {t.label}
                  </em>
                ))}
              </div>
              <div className="filter-right">
                <div className="count">
                  共{totalCount}条{countSuffix}
                </div>
                <button className="filter-clear-btn" onClick={clearAllMistakes} title="清空当前范围的记录">
                  <i className="ri-delete-bin-line" /> 清空
                </button>
                <div className="searchInp">
                  <p>
                    <i className="ri-search-line" />
                    <input
                      type="text"
                      placeholder="搜索题目"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.nativeEvent.isComposing !== true) submitSearch()
                      }}
                    />
                    <i
                      className={`ri-close-circle-fill search-clear${inputValue ? " on" : ""}`}
                      onClick={clearSearch}
                    />
                  </p>
                </div>
              </div>
            </div>
            <div className="batch-toolbar">
              <label className="select-all-label">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
                <span>全选本页</span>
              </label>
              <span className="selected-count">
                已选 <b>{selected.size}</b> 项
              </span>
              <div className="batch-actions">
                <button className="batch-del-btn" disabled={selected.size === 0} onClick={batchDeleteSelected}>
                  <i className="ri-delete-bin-line" /> 删除选中
                </button>
              </div>
            </div>
          </div>

          <div className="mistakeList">
            <ul className="mistakesUI">
              {items.map((it) => {
                const ck = itemKeyOf(it)
                const isExpanded = expanded.has(ck)
                const isFavorite = it.kind !== "mistake"
                return (
                  <li
                    key={ck}
                    className={`${isFavorite ? "favorite-item " : ""}${it.kind === "word" ? "type-word" : "type-sentence"} compact-item${isExpanded ? " on" : ""}`}
                  >
                    <div className="tit" onClick={(e) => onTitClick(e, ck)}>
                      <div className="type-indicator" />
                      <div className="item-checkbox">
                        <input
                          type="checkbox"
                          className="row-checkbox"
                          checked={selected.has(ck)}
                          onChange={() => toggleSelected(it)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="item-main">
                        {renderHero(it)}
                        <div className="item-meta">
                          {it.courseTitle && (
                            <span className="meta-tag">
                              <i className="ri-book-read-line" />
                              {it.courseTitle}
                            </span>
                          )}
                          {it.courseTitle && it.lessonTitle && <span className="meta-sep">/</span>}
                          {it.lessonTitle && <span className="meta-tag">{it.lessonTitle}</span>}
                          {(it.courseTitle || it.lessonTitle) && <span className="meta-sep">/</span>}
                          <span className="meta-time">{fmtTime(it.ts)}</span>
                        </div>
                      </div>
                      <div className="item-actions">
                        {!isFavorite && (
                          <a
                            className="action-btn ai-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpanded(ck)
                            }}
                          >
                            <i className="ri-file-list-line" /> 详情
                          </a>
                        )}
                        <a
                          className="action-btn del-btn"
                          title={isFavorite ? "取消收藏" : "删除"}
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteOne(it)
                          }}
                        >
                          <i className="ri-delete-bin-line" />
                        </a>
                      </div>
                    </div>
                    <div className="detail" style={{ display: isExpanded ? "block" : "none" }}>
                      <div className="detail-content">
                        <div className="translation-block">
                          <span className="detail-label">译</span>
                          <span className="detail-text">{it.chinese || "No translation available"}</span>
                        </div>
                        {!isFavorite && (
                          <div className="mistake-meta-row">
                            <span className="meta-text">错误次数 {it.reviewCount}</span>
                          </div>
                        )}
                        {!isFavorite && it.userWrong && (
                          <div className="diff-container">
                            <div className="diff-chip">
                              <span className="val-wrong">{it.userWrong}</span>
                              <i className="ri-arrow-right-s-line arrow" />
                              <span className="val-correct">{it.english}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className={`noneMistake${totalCount === 0 ? " on" : ""}`}>
              <i className="ri-filter-line" />
              <label className="no-text">{emptyText}</label>
            </div>
          </div>

          {totalCount > 0 && (
            <div className="pages">
              <a onClick={() => goPage(1)}>
                <i className="ri-arrow-left-double-line" />
              </a>
              {page > 1 ? (
                <a className="perv" onClick={() => goPage(page - 1)}>
                  <i className="ri-arrow-left-s-line" />
                </a>
              ) : (
                <a style={{ cursor: "not-allowed" }}>
                  <i className="ri-arrow-left-s-line" />
                </a>
              )}
              {winStart > 1 && (
                <a>
                  <span>...</span>
                </a>
              )}
              {pageNumbers.map((n) =>
                n === page ? (
                  <a key={n} className="on">
                    <span>{n}</span>
                  </a>
                ) : (
                  <a key={n} className={`btnPage${n}`} onClick={() => goPage(n)}>
                    <span>{n}</span>
                  </a>
                ),
              )}
              {winEnd < lastPage && (
                <a>
                  <span>...</span>
                </a>
              )}
              {page < lastPage ? (
                <a className="next" onClick={() => goPage(page + 1)}>
                  <i className="ri-arrow-right-s-line" />
                </a>
              ) : (
                <a style={{ cursor: "not-allowed" }}>
                  <i className="ri-arrow-right-s-line" />
                </a>
              )}
              <a onClick={() => goPage(lastPage)}>
                <i className="ri-arrow-right-double-line" />
              </a>
            </div>
          )}
        </div>
      </div>
 {/* 基准实现自定义确认弹窗（Promise 语义；遮罩点击 = 取消） */}
      {confirmState && (
        <div
          className="mb-modal-overlay"
          onClick={() => {
            confirmState.resolve(false)
            setConfirmState(null)
          }}
        >
          <div className="mb-modal">
            <div className="mb-modal-title">{confirmState.title}</div>
            <div className="mb-modal-msg">{confirmState.msg}</div>
            <div className="mb-modal-btns">
              <button
                className="mb-btn mb-btn-cancel"
                onClick={() => {
                  confirmState.resolve(false)
                  setConfirmState(null)
                }}
              >
                取消
              </button>
              <button
                className="mb-btn mb-btn-ok"
                onClick={() => {
                  confirmState.resolve(true)
                  setConfirmState(null)
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
