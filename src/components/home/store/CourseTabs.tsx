"use client"

import { useRef, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { COURSE_CATEGORIES } from "@/types/course"

interface CourseTabsProps {
  activeMainTab: string
  activeSubTab: string | null
  onMainTabChange: (key: string) => void
  onSubTabChange: (key: string | null) => void
}

export function CourseTabs({
  activeMainTab,
  activeSubTab,
  onMainTabChange,
  onSubTabChange,
}: CourseTabsProps) {
  const mainTabsRef = useRef<HTMLDivElement>(null)
  const subTabsRef = useRef<HTMLDivElement>(null)

  const activeCategory = COURSE_CATEGORIES.find((c) => c.key === activeMainTab)
  const showSubTabs = activeCategory && activeCategory.subCategories.length > 0

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
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
