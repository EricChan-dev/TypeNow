"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock,
  Crown,
  FileText,
  History,
  Info,
  ListOrdered,
  Play,
  PlayCircle,
  Quote,
  Sparkles,
  Trash2,
  Users,
  XCircle,
} from "lucide-react"
import { resolveCourseCover } from "@/lib/course-cover"
import { trackCourseOpen } from "@/lib/analytics"
import { FREE_TRIAL_SENTENCES } from "@/lib/free-trial"
import type { GrammarPoint, LessonComplexity } from "@/lib/course-ai"

/**
 * 我的课程 · 课程详情页。
 *
 * ── 三处刻意裁定（都是「不造假数据」决议的落点）────────────────────
 *
 * 1. **课节级付费墙不搬**。课节锁定（pay-locked +「开通解锁」升级框）与
 *    我们的模型不符：每节课都能进、非会员每课前
 *    FREE_TRIAL_SENTENCES 句试学（lib/free-trial.ts）。课节锁等于按钮
 *    承诺一个不存在的限制。课程级的会员引导照做，但文案说的是真话
 *    （「开通会员，解锁全部句子」），锁定提示也只描述真实限制。
 * 2. **难度标签不渲染**。courses 表没有
 *    difficulty 列、sentences.difficulty 全库恒为 1，派生不出真实难度。
 *    `.course-meta-line` 只保留在学人数。
 * 3. **语法点 / 句子复杂度两块是占位**（用户决议 m20696）：课节级 AI 分析
 *    没有数据源，渲染「暂未生成」而不是编一个。
 *    核心词汇 / 核心短语从 sentences.words / chunks / dependency_analysis
 *    现场派生（/api/lessons/[id]/insight，规则在 lib/lesson-insight.ts）。
 *
 * ── 图标约定 ────────────────────────────────────────────────────────────────
 *
 * 本仓统一 lucide 图标（不引入 remixicon 字体图标）。
 * course-detail.css 里大量选择器落在 `i` 元素上（按钮里的圆形图标底、
 * 状态色、字号），所以 lucide 组件外面包一层 `<i>`：装饰由 CSS 的 `i`
 * 规则给，图形尺寸由 lucide 的 size 给（font-size 对 svg 无效）。
 */

interface LessonInfo {
  id: string
  title: string
  summary: string | null
  sortOrder: number
  sentenceCount: number
  state: "completed" | "current" | "none"
  lastPracticedAt: string | null
}

interface DetailData {
  course: {
    id: string
    title: string
    description: string | null
    coverUrl: string | null
    learnerCount: number | null
    categoryKey: string | null
    subCategoryKey: string | null
    textbookVersion: string | null
  }
  stats: {
    practiceCount: number
    completedSentences: number
    mistakeCount: number
    elapsedSeconds: number
  }
  progress: { completedLessons: number; totalLessons: number; percent: number }
  viewer: { isPro: boolean; trialAvailable: boolean; acquired: boolean }
  lessons: LessonInfo[]
}

interface InsightData {
  vocab: { word: string; pos: string; count: number }[]
  phrases: { phrase: string; count: number }[]
  grammar: null
  complexity: null
}

type InsightSlot = InsightData | "loading" | "error"

/** 课节 AI 分析（任务④）：语法点 + 句子复杂度，来自 /api/lessons/[id]/ai（落库缓存）。 */
interface AiInsightData {
  grammar: GrammarPoint[] | null
  complexity: LessonComplexity | null
}
type AiSlot = AiInsightData | "loading" | "error"
/** 课程简介（任务④）：课程级 AI 导学文案，来自 /api/courses/[id]/ai-intro。失败/未生成整块收起。 */
type AiIntroState = { status: "loading" | "ready" | "hidden"; text?: string }

/** 图标包一层 <i>：CSS 的 `i` 规则（圆底/颜色）落在包装上，svg 尺寸由 size 给。 */
const iconWrap: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  // .detailname button i 有 text-indent:2px（给字体图标调的），svg 不需要
  textIndent: 0,
}

function Icon({ children }: { children: ReactNode }) {
  return <i style={iconWrap}>{children}</i>
}

