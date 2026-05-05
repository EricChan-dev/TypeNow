"use client"

import { BarChart3 } from "lucide-react"

export function WeeklyStats() {
  // Mock data - will be replaced with real data from Supabase
  const weekDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
  const practiceData = [5, 12, 0, 8, 15, 3, 0]

  const maxValue = Math.max(...practiceData)

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          本周统计
        </h3>
        <span className="text-xs text-muted-foreground">
          共 {practiceData.reduce((a, b) => a + b, 0)} 句
        </span>
      </div>

      <div className="flex items-end justify-between gap-2 h-32">
        {weekDays.map((day, i) => (
          <div key={day} className="flex flex-col items-center gap-1.5 flex-1">
            <span className="text-xs font-medium text-foreground">
              {practiceData[i]}
            </span>
            <div
              className="w-full rounded-t-md transition-all"
              style={{
                height: `${maxValue > 0 ? (practiceData[i] / maxValue) * 80 : 0}%`,
                backgroundColor: practiceData[i] > 0 ? "#6366F1" : "#334155",
                minHeight: "4px",
              }}
            />
            <span className="text-[10px] text-muted-foreground">{day}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
