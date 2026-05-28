"use client"

import { useState, useEffect } from "react"
import { Clock, ChevronRight } from "lucide-react"
import Link from "next/link"

export function ReviewReminder() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    fetch("/api/review/queue")
      .then((r) => r.json())
      .then((json) => { if (typeof json.total === "number") setCount(json.total) })
      .catch(() => {})
  }, [])

  if (count === null || count === 0) return null

  return (
    <Link
      href="/home/review"
      className="flex items-center justify-between rounded-xl border px-4 py-3 transition-colors hover:bg-foreground/[0.04]"
      style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}
    >
      <div className="flex items-center gap-2.5">
        <Clock className="h-4 w-4 text-amber-400" />
        <div>
          <p className="text-sm font-medium text-foreground/80">待复习</p>
          <p className="text-[11px] text-foreground/40 mt-0.5">基于艾宾浩斯遗忘曲线</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
          {count} 项
        </span>
        <ChevronRight className="h-4 w-4 text-foreground/30" />
      </div>
    </Link>
  )
}
