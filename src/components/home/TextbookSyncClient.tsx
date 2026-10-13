"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleX,
  FileText,
  GraduationCap,
  History,
  // 别名避开 jsx-a11y/alt-text：lucide 的 <Image> 组件名会被当成图片元素
  Image as ImageIcon,
  ImageOff,
  ListVideo,
  RefreshCw,
  Search,
  Users,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Course } from "@/types/course"
import { GRADE_LABELS, UNGRADED_STAGE_KEY, versionLabel } from "@/lib/textbook-taxonomy"
import {
  flattenGradeTabs,
  hasActiveFilters,
  MAX_SEARCH_LENGTH,
  normalizeSearchValue,
  pageWindowNumbers,
  pageWindowStart,
  parseTextbookSyncQuery,
  QUERY_GRADE,
  QUERY_PAGE,
  QUERY_SEARCH,
  QUERY_VERSION,
  PAGE_BUTTON_SIZE,
  readLastFilter,
  restoreSummaryText,
  saveLastFilter,
  searchTermError,
  TEXTBOOK_PAGE_SIZE,
  unionVersionTabs,
  type FacetStage,
  type LastFilter,
  type TextbookSyncQuery,
} from "@/lib/textbook-sync"

/**
 * 课本同步列表页（/home/textbook）——句游英语 /User/TextbookSync 的复刻。
 *
 * 结构与交互对齐参考页（~/Downloads/课本同步 - 句游英语.html）：
 *   hero 搜索 → 年级/版本双行筛选卡 → 结果统计栏（chips/上次选择/重置）
 *   → 课程卡片流 → 5 页窗口分页器。
 * 可单测的纯逻辑全部收在 src/lib/textbook-sync.ts，这里只做编排。
 *
 * 与参考站的差异（数据面差异，行为不变）：
 *   · 年级/版本标签由 /api/courses/textbook-facets 数据驱动（参考站是写死的 14+30 个）；
 *   · remixicon → lucide（本仓不装 remixicon，CSS 的 i 规则落在 <i> 包装上）；
 *   · toast 用 sonner（参考站是自制 3s 彩条）。
 */

/** 图标包一层 <i>：CSS 的 `i` 规则（颜色/字号）落在包装上，svg 尺寸由 size 给。 */
const iconWrap: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textIndent: 0,
}

function Icon({
  as: Cmp,
  size,
  className,
  title,
  onClick,
}: {
  as: LucideIcon
  size: number
  className?: string
  title?: string
  onClick?: () => void
}) {
  return (
    <i className={className} style={iconWrap} title={title} onClick={onClick}>
      <Cmp size={size} />
    </i>
  )
}

