"use client"

import { Clock, ChevronRight } from "lucide-react"
import Link from "next/link"

export function ReviewReminder() {
  // Mock data - will be replaced with real data from Supabase
  const reviewItems = [
    { id: "1", chinese: "我喜欢在周末去公园散步", interval: "1天前" },
    { id: "2", chinese: "她正在准备明天的面试", interval: "3天前" },
    { id: "3", chinese: "这本书我已经看过三遍了", interval: "7天前" },
  ]

  if (reviewItems.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          复习提醒
        </h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          暂无待复习内容，去练习吧！
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          复习提醒
        </h3>
        <span className="inline-flex items-center justify-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          {reviewItems.length} 项待复习
        </span>
      </div>
      <div className="space-y-2">
        {reviewItems.map((item) => (
          <Link
            key={item.id}
            href="/practice?mode=review"
            className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors group"
          >
            <div className="min-w-0">
              <p className="text-sm truncate">{item.chinese}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {item.interval}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4 text-center">
        基于艾宾浩斯遗忘曲线
      </p>
    </div>
  )
}
