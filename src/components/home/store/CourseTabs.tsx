"use client"

import { useRef } from "react"
import { cn } from "@/lib/utils"
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
 */
function CountBadge({ count, active }: { count: number | undefined; active: boolean }) {
  if (count === undefined) return null
  return (
    <span
      className={cn(
        "ml-1.5 tabular-nums text-[10px] font-normal",
        active ? "text-accent/70" : "text-muted-foreground/60"
      )}
    >
      {count}
    </span>
  )
}

export function CourseTabs({
  activeMainTab,
  activeSubTab,
  onMainTabChange,
  onSubTabChange,
  facets,
}: CourseTabsProps) {
  const mainTabsRef = useRef<HTMLDivElement>(null)
  const subTabsRef = useRef<HTMLDivElement>(null)

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
    <div className="mb-6">
      {/* Main tabs */}
      <div
        ref={mainTabsRef}
        className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-none"
      >
        {COURSE_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => handleMainTabChange(cat.key)}
            className={cn(
              "shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              activeMainTab === cat.key
                ? "bg-accent/15 text-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {cat.label}
            <CountBadge count={countOf(mainCounts, cat.key)} active={activeMainTab === cat.key} />
          </button>
        ))}
      </div>

      {/* Sub tabs */}
      {showSubTabs && (
        <div
          ref={subTabsRef}
          className="flex items-center gap-1 overflow-x-auto pt-3 mt-1 border-t border-border/50 scrollbar-none"
        >
          <button
            onClick={() => onSubTabChange(null)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              activeSubTab === null
                ? "bg-accent/15 text-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            全部
            <CountBadge
              count={countOf(mainCounts, activeCategory!.key)}
              active={activeSubTab === null}
            />
          </button>
          {activeCategory!.subCategories.map((sub) => (
            <button
              key={sub.key}
              onClick={() => onSubTabChange(sub.key)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                activeSubTab === sub.key
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {sub.label}
              <CountBadge
                count={countOf(subCounts, `${activeCategory!.key}/${sub.key}`)}
                active={activeSubTab === sub.key}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