export function TextbookSyncClient() {
  const router = useRouter()
  const [stages, setStages] = useState<FacetStage[]>([])
  const [booted, setBooted] = useState(false)
  const [filters, setFilters] = useState<TextbookSyncQuery>({
    gradeCode: "",
    publisherId: "",
    courseName: "",
    page: 1,
  })
  /** 输入框的原始值（未提交）；提交后的词在 filters.courseName 里。 */
  const [searchText, setSearchText] = useState("")
  const [list, setList] = useState<Course[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastFilter, setLastFilter] = useState<LastFilter | null>(null)
  const [brokenCovers, setBrokenCovers] = useState<Record<string, true>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  /** popstate 恢复时校验 URL 参数用的键域（facets 加载后更新）。 */
  const keysRef = useRef({ grades: [] as string[], versions: [] as string[] })

  const gradeTabs = flattenGradeTabs(stages)
  const versionTabs = unionVersionTabs(stages)
  const totalPages = Math.max(1, Math.ceil(total / TEXTBOOK_PAGE_SIZE))
  const gradeName =
    gradeTabs.find((t) => t.key === filters.gradeCode)?.label ??
    GRADE_LABELS[filters.gradeCode] ??
    filters.gradeCode
  const versionName = versionLabel(filters.publisherId)
  const hasFilter = Boolean(filters.gradeCode || filters.publisherId)
  const showRestore = Boolean(lastFilter) && !hasActiveFilters(filters.gradeCode, filters.publisherId, filters.courseName)

  // ── 启动：拉筛选面 → 解析 URL（replaceState 语义）→ 回填输入框与「上次选择」──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/courses/textbook-facets", { cache: "no-store" })
        const json = (await res.json()) as { stages?: FacetStage[] }
        if (cancelled) return
        const nextStages = Array.isArray(json.stages) ? json.stages : []
        setStages(nextStages)
        const q = parseTextbookSyncQuery(
          new URLSearchParams(window.location.search),
          flattenGradeTabs(nextStages).map((t) => t.key),
          unionVersionTabs(nextStages).map((v) => v.key),
        )
        setFilters(q)
        setSearchText(q.courseName)
        setLastFilter(readLastFilter())
      } catch {
        if (!cancelled) toast.error("加载筛选条件失败")
      } finally {
        if (!cancelled) setBooted(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── 列表拉取：参考站默认「热门推荐」= most_used ──────────────────────────────
  useEffect(() => {
    if (!booted) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          current: String(filters.page),
          pageSize: String(TEXTBOOK_PAGE_SIZE),
          sortMode: "most_used",
        })
        if (filters.gradeCode) {
          // 未分级走 stage 参数（list 路由识别后转 isNull(subCategoryKey)），
          // 具体年级直接用 subCategoryKey。
          if (filters.gradeCode === UNGRADED_STAGE_KEY) params.set("stage", filters.gradeCode)
          else params.set("subCategoryKey", filters.gradeCode)
        }
        if (filters.publisherId) params.set("textbookVersion", filters.publisherId)
        if (filters.courseName) params.set("search", filters.courseName)
        const res = await fetch(`/api/courses/list?${params.toString()}`, { cache: "no-store" })
        const json = (await res.json()) as { data?: Course[]; total?: number }
        if (cancelled) return
        setList(Array.isArray(json.data) ? json.data : [])
        setTotal(typeof json.total === "number" ? json.total : 0)
      } catch {
        if (!cancelled) {
          toast.error("加载课程列表失败")
          setList([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [booted, filters])

  // ── 浏览器前进/后退：参考站 popstate 恢复筛选并重拉 ─────────────────────────
  useEffect(() => {
    const onPop = () => {
      const q = parseTextbookSyncQuery(
        new URLSearchParams(window.location.search),
        keysRef.current.grades,
        keysRef.current.versions,
      )
      setFilters(q)
      setSearchText(q.courseName)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  useEffect(() => {
    keysRef.current = { grades: gradeTabs.map((t) => t.key), versions: versionTabs.map((v) => v.key) }
  })

  /** 把筛选写进 URL（参数名与参考站一致）。 */
  const syncUrl = useCallback((q: TextbookSyncQuery, mode: "replace" | "push") => {
    const params = new URLSearchParams()
    if (q.gradeCode) params.set(QUERY_GRADE, q.gradeCode)
    if (q.publisherId) params.set(QUERY_VERSION, q.publisherId)
    if (q.courseName) params.set(QUERY_SEARCH, q.courseName)
    if (q.page > 1) params.set(QUERY_PAGE, String(q.page))
    const qs = params.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`
    if (mode === "push") window.history.pushState({}, "", url)
    else window.history.replaceState({}, "", url)
  }, [])

  /**
   * 「上次选择」记忆：与参考站一致 —— 每次点年级/版本（含 chip 移除）都把
   * **当前筛选结果**存进去，两个维度全空则移除记忆。
   */
  const persistSelection = useCallback(
    (q: Pick<TextbookSyncQuery, "gradeCode" | "publisherId">) => {
      const gLabel = gradeTabs.find((t) => t.key === q.gradeCode)?.label ?? GRADE_LABELS[q.gradeCode] ?? ""
      saveLastFilter({
        gradeCode: q.gradeCode,
        gradeName: gLabel,
        publisherId: q.publisherId,
        publisherName: q.publisherId ? versionLabel(q.publisherId) : "",
      })
      setLastFilter(readLastFilter())
    },
    [gradeTabs],
  )

  /** 用户操作的统一入口：更新 state + pushState + 更新记忆。 */
  const applyFilters = useCallback(
    (next: TextbookSyncQuery) => {
      setFilters(next)
      syncUrl(next, "push")
      persistSelection(next)
    },
    [syncUrl, persistSelection],
  )

  const selectGrade = (gradeCode: string) => applyFilters({ ...filters, gradeCode, page: 1 })
  const selectVersion = (publisherId: string) => applyFilters({ ...filters, publisherId, page: 1 })

  /** 提交搜索（参考站 doCourseSearch）：单字符 toast 提示并聚焦，不发请求。 */
  const commitSearch = () => {
    const term = normalizeSearchValue(searchText)
    const err = searchTermError(term)
    if (err) {
      toast.info(err)
      inputRef.current?.focus()
      return
    }
    if (term !== searchText) setSearchText(term)
    applyFilters({ ...filters, courseName: term, page: 1 })
  }

  /** 清除图标：清空输入 + 重新搜索（参考站 clearSearch 语义）。 */
  const clearSearch = () => {
    setSearchText("")
    applyFilters({ ...filters, courseName: "", page: 1 })
  }

  /**
   * 重置：清筛选+搜索。刻意**不**动「上次选择」记忆 —— 重置后按钮可一键恢复，
   * 参考站的 btnClearAllFilters 也不清除 localStorage。
   */
  const resetAll = () => {
    const next: TextbookSyncQuery = { gradeCode: "", publisherId: "", courseName: "", page: 1 }
    setFilters(next)
    setSearchText("")
    syncUrl(next, "push")
  }

  const restoreLast = () => {
    if (!lastFilter) return
    applyFilters({
      ...filters,
      gradeCode: lastFilter.gradeCode,
      publisherId: lastFilter.publisherId,
      page: 1,
    })
  }

  const gotoPage = (page: number) => {
    if (page === filters.page || page < 1 || page > totalPages) return
    applyFilters({ ...filters, page })
    // 参考站 loadData 完成后把结果栏滚回视口
    toolbarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const markBroken = (id: string) => setBrokenCovers((prev) => ({ ...prev, [id]: true }))

  const restoreTitle = lastFilter
    ? `点击恢复上次选择：${[lastFilter.gradeName, lastFilter.publisherName].filter(Boolean).join(" · ")}`
    : ""

  return (
    <div className="textbook-sync-page course-market sync-market-page">
      {/* ── hero：标题 + 徽章 + 副标题 + 搜索框 ── */}
      <div className="maxWidth">
        <div className="market-hero-section sync-hero">
          <div className="hero-left">
            <div className="hero-title-row">
              <h2>课本同步</h2>
              <span className="hero-sync-badge">
                <Icon as={BookOpen} size={13} /> 教材同步学习
              </span>
            </div>
            <span className="hero-subtitle">覆盖主流教材版本，紧扣课本单元体系，让课后练习更有针对性</span>
          </div>
          <div className="hero-right">
            <div className="searchInp modern-search">
              <p>
                <i
                  className="search-icon-main"
                  style={iconWrap}
                  title="点击搜索"
                  onClick={commitSearch}
                >
                  <Search size={20} />
                </i>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="搜索课本名称..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value.slice(0, MAX_SEARCH_LENGTH))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSearch()
                  }}
                />
                <i className={cn("search-clear", searchText && "on")} onClick={clearSearch}>
                  <CircleX size={18} />
                </i>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 筛选卡 + 结果统计栏（与参考站同层：sync-filter-wrapper > maxWidth）── */}
      <div className="sync-filter-wrapper">
        <div className="maxWidth">
          <div className="sync-filter-card">
            <div className="filter-row filter-row-grade">
              <div className="filter-label">
                <Icon as={GraduationCap} size={16} />
                <span>年级</span>
              </div>
              <div className="filter-body">
                <div className="textbook-grades-tab">
                  <label
                    data-val=""
                    className={cn(filters.gradeCode === "" && "on")}
                    onClick={() => selectGrade("")}
                  >
                    全部年级
                  </label>
                  {gradeTabs.map((t) => (
                    <label
                      key={t.key}
                      data-val={t.key}
                      className={cn(filters.gradeCode === t.key && "on")}
                      onClick={() => selectGrade(t.key)}
                    >
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="filter-row-divider" />
            <div className="filter-row filter-row-publisher">
              <div className="filter-label">
                <Icon as={BookOpen} size={16} />
                <span>版本</span>
              </div>
              <div className="publisher-tags">
                <em
                  data-val=""
                  className={cn(filters.publisherId === "" && "on")}
                  onClick={() => selectVersion("")}
                >
                  全部版本
                </em>
                {versionTabs.map((v) => (
                  <em
                    key={v.key}
                    data-val={v.key}
                    className={cn(filters.publisherId === v.key && "on")}
                    onClick={() => selectVersion(v.key)}
                  >
                    {v.label}
                  </em>
                ))}
              </div>
            </div>
          </div>

          <div className="sync-status-toolbar" ref={toolbarRef}>
            <div className="status-left">
              <span className="result-count">
                <Icon as={FileText} size={14} />
                共找到 <b>{total}</b> 门相关课程
              </span>
              {/* 参考站 line109: 容器在 有筛选 || 有搜索词 时可见（此时可能没有任何 chip） */}
              {(hasFilter || filters.courseName) && (
                <div className="active-filter-chips">
                  <span className="chip-divider">|</span>
                  <span className="chip-label">已选：</span>
                  {filters.gradeCode && (
                    <span className="filter-chip">
                      <span className="chip-text">{gradeName}</span>
                      {/* chip 移除 = 清掉该维度并重新筛选 */}
                      <Icon as={X} size={13} title="清除此条件" onClick={() => selectGrade("")} />
                    </span>
                  )}
                  {filters.publisherId && (
                    <span className="filter-chip">
                      <span className="chip-text">{versionName}</span>
                      <Icon as={X} size={13} title="清除此条件" onClick={() => selectVersion("")} />
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="status-right">
              {showRestore && (
                <button type="button" className="btn-restore-last" title={restoreTitle} onClick={restoreLast}>
                  <Icon as={History} size={13} /> <span className="restore-text">{restoreSummaryText(lastFilter)}</span>
                </button>
              )}
              {hasActiveFilters(filters.gradeCode, filters.publisherId, filters.courseName) && (
                <button type="button" className="btn-clear-all" onClick={resetAll}>
                  <Icon as={RefreshCw} size={13} />重置筛选
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 课程卡片流 + 空态 ── */}
      <div className="maxWidth">
        <div className="TypeList">
          <ul>
            {list.map((course) => {
              const broken = Boolean(brokenCovers[course.id]) || !course.coverUrl
              return (
                <li
                  key={course.id}
                  className="market-course-card sync-textbook-card"
                  onClick={() => router.push(`/home/store/${course.id}?source=textbook-sync`)}
                >
                  <div className="img img-wrap">
                    <div className="img-placeholder">
                      <i style={broken ? { ...iconWrap, animation: "none" } : iconWrap}>
                        {broken ? <ImageOff size={32} /> : <ImageIcon size={32} />}
                      </i>
                    </div>
                    {course.coverUrl && (
                      // 封面是任意外域 URL，next/image 需要逐域配置，这里与 CourseCard 同口径用原生 img
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="course-cover-img"
                        src={course.coverUrl}
                        alt={course.title}
                        loading="lazy"
                        onLoad={(e) => {
                          // 与参考站 inline onload 一致：图就绪 → 隐藏占位
                          e.currentTarget.classList.add("loaded")
                          e.currentTarget.previousElementSibling?.classList.add("hidden")
                        }}
                        onError={() => markBroken(course.id)}
                      />
                    )}
                  </div>
                  <div className="card-main-content">
                    <h6 className="book-title" title={course.title}>
                      {course.title}
                    </h6>
                    <div className="card-meta-row">
                      <div className="meta-left">
                        <span className="meta-item">
                          <Icon as={Users} size={13} />
                          {course.learnerCount}人加入
                        </span>
                        {(course.lessonCount ?? 0) > 0 && (
                          <>
                            <span className="meta-dot">·</span>
                            <span className="meta-item">
                              <Icon as={ListVideo} size={13} /> {course.lessonCount}课时
                            </span>
                          </>
                        )}
                      </div>
                      <span className="btn-enter-study">
                        <span>去学习</span>
                        <Icon as={ArrowRight} size={13} />
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          {!loading && total === 0 && (
            <div className="sync-empty-state">
              <div className="empty-icon-box">
                <i style={iconWrap}>
                  <BookOpen size={32} />
                </i>
              </div>
              <h4 className="empty-title">暂无符合条件的教材课程</h4>
              <p className="empty-desc">未找到与当前筛选条件匹配的课本，建议尝试切换其他年级、版本或重置筛选</p>
              <div className="empty-actions">
                <button type="button" className="btn-empty-reset" onClick={resetAll}>
                  <Icon as={RefreshCw} size={13} /> 重置筛选条件
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 分页器：5 页窗口，参考站 pager.js 语义 ── */}
      {total > 0 && (
        <div className="pages" id="divPager">
          <a onClick={() => gotoPage(1)}>
            <Icon as={ChevronsLeft} size={18} />
          </a>
          <a
            id="previous"
            className="perv"
            style={filters.page === 1 ? { cursor: "not-allowed" } : undefined}
            onClick={filters.page > 1 ? () => gotoPage(filters.page - 1) : undefined}
          >
            <Icon as={ChevronLeft} size={18} />
          </a>
          {pageWindowNumbers(totalPages, filters.page).map((p) => (
            <a key={p} className={cn(p === filters.page && "on")} onClick={() => gotoPage(p)}>
              <span>{p}</span>
            </a>
          ))}
          {pageWindowStart(filters.page) + PAGE_BUTTON_SIZE <= totalPages && (
            <a>
              <span>...</span>
            </a>
          )}
          <a
            id="next"
            className="next"
            style={filters.page >= totalPages ? { cursor: "not-allowed" } : undefined}
            onClick={filters.page < totalPages ? () => gotoPage(filters.page + 1) : undefined}
          >
            <Icon as={ChevronRight} size={18} />
          </a>
          <a onClick={() => gotoPage(totalPages)}>
            <Icon as={ChevronsRight} size={18} />
          </a>
        </div>
      )}
    </div>
  )
}