/** 学习时长的人话格式（直接渲染「N秒」在几千秒时不可读）。 */
export function formatStudyDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}秒`
  if (s < 3600) return `${Math.round(s / 60)}分钟`
  return `${(s / 3600).toFixed(1)}小时`
}

/** 「最近练习」的相对时间。 */
export function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ""
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(t).toLocaleDateString("zh-CN")
}

export function CourseDetailClient({ courseId }: { courseId: string }) {
  const router = useRouter()
  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [notFound, setNotFound] = useState(false)
  // 封面兜底：cover_url 可能是外链或后台上传的 base64，加载失败退回渐变色卡
  //（与 store/CourseDetailClient、CourseCard 的同一处兜底对应）。
  const [coverFailed, setCoverFailed] = useState(false)
 // 展开的课节（允许多个同时展开）
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  // 课节学习要点缓存：展开时才拉，拉过就不再拉
  const [insights, setInsights] = useState<Record<string, InsightSlot>>({})
  // 课节 AI 分析缓存（语法点/句子复杂度）：与 insights 同一套懒加载策略，
  // 但免费用户只在第一课节上真正发请求，其余课节渲染锁（服务端同口径强校验）
  const [aiSlots, setAiSlots] = useState<Record<string, AiSlot>>({})
  // 课程简介：独立请求（路由侧落库缓存、缓存优先，详情页每次加载都调）
  const [aiIntro, setAiIntro] = useState<AiIntroState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    // loading 的初值就是 true，不在这里同步 setLoading(true)——
    // react-hooks/set-state-in-effect 禁止 effect 体内同步 setState；
    // 本页面也不存在「同组件内换 courseId」的路径（课→课必经列表页）。
    // 与商城详情同一支漏斗事件：点进具体课程代表真实学习意图
    trackCourseOpen(courseId)
    fetch(`/api/courses/${courseId}/detail`)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true)
          return null
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as DetailData
      })
      .then((json) => {
        if (cancelled) return
        if (json) setData(json)
        else if (!notFound) setLoadError(true)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // notFound 只读一次做兜底判断，进依赖会让 404 分支自我循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  // 课程简介：课程级导学内容，所有人可见（「仅限第一课时」约束的是课节级分析）。
  // 路由缓存优先所以通常很快；失败/未生成 → 整块收起，不占版面也不弹错。
  // loading 的初值就是 loading，不在这里同步 setState（react-hooks/set-state-in-effect）。
  useEffect(() => {
    let cancelled = false
    fetch(`/api/courses/${courseId}/ai-intro`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as { intro: string }
      })
      .then((json) => {
        if (!cancelled) setAiIntro({ status: "ready", text: json.intro })
      })
      .catch(() => {
        if (!cancelled) setAiIntro({ status: "hidden" })
      })
    return () => {
      cancelled = true
    }
  }, [courseId])

  const toggleLesson = (lessonId: string) => {
    const isExpanding = !expandedIds.has(lessonId)

    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(lessonId)) next.delete(lessonId)
      else next.add(lessonId)
      return next
    })

    // 首次展开才请求学习要点（懒加载：596 课节的课程不能全量随页面下发）。
    // fetch 必须放在 updater 外面——setState 的 updater 必须是纯函数，
    // StrictMode 下 updater 会跑两遍，请求就发两次了。
    const slot = insights[lessonId]
    if (isExpanding && (!slot || slot === "error")) {
      setInsights((cur) => ({ ...cur, [lessonId]: "loading" }))
      fetch(`/api/lessons/${lessonId}/insight`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return (await r.json()) as InsightData
        })
        .then((json) => {
          setInsights((c) => ({ ...c, [lessonId]: json }))
        })
        .catch(() => {
          setInsights((c) => ({ ...c, [lessonId]: "error" }))
        })
    }

    // AI 分析（语法点/句子复杂度）：免费用户仅第一课节（lessons 按 sortOrder 升序，
    // [0] 即第一课节；服务端 /api/lessons/[id]/ai 同口径强校验，绕过 UI 直接打也 403）。
    // 会员锁的课节前端不发请求，渲染端用 locked 分支接住。
    const isPro = !!data?.viewer.isPro
    const isFirstLesson = lessonId === data?.lessons[0]?.id
    const aiSlot = aiSlots[lessonId]
    if (isExpanding && (isPro || isFirstLesson) && (!aiSlot || aiSlot === "error")) {
      setAiSlots((cur) => ({ ...cur, [lessonId]: "loading" }))
      fetch(`/api/lessons/${lessonId}/ai`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return (await r.json()) as AiInsightData
        })
        .then((json) => {
          setAiSlots((c) => ({ ...c, [lessonId]: json }))
        })
        .catch(() => {
          setAiSlots((c) => ({ ...c, [lessonId]: "error" }))
        })
    }
  }

  const startLesson = (lessonId: string) => {
    router.push(`/home/learn/${courseId}?lesson=${lessonId}`)
  }

  const unenroll = async () => {
 // 本仓没有全局确认弹窗组件，用原生 confirm
    if (!window.confirm("确定要移除此课程吗？移除后可在课程市场重新加入。")) return
    try {
      const res = await fetch("/api/user/acquired-courses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      })
      if (res.ok) router.push("/home/courses")
      else window.alert("移除失败，请稍后重试")
    } catch {
      window.alert("操作失败，请稍后重试")
    }
  }

  if (loading) {
    return (
      <div className="course-detail">
        <div className="maxWidth">
          <p style={{ padding: "80px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
            正在加载课程…
          </p>
        </div>
      </div>
    )
  }

  if (notFound || (!data && loadError)) {
    return (
      <div className="course-detail">
        <div className="maxWidth">
          <div style={{ padding: "80px 20px", textAlign: "center" }}>
            <p style={{ fontSize: 15, color: "#475569", marginBottom: 12 }}>
              {notFound ? "课程未找到或已下架" : "课程详情加载失败"}
            </p>
            <Link
              href="/home/courses"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 14, color: "#2C5AF4" }}
            >
              <ChevronLeft size={16} />
              返回课程列表
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { course, stats, progress, viewer, lessons } = data
  const cover = resolveCourseCover(course)
  const currentLesson = lessons.find((l) => l.state === "current")
  const primaryLesson = currentLesson ?? lessons[0]

  return (
    <div className="course-detail">
      <div className="maxWidth">
 {/* ── 返回条（.location）── */}
        <div className="location">
          <div className="back">
            <Link href="/home/courses" aria-label="返回课程列表">
              <Icon>
                <ChevronLeft size={20} />
              </Icon>
            </Link>
          </div>
          <h2>
            <Link href="/home/courses" style={{ color: "inherit", textDecoration: "none" }}>
              <span style={{ paddingTop: 0 }}>返回课程列表</span>
            </Link>
          </h2>
        </div>

        <div>
 {/* ── 课程头（.detailname）── */}
          <div className="detailname">
            <div className="img">
              {cover.kind === "image" && !coverFailed ? (
                // 裸 img 而不是 next/image：cover_url 可能是外链或 base64 dataURL，
                // next/image 对未登记 remotePatterns 的域名会直接抛错（store 详情同口径）
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={cover.src} alt="" onError={() => setCoverFailed(true)} />
              ) : (
                <div
                  style={{
                    background: cover.gradient,
                    aspectRatio: "16 / 9",
                    borderRadius: 10,
                  }}
                />
              )}
            </div>
            <div className="text">
              <h2>
                {course.title}
                {course.description ? <span>{course.description}</span> : null}
              </h2>
              <div className="course-meta-line">
                {/* 难度标签刻意不渲染：库里没有真实的难度数据（见文件头差异 2） */}
                <span className="enroll-count">
                  <Icon>
                    <Users size={14} />
                  </Icon>
                  {course.learnerCount ?? 0} 人在学
                </span>
              </div>
              <div className="rate">
                <label>
                  学习进度
                  <em>
                    {progress.percent}%（{progress.completedLessons}/{progress.totalLessons} 节）
                  </em>
                </label>
                <p>
                  <span style={{ width: `${progress.percent}%` }} />
                </p>
              </div>
              <div className="course-actions">
                {primaryLesson && (
                  <button
                    type="button"
                    className="course-primary-action"
                    onClick={() => startLesson(primaryLesson.id)}
                  >
                    <Icon>
                      <Play size={12} />
                    </Icon>
                    {currentLesson ? "继续学习" : "开始学习"}
                  </button>
                )}
                {!viewer.isPro && (
                  <button
                    type="button"
                    className="btn-unlock-course"
                    onClick={() => router.push("/home/membership")}
                  >
                    <Icon>
                      <Crown size={12} />
                    </Icon>
                    开通会员，解锁全部句子
                  </button>
                )}
                {viewer.acquired && (
                  <Link
                    className="btn-unenroll"
                    href="/home/courses"
                    onClick={(e) => {
                      e.preventDefault()
                      void unenroll()
                    }}
                  >
                    <Icon>
                      <Trash2 size={16} />
                    </Icon>
                    移除课程
                  </Link>
                )}
              </div>
              {!viewer.isPro && (
                <p className="course-locked-tip">
                  <Icon>
                    <Info size={14} />
                  </Icon>
                  免费账户每节课可试学前 {FREE_TRIAL_SENTENCES} 句，开通会员解锁全部内容
                </p>
              )}
            </div>
          </div>

          {/* ── 课程简介（任务④，课程级 AI 导学，所有人可见）── */}
          {aiIntro.status !== "hidden" && (
            <div className="ai-intro-section">
              <h5>
                <Icon>
                  <Sparkles size={20} />
                </Icon>
                课程简介
              </h5>
              {aiIntro.status === "loading" ? (
                <p className="ai-intro-loading">AI 正在生成课程简介…</p>
              ) : (
                <>
                  {(aiIntro.text ?? "")
                    .split("\n")
                    .filter(Boolean)
                    .map((para, pIdx) => (
                      <p key={pIdx}>{para}</p>
                    ))}
                  <p className="ai-intro-note">内容由 AI 根据课程内容生成，仅供参考</p>
                </>
              )}
            </div>
          )}

 {/* ── 学习统计（.study-stats-section，4 卡）── */}
          <div className="study-stats-section">
            <h5>
              <Icon>
                <BarChart3 size={20} />
              </Icon>
              学习统计
            </h5>
            <div className="stats-cards">
              <div className="stat-card">
                <div className="stat-icon practice">
                  <Icon>
                    <Play size={22} />
                  </Icon>
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.practiceCount}</span>
                  <span className="stat-label">练习次数</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon sentences">
                  <Icon>
                    <BookOpen size={22} />
                  </Icon>
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.completedSentences}</span>
                  <span className="stat-label">完成句子</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon mistakes">
                  <Icon>
                    <XCircle size={22} />
                  </Icon>
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.mistakeCount}</span>
                  <span className="stat-label">错题数</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon time">
                  <Icon>
                    <Clock size={22} />
                  </Icon>
                </div>
                <div className="stat-info">
                  <span className="stat-value">{formatStudyDuration(stats.elapsedSeconds)}</span>
                  <span className="stat-label">学习时长</span>
                </div>
              </div>
            </div>
          </div>

 {/* ── 课程目录（.lesson-list-section）── */}
          <div className="lesson-list-section">
            <div className="section-header">
              <h3>
                <Icon>
                  <ListOrdered size={22} />
                </Icon>
                课程目录
              </h3>
              <div className="header-right">
                <span className="lesson-count">共 {progress.totalLessons} 课节</span>
              </div>
            </div>
            <ul className="lesson-list">
              {lessons.map((lesson, idx) => {
                const expanded = expandedIds.has(lesson.id)
                const insight = insights[lesson.id]
                return (
                  <li
                    key={lesson.id}
                    className={[
                      "lesson-item-wrapper",
                      lesson.state === "completed" ? "completed" : "",
                      lesson.state === "current" ? "current" : "",
                      expanded ? "expanded" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="lesson-item" onClick={() => toggleLesson(lesson.id)}>
                      <div className="lesson-status">
                        {lesson.state === "completed" && (
                          <i className="status-completed" style={iconWrap}>
                            <CheckCircle2 size={22} />
                          </i>
                        )}
                        {lesson.state === "current" && (
                          <i className="status-progress" style={iconWrap}>
                            <PlayCircle size={22} />
                          </i>
                        )}
                      </div>
                      <div className="lesson-number">{String(idx + 1).padStart(2, "0")}</div>
                      <div className="lesson-content">
                        <span className="lesson-title">{lesson.title}</span>
                        {lesson.summary ? (
                          <p className="lesson-description">{lesson.summary}</p>
                        ) : null}
                      </div>
                      <div className="lesson-right">
                        <span className="sentence-count">{lesson.sentenceCount} 句</span>
                        {lesson.lastPracticedAt && (
                          <span className="last-practice-time">
                            <Icon>
                              <Clock size={12} />
                            </Icon>
                            {formatRelativeTime(lesson.lastPracticedAt)}
                          </span>
                        )}
                        <i
                          className={`lesson-toggle-icon${expanded ? " rotated" : ""}`}
                          style={iconWrap}
                        >
                          <ChevronDown size={18} />
                        </i>
                      </div>
                      <div className="lesson-actions" onClick={(e) => e.stopPropagation()}>
                        {lesson.state === "completed" && (
                          <button type="button" className="btn-review" onClick={() => startLesson(lesson.id)}>
                            <Icon>
                              <History size={14} />
                            </Icon>
                            复习
                          </button>
                        )}
                        {lesson.state === "current" && (
                          <button type="button" className="btn-continue" onClick={() => startLesson(lesson.id)}>
                            <Icon>
                              <Play size={14} />
                            </Icon>
                            继续
                          </button>
                        )}
                        {lesson.state === "none" && (
                          <button
                            type="button"
                            className="btn-start"
                            disabled={lesson.sentenceCount === 0}
                            title={lesson.sentenceCount === 0 ? "本课节暂无可练习句子" : undefined}
                            onClick={() => startLesson(lesson.id)}
                          >
                            <Icon>
                              <Play size={14} />
                            </Icon>
                            开始
                          </button>
                        )}
                      </div>
                    </div>
                    {expanded && (
                      <div className="lesson-detail">
                        <DetailSection
                          icon={<BookMarked size={14} />}
                          label="核心词汇"
                          insight={insight}
                          emptyText="本课节暂无可派生的词汇数据"
                          render={(d) =>
                            d.vocab.length > 0 ? (
                              <div className="detail-tags">
                                {d.vocab.map((v) => (
                                  <span className="tag-vocab" key={v.word}>
                                    {v.word}
                                  </span>
                                ))}
                              </div>
                            ) : null
                          }
                        />
                        <DetailSection
                          icon={<Quote size={14} />}
                          label="核心短语"
                          insight={insight}
                          emptyText="本课节暂无可派生的短语数据"
                          render={(d) =>
                            d.phrases.length > 0 ? (
                              <div className="detail-tags">
                                {d.phrases.map((p) => (
                                  <span className="tag-phrase" key={p.phrase}>
                                    {p.phrase}
                                  </span>
                                ))}
                              </div>
                            ) : null
                          }
                        />
                        {/* 语法点 / 句子复杂度（任务④）：课节级 AI 分析，LLM 产物落库缓存。
                            免费用户仅第一课节（服务端 /api/lessons/[id]/ai 同口径强校验），
                            其余课节渲染会员锁。逐块校验放行，AI 没产出的块渲染
                            「暂未产出」而不是编造内容（m20696 决议的延续）。 */}
                        <AiSection
                          icon={<FileText size={14} />}
                          label="语法点"
                          locked={!viewer.isPro && lesson.id !== lessons[0]?.id}
                          slot={aiSlots[lesson.id]}
                          render={(d) =>
                            d.grammar && d.grammar.length > 0 ? (
                              <div className="ai-grammar-list">
                                {d.grammar.map((g) => (
                                  <div className="ai-grammar-item" key={g.point}>
                                    <span className="ai-grammar-point">{g.point}</span>
                                    <span className="ai-grammar-explain">{g.explanation}</span>
                                    {g.example ? (
                                      <span className="ai-grammar-example">
                                        {g.example}
                                        {g.exampleZh ? `（${g.exampleZh}）` : ""}
                                      </span>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null
                          }
                        />
                        <AiSection
                          icon={<BarChart3 size={14} />}
                          label="句子复杂度"
                          locked={!viewer.isPro && lesson.id !== lessons[0]?.id}
                          slot={aiSlots[lesson.id]}
                          render={(d) => {
                            const c = d.complexity
                            if (!c) return null
                            const dist = c.distribution
                            const total = dist.easy + dist.medium + dist.hard
                            const pct = (n: number) =>
                              total > 0 ? Math.round((n / total) * 100) : 0
                            return (
                              <div className="ai-complexity">
                                <p className="ai-complexity-summary">{c.summary}</p>
                                <div className="ai-complexity-bars">
                                  <span className="easy" style={{ width: `${pct(dist.easy)}%` }} />
                                  <span className="medium" style={{ width: `${pct(dist.medium)}%` }} />
                                  <span className="hard" style={{ width: `${pct(dist.hard)}%` }} />
                                </div>
                                <p className="complexity-reason">
                                  简单 {dist.easy} 句 · 中等 {dist.medium} 句 · 较难 {dist.hard} 句
                                </p>
                                {c.hardestExample ? (
                                  <p className="ai-complexity-hardest">
                                    最难句：{c.hardestExample}
                                    {c.hardestExampleZh ? `（${c.hardestExampleZh}）` : ""}
                                    {c.hardestReason ? ` —— ${c.hardestReason}` : ""}
                                  </p>
                                ) : null}
                              </div>
                            )
                          }}
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 词汇/短语共用的展开区块：加载中 / 失败 / 空数据 / 有数据四态。
 * 空数据文案必须与「加载失败」区分开——词汇覆盖率 72.5%、chunks 只有 5%，
 * 「这一课真的没有可派生的数据」是常态而不是错误。
 */
function DetailSection({
  icon,
  label,
  insight,
  emptyText,
  render,
}: {
  icon: ReactNode
  label: string
  insight: InsightSlot | undefined
  emptyText: string
  render: (d: InsightData) => ReactNode | null
}) {
  let body: ReactNode
  if (!insight || insight === "loading") {
    body = <span className="complexity-reason">正在分析课节内容…</span>
  } else if (insight === "error") {
    body = <span className="complexity-reason">分析数据加载失败，收起后重新展开可重试</span>
  } else {
    body = render(insight) ?? <span className="complexity-reason">{emptyText}</span>
  }
  return (
    <div className="detail-section">
      <div className="detail-label">
        <Icon>{icon}</Icon>
        {label}
      </div>
      <div className="detail-tags">{body}</div>
    </div>
  )
}

/**
 * 课节 AI 分析区块（语法点/句子复杂度共用）：锁 / 加载中 / 失败 / 数据 / 单块空 五态。
 * locked 优先于一切——免费用户的非第一课节前端根本不发请求；「AI 没产出该块」
 * 与「加载失败」必须区分开：逐块校验放行意味着 null 是真实结果而不是错误。
 */
function AiSection({
  icon,
  label,
  slot,
  locked,
  render,
}: {
  icon: ReactNode
  label: string
  slot: AiSlot | undefined
  locked: boolean
  render: (d: AiInsightData) => ReactNode | null
}) {
  let body: ReactNode
  if (locked) {
    body = (
      <span className="ai-locked">
        免费用户仅可查看第一课节的 AI 分析，
        <Link href="/home/membership">开通会员</Link>解锁全部课节
      </span>
    )
  } else if (!slot || slot === "loading") {
    body = <span className="complexity-reason">AI 正在分析课节内容…</span>
  } else if (slot === "error") {
    body = <span className="complexity-reason">AI 分析加载失败，收起后重新展开可重试</span>
  } else {
    body = render(slot) ?? <span className="complexity-reason">AI 暂未产出该块内容</span>
  }
  return (
    <div className="detail-section">
      <div className="detail-label">
        <Icon>{icon}</Icon>
        {label}
      </div>
      <div className="detail-tags">{body}</div>
    </div>
  )
}
