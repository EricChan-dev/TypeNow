"use client"

/**
 * 课程市场详情页（/home/store/[courseId]）—— 复刻句游英语参考站。
 *
 * ── 参考页 ──────────────────────────────────────────────────────────────────
 *
 * `~/Downloads/课本同步详情 - 句游英语.html`（juyouenglish.com 的课程市场
 * /User/TextbookSync 点进某门课的详情页）。页面级样式由
 * `scripts/extract-market-course-css.py` 从 `marketCourseDetail.css` + `common.css`
 * 生成到 `src/app/home/store/market-course-detail.css`，选择器全部收敛在
 * `.course-market-detail` 下；本组件按参考 DOM 结构输出同名类。
 *
 * ── 适配裁定（与我的课程详情页同口径，逐条有因）──────────────────────────────
 *
 * 1. **单 fetch 复用 /api/courses/[id]/detail**：该接口已带每课节句数
 *    （sentenceCount）与 viewer.acquired，正好是本页「N 句」列与按钮态的
 *    两个数据源；总句数 = 各课节句数求和（参考站页头 319 也是 9 课节之和，
 *    同口径）。因此旧的 /api/courses/[id] + /[id]/lessons 两次请求不再使用。
 * 2. **难度标签不渲染**：参考站有 初级/中级/高级 label.level；我们 courses 表
 *    没有难度字段，派生不出真实难度（no-fake-data）。
 * 3. **语法点 / 句子复杂度两节整节省略**：参考站按「有无 AI 分析数据」条件渲染
 *    这两节，没有数据就不出节；我们永无该数据，照参考站的「无数据不出节」
 *    行为省略（不同于我的课程详情页的「暂未生成」占位——那边参考样例本来就渲染）。
 *    核心词汇/核心短语照旧现场派生（/api/lessons/[id]/insight，懒加载）。
 * 4. **paid-course-notice 不搬**：参考站该提示只对付费课程出现；本库没有
 *    「付费课程」概念（所有课都能加入、非会员每课前 5 句试学），无中生有的
 *    付费提示是虚假信息。
 * 5. **needUpgrade 上限弹窗不搬**：参考站免费用户有「可加入课程数上限」，加满
 *    返回 needUpgrade；我们模型里没有这个上限。
 * 6. **移除确认用 window.confirm**：参考站是自制确认弹窗
 *    （customConfirmAsync，「确定要移除此课程吗?」）；本仓没有全局确认组件，
 *    与我的课程详情页同用原生 confirm。
 * 7. **「立即学习」跳 /home/courses/{id}**：参考站跳它自己的「我的课程详情」
 *    （/User/CourseDetail/{id}）；我们的对应页是 /home/courses/[courseId]。
 * 8. **加载更多 = 客户端切片 20/页**：参考站 GetLessonList 服务端分页
 *    pagesize=20；我们 detail 接口一次返回全部课节，前端切片模拟同款
 *    交互（.load-more/.btn-load-more，数据少于等于 20 时不渲染按钮）。
 * 9. **remixicon → lucide**：course-market-detail.css 里的 font-size 规则落在
 *    `i` 元素上，所以 lucide 组件外包一层 `<i style={iconWrap}>`，装饰交给
 *    CSS、图形尺寸由 size 给。字号映射（CSS 原值）：返回箭头 17、面包屑分隔
 *    16、统计图标 18、加入按钮 16、移除按钮 14、目录标题 22、detail-label 14、
 *    展开箭头 18、加载更多 18、toast 图标 36。
 *
 * ── 按钮态的数据源 ──────────────────────────────────────────────────────────
 *
 * 已加入/未加入用 detail 接口的 viewer.acquired（服务端权威行）做初值，加入/
 * 移除成功后就地翻转。**刻意不用 useAcquiredCourses hook**：它的 isAcquired 是
 * 「服务端 ∪ 本地 ∪ 练习过」三源并集，为「我的课程」列表一致性设计——
 * 练过但已移除的课在那里也算「我的」。市场页的加入/移除按钮必须反映服务端
 * 真值，否则会出现「已移除的课仍显示已加入、点移除无效」的死锁。
 * 展开箭头的有无对应参考站 hasEnhancement 门控：参考站有 AI 分析数据才出
 * 箭头，我们词汇/短语总能现场派生，只有 0 句的课节派生不出任何东西，才隐藏。
 */

