"use client"

import { useRef } from "react"
import { COURSE_CATEGORIES } from "@/types/course"
import type { StoreFacets } from "@/lib/store-facets"

interface CourseTabsProps {
  activeMainTab: string
  activeSubTab: string | null
  onMainTabChange: (key: string) => void
  onSubTabChange: (key: string | null) => void
  /**
   * 各分类 / 子分类的课程数。null = 还没取到（或接口失败）。
   *
   * 取不到时标签照常显示、只是没有角标 —— 计数是辅助信息，
   * 不能让它的加载失败影响「筛选」这个主功能。
   */
  facets: StoreFacets | null
}

/**
 * 数量角标。
 *
 * 刻意比标签小一号、颜色更淡：用户扫这一行是在找「我要哪一类」，
 * 数字只用来判断这类值不值得点进去，不该和标签抢注意力。
 * 用 `currentColor` 的透明度而不是写死颜色 —— 选中态是黑底/蓝底，
 * 写死的灰在黑底上会糊成一片。
 */
function CountBadge({ count }: { count: number | undefined }) {
  if (count === undefined) return null
  // 用 <b> 而不是 <span>：生成的 `.courseTab span`（子标签行容器）是后代选择器，
  // 会把 display:block + margin-top:16px 套到角标上，逼它换行并撑高整行。
  // 样式统一由 .course-count 提供（见 scripts/extract-store-market-css.py 的 SHELL），
  // 不在这里用 Tailwind 工具类 —— 生成的 CSS 是未分层的，优先级高于 @layer utilities，
  // `ml-1` 这类简写冲突会被静默覆盖，看起来生效实则没有。
  return <b className="course-count">{count}</b>
}

/**
 * 点击 + 键盘的回调。这两排标签是 `label`/`em` 加 onclick，本身不可聚焦；
 * 这里补上 `role="button"` + `tabIndex` + Enter/Space，键盘用户才点得到。
 */
function tapHandlers(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onActivate()
      }
    },
  }
}

/**
 * 两级筛选标签 —— 课程市场的 `.courseTab`。
 *
 * 元素名不能改（主标签 `<label>`、子标签 `<em>`）：生成器把
 * 样式选择器逐字收进本页作用域，`.courseTab p label.on`（黑底白字）
 * 与 `.courseTab span em.on`（#2C5AF4 蓝底白字）都是**按元素名**匹配的 ——
 * 换成 `<button>` 会让这套样式整块失效。
 * 与 TextbookSyncClient 对 `textbook-grades-tab label` 的处理同口径。
 */
export function CourseTabs({
  activeMainTab,
  activeSubTab,
  onMainTabChange,
  onSubTabChange,
  facets,
}: CourseTabsProps) {
  const mainTabsRef = useRef<HTMLParagraphElement>(null)
  const subTabsRef = useRef<HTMLSpanElement>(null)

  const activeCategory = COURSE_CATEGORIES.find((c) => c.key === activeMainTab)
  const showSubTabs = activeCategory && activeCategory.subCategories.length > 0

  // facets.categories 不含 key="all"，单独给「全部课程」取 total ——
  // all 的角标就是这个筛选面下的总数，不另外查一次。
  const mainCounts = new Map<string, number>([["all", facets?.total ?? NaN]])
  const subCounts = new Map<string, number>()
  for (const cat of facets?.categories ?? []) {
    mainCounts.set(cat.key, cat.count)
    for (const sub of cat.subCategories) subCounts.set(`${cat.key}/${sub.key}`, sub.count)
  }
  const countOf = (m: Map<string, number>, key: string) => {
    const n = m.get(key)
    return n === undefined || Number.isNaN(n) ? undefined : n
  }

  // Reset sub-tab when main tab changes
  const handleMainTabChange = (key: string) => {
    onMainTabChange(key)
    onSubTabChange(null)
  }

  return (
    <div className="fixedTab">
      <div className="courseTab">
        <div className="Tab">
 {/* 主标签：<p> 里一排 <label>。
              横向滚动的容器属性由生成的 @media (max-width: 900px) 提供，
              这里不放 Tailwind 工具类 —— 桌面上不该有滚动容器，而
              `overflow-x: auto` 会把 overflow-y 也算成 auto，凭空造出裁剪上下文。 */}
          <p ref={mainTabsRef}>
            {COURSE_CATEGORIES.map((cat) => (
              <label
                key={cat.key}
                {...tapHandlers(() => handleMainTabChange(cat.key))}
                className={activeMainTab === cat.key ? "on" : undefined}
              >
                {cat.label}
                <CountBadge count={countOf(mainCounts, cat.key)} />
              </label>
            ))}
          </p>

 {/* 子标签：<span> 里一排小胶囊 <em> */}
          {showSubTabs && (
            <span ref={subTabsRef}>
              <em
                {...tapHandlers(() => onSubTabChange(null))}
                className={activeSubTab === null ? "on" : undefined}
              >
                全部
                <CountBadge count={countOf(mainCounts, activeCategory!.key)} />
              </em>
              {activeCategory!.subCategories.map((sub) => (
                <em
                  key={sub.key}
                  {...tapHandlers(() => onSubTabChange(sub.key))}
                  className={activeSubTab === sub.key ? "on" : undefined}
                >
                  {sub.label}
                  <CountBadge count={countOf(subCounts, `${activeCategory!.key}/${sub.key}`)} />
                </em>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
