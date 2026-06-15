"use client"

import { useState, useRef, useEffect } from "react"
import { Search, ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { SORT_OPTIONS, type SortMode } from "@/types/course"

interface SearchAndSortBarProps {
  searchQuery: string
  onSearchChange: (v: string) => void
  sortMode: SortMode
  onSortChange: (v: SortMode) => void
  courseCount: number
}

export function SearchAndSortBar({
  searchQuery,
  onSearchChange,
  sortMode,
  onSortChange,
  courseCount,
}: SearchAndSortBarProps) {
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const currentLabel = SORT_OPTIONS.find((o) => o.key === sortMode)?.label || "最新发布"

  return (
    <div className="flex flex-wrap items-center gap-3 mb-5">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索课程..."
          className="w-full h-10 rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent/50 transition-colors"
        />
      </div>

      {/* Sort dropdown */}
      <div className="relative" ref={sortRef}>
        <button
          onClick={() => setSortOpen(!sortOpen)}
          className="flex items-center gap-1.5 h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground hover:bg-muted transition-colors"
        >
          {currentLabel}
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", sortOpen && "rotate-180")} />
        </button>

        {sortOpen && (
          <div className="absolute right-0 top-full mt-1 rounded-xl border border-border bg-card shadow-xl z-50 py-1 min-w-[140px]">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => { onSortChange(option.key); setSortOpen(false) }}
                className={cn(
                  "flex items-center justify-between w-full px-4 py-2 text-sm transition-colors",
                  option.key === sortMode ? "text-accent bg-accent/5" : "text-foreground hover:bg-muted"
                )}
              >
                {option.label}
                {option.key === sortMode && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Course count */}
      <div className="flex items-center gap-3 ml-auto">
        <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
          共 <span className="text-foreground font-medium">{courseCount + 500}</span> 门
        </span>
      </div>
    </div>
  )
}