import { useState, useEffect, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListOrdered,
  PlayCircle,
  Plus,
  Quote,
  Users,
  X,
} from "lucide-react"
import { getCategoryLabel, resolveCourseCover } from "@/lib/course-cover"
import { trackCourseOpen } from "@/lib/analytics"

/** 参考站 GetLessonList 的 pagesize=20，客户端切片沿用同值。 */
const PAGE_SIZE = 20

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

/** 图标包一层 <i>：CSS 的 `i` 规则（颜色/字号）落在包装上，svg 尺寸由 size 给。 */
const iconWrap: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textIndent: 0,
}

function Icon({ children }: { children: ReactNode }) {
  return <i style={iconWrap}>{children}</i>
}

/** 参考站 tag-vocab 标签流：只有词面。词汇已按 word 聚合，可作 key。 */
function renderVocab(d: InsightData): ReactNode | null {
  if (!d.vocab.length) return null
  return (
    <>
      {d.vocab.map((v) => (
        <span key={v.word} className="tag-vocab">
          {v.word}
        </span>
      ))}
    </>
  )
}

function renderPhrases(d: InsightData): ReactNode | null {
  if (!d.phrases.length) return null
  return (
    <>
      {d.phrases.map((p) => (
        <span key={p.phrase} className="tag-phrase">
          {p.phrase}
        </span>
      ))}
    </>
  )
}

/**
 * 词汇/短语共用的展开区块：加载中 / 失败 / 空数据 / 有数据四态。
 * 与我的课程详情页同款：空数据文案必须与「加载失败」区分开——
 * words 覆盖率 72.5%、chunks 只有 5%，「真的没有可派生数据」是常态不是错误。
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

export function CourseDetailClient({ courseId }: { courseId: string }) {
  const router = useRouter()
  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [notFound, setNotFound] = useState(false)
  // 封面兜底：coverUrl 可能是外链或 base64，加载失败退回分类渐变色卡
  const [coverFailed, setCoverFailed] = useState(false)
  // 展开的课节（参考站允许多个同时展开）
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  // 课节学习要点缓存：展开时才拉，拉过就不再拉
  const [insights, setInsights] = useState<Record<string, InsightSlot>>({})
  // 加入态 + 在学人数：初值来自 detail 接口，加入/移除成功后就地翻转
  const [acquired, setAcquired] = useState(false)
  const [learnerCount, setLearnerCount] = useState(0)
  // 加入成功的大 toast 遮罩（参考站 #toastOverlay，不自动消失）
  const [showToast, setShowToast] = useState(false)
  // 加入/移除失败的小 toast（参考站 showToast，3s 自动消失）
  const [notice, setNotice] = useState<string | null>(null)
  // 加载更多的已显示条数
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  // 加入/移除请求进行中：防连点导致 toast 重复弹出、人数重复 ±1
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    // loading 的初值就是 true，不在这里同步 setLoading(true)——
    // react-hooks/set-state-in-effect 禁止 effect 体内同步 setState；
    // 本页面也不存在「同组件内换 courseId」的路径（课→课必经列表页）。
    // 与我的课程详情同一支漏斗事件：点进具体课程代表真实学习意图
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
        if (json) {
          setData(json)
          setAcquired(json.viewer.acquired)
          setLearnerCount(json.course.learnerCount ?? 0)
        } else if (!notFound) {
          setLoadError(true)
        }
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

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(t)
  }, [notice])

  const toggleLesson = (lessonId: string) => {
    const isExpanding = !expandedIds.has(lessonId)

    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(lessonId)) next.delete(lessonId)
      else next.add(lessonId)
      return next
    })

    // 首次展开才请求学习要点。fetch 必须放在 updater 外面——setState 的
    // updater 必须是纯函数，StrictMode 下 updater 会跑两遍，请求就发两次了。
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
  }

  // 参考站 enrollCourse：成功 → toast 遮罩 + 人数 +1 + 按钮翻成「已加入课程库/移除」
  const enroll = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch("/api/user/acquired-courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      })
      if (res.ok) {
        setAcquired(true)
        setLearnerCount((c) => c + 1)
        setShowToast(true)
      } else {
        setNotice("加入失败，请稍后重试")
      }
    } catch {
      setNotice("网络异常，请稍后重试")
    } finally {
      setBusy(false)
    }
  }

  // 参考站 unenrollCourse：确认 → DELETE → 按钮翻回「加入我的课程库」+ 人数 -1，
  // 停留在本页（与参考站一致；「我的课程」列表页才会在移除后跳走）
  const unenroll = async () => {
    // 参考站 customConfirmAsync 的对应物；本仓没有全局确认弹窗组件，用原生 confirm
    if (!window.confirm("确定要移除此课程吗？")) return
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch("/api/user/acquired-courses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      })
      if (res.ok) {
        setAcquired(false)
        setLearnerCount((c) => Math.max(0, c - 1))
      } else {
        window.alert("移除失败，请稍后重试")
      }
    } catch {
      window.alert("操作失败，请稍后重试")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="course-market-detail">
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
      <div className="course-market-detail">
        <div className="maxWidth">
          <div style={{ padding: "80px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
            <p>{notFound ? "课程不存在或已下架" : "加载失败"}</p>
            {notFound ? (
              <Link href="/home/store" style={{ color: "#2C5AF4" }}>
                返回课程广场
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{ color: "#2C5AF4" }}
              >
                点击重试
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 实际不可达（loading 期间上面两个视图已接管）；仅为 tsc 收窄 data
  if (!data) return null

  const course = data.course
  const lessons = data.lessons
  // 总句数 = 各课节句数求和（参考站页头口径：319 = 9 课节之和）
  const totalSentences = lessons.reduce((sum, l) => sum + l.sentenceCount, 0)
  const visibleLessons = lessons.slice(0, visibleCount)
  const hasMore = lessons.length > visibleCount
  const cover = resolveCourseCover(course)
  const categoryLabel = getCategoryLabel(course.categoryKey, course.subCategoryKey)

  return (
    <div className="course-market-detail">
      {notice && (
        // 参考站 showToast 的顶部落位与红/绿配色；本页只有失败分支，固定红色
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            background: "#ef4444",
            color: "#fff",
            fontSize: 14,
            lineHeight: 1.5,
            padding: "10px 18px",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {notice}
        </div>
      )}

      <div className="maxWidth">
        {/* 返回条 + 面包屑：参考站返回箭头与首层面包屑都指向课程市场列表 */}
        <div className="location">
          <Link href="/home/store" className="back" aria-label="返回课程广场">
            <Icon>
              <ChevronLeft size={17} />
            </Icon>
          </Link>
          <nav className="breadcrumb">
            <Link href="/home/store" className="breadcrumb-item">
              课程广场
            </Link>
            <span className="breadcrumb-separator">
              <Icon>
                <ChevronRight size={16} />
              </Icon>
            </span>
            <span className="breadcrumb-current">{course.title}</span>
          </nav>
        </div>

        {/* 课程头：封面 + 标题/统计/简介/加入按钮 */}
        <div className="market-course-header">
          <div className="course-cover">
            {cover.kind === "image" && !coverFailed ? (
              // 本地图片走 next/image；外链与后台传的 base64 dataURL 走裸 img
              //（next/image 对未登记 remotePatterns 的域名会直接抛错）。
              // alt 用空串：标题就在紧邻的右侧，重复朗读对读屏用户是噪音。
              cover.src.startsWith("/") ? (
                <Image
                  src={cover.src}
                  alt=""
                  fill
                  sizes="400px"
                  className="object-cover"
                  onError={() => setCoverFailed(true)}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover.src} alt="" onError={() => setCoverFailed(true)} />
              )
            ) : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 24,
                  textAlign: "center",
                  background: cover.gradient,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.85)",
                    background: "rgba(0,0,0,0.18)",
                    borderRadius: 999,
                    padding: "2px 10px",
                  }}
                >
                  {categoryLabel}
                </span>
                <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>{course.title}</span>
              </div>
            )}
          </div>

          <div className="course-info">
            <h1 className="course-title">{course.title}</h1>

            {/* 统计行：参考站 4 项（难度/在学/课节/句子），难度无数据不渲染。
                图标配色由 CSS 的 .stat-item:nth-child 规则给，元素顺序变了
                配色随之前移——这是 CSS 原样，不是 bug。 */}
            <div className="course-stats">
              <div className="stat-item">
                <Icon>
                  <Users size={18} />
                </Icon>
                <span className="stat-value">{learnerCount}</span>
                <span className="stat-label">人在学</span>
              </div>
              <div className="stat-item">
                <Icon>
                  <BookOpen size={18} />
                </Icon>
                <span className="stat-value">{lessons.length}</span>
                <span className="stat-label">课节</span>
              </div>
              <div className="stat-item">
                <Icon>
                  <FileText size={18} />
                </Icon>
                <span className="stat-value">{totalSentences}</span>
                <span className="stat-label">句子</span>
              </div>
            </div>

            {course.description && <p className="course-subtitle">{course.description}</p>}

            {/* paid-course-notice 不搬：本库没有「付费课程」概念（头注释裁定 4） */}

            <div className="course-actions">
              {!acquired ? (
                <button type="button" className="btn-add-course" onClick={enroll} disabled={busy}>
                  <Icon>
                    <Plus size={16} />
                  </Icon>
                  加入我的课程库
                </button>
              ) : (
                <>
                  <button type="button" className="btn-add-course added">
                    <Icon>
                      <CheckCircle2 size={16} />
                    </Icon>
                    已加入课程库
                  </button>
                  <button
                    type="button"
                    className="btn-add-course remove"
                    onClick={unenroll}
                    disabled={busy}
                  >
                    <Icon>
                      <X size={14} />
                    </Icon>
                    移除
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 课程目录 */}
        <div className="lesson-list-section">
          <div className="section-header">
            <h3>
              <Icon>
                <ListOrdered size={22} />
              </Icon>
              课程目录
            </h3>
            <span className="lesson-count">
              共 {lessons.length} 课节 · {totalSentences} 句子
            </span>
          </div>

          {lessons.length === 0 ? (
            <p style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
              该课程暂无课节
            </p>
          ) : (
            <ul className="lesson-list">
              {visibleLessons.map((lesson) => {
                const expanded = expandedIds.has(lesson.id)
                return (
                  <li key={lesson.id} className={`lesson-item-wrapper${expanded ? " expanded" : ""}`}>
                    <div className="lesson-item" onClick={() => toggleLesson(lesson.id)}>
                      {/* 参考站 renderLessons 的 padStart(2,'0')；用 sortOrder 而不是
                          可见序号，加载更多翻页后编号不跳变 */}
                      <div className="lesson-number">{String(lesson.sortOrder).padStart(2, "0")}</div>
                      <div className="lesson-content">
                        <span className="lesson-title">{lesson.title}</span>
                        {/* 参考站只在描述非空时渲染 p.lesson-description */}
                        {lesson.summary && <p className="lesson-description">{lesson.summary}</p>}
                      </div>
                      <div className="lesson-right">
                        <span className="sentence-count">{lesson.sentenceCount} 句</span>
                        {/* 参考站 hasEnhancement 门控的对应物：0 句的课节派生不出
                            任何要点，没有可展开的内容就不给箭头（头注释裁定说明） */}
                        {lesson.sentenceCount > 0 && (
                          <span className={`lesson-toggle-icon${expanded ? " rotated" : ""}`}>
                            <Icon>
                              <ChevronDown size={18} />
                            </Icon>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 参考站语法点/句子复杂度两节按数据有无渲染，我们永无数据，
                        照参考站行为整节省略（头注释裁定 3） */}
                    {expanded && (
                      <div className="lesson-detail">
                        <DetailSection
                          icon={<BookMarked size={14} />}
                          label="核心词汇"
                          insight={insights[lesson.id]}
                          emptyText="本课暂无可提取的核心词汇"
                          render={renderVocab}
                        />
                        <DetailSection
                          icon={<Quote size={14} />}
                          label="核心短语"
                          insight={insights[lesson.id]}
                          emptyText="本课暂无可提取的核心短语"
                          render={renderPhrases}
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* 参考站 GetLessonList 分页 20/页；我们前端切片，不足一页不出按钮 */}
          {hasMore && (
            <div className="load-more">
              <button
                type="button"
                className="btn-load-more"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                <Icon>
                  <ChevronDown size={18} />
                </Icon>
                加载更多
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 加入成功 toast 遮罩：点遮罩自身关闭，点内容区不关（参考站行为） */}
      {showToast && (
        <div
          className="toast-overlay show"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowToast(false)
          }}
        >
          <div className="toast-content">
            <div className="toast-icon success">
              <Icon>
                <CheckCircle2 size={36} />
              </Icon>
            </div>
            <h4>加入成功！</h4>
            <p>课程已添加到您的学习课程库</p>
            <div className="toast-actions">
              <button
                type="button"
                className="btn-go-study"
                onClick={() => router.push(`/home/courses/${courseId}`)}
              >
                <Icon>
                  <PlayCircle size={18} />
                </Icon>
                立即学习
              </button>
              <button type="button" className="btn-stay" onClick={() => setShowToast(false)}>
                继续浏览
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
