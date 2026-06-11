"use client"

import { useMemo, useRef, useEffect } from "react"
import { animate, stagger } from "animejs"

function toLocalDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function getHeatColor(count: number): string {
  if (count === 0) return "var(--heat-empty)"
  if (count <= 5) return "rgba(124,58,237,0.30)"
  if (count <= 15) return "rgba(124,58,237,0.52)"
  if (count <= 30) return "rgba(139,92,246,0.75)"
  return "rgba(167,139,250,0.95)"
}

export function YearlyHeatmap({ heatmap }: { heatmap: Record<string, number> }) {
  const { weeks, monthLabels } = useMemo(() => {
    const end = new Date()
    const start = new Date(end.getTime() - 364 * 86400000)
    const dow = start.getDay()
    const offset = dow === 0 ? 6 : dow - 1
    start.setDate(start.getDate() - offset)

    const ws: { date: string; count: number }[][] = []
    const labels: { label: string; col: number }[] = []
    let col = 0
    let cur = new Date(start)
    let lastMonth = -1

    while (cur <= end) {
      const week: { date: string; count: number }[] = []
      for (let d = 0; d < 7; d++) {
        const s = toLocalDateStr(cur)
        week.push({ date: s, count: heatmap[s] ?? 0 })
        const m = cur.getMonth()
        if (m !== lastMonth) {
          labels.push({ label: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m], col })
          lastMonth = m
        }
        cur.setDate(cur.getDate() + 1)
      }
      ws.push(week)
      col++
    }
    return { weeks: ws, monthLabels: labels }
  }, [heatmap])

  const cellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!cellRef.current) return
    const cells = cellRef.current.querySelectorAll(".heat-cell-y")
    animate(cells, {
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: 180,
      delay: stagger(3, { start: 0 }),
      ease: "out(2)",
    })
  }, [])

  return (
    <div className="overflow-x-auto scrollbar-none pb-1">
      <div className="min-w-max">
        <div className="flex ml-8 mb-1" style={{ gap: 3 }}>
          {monthLabels.map((ml, i) => (
            <div
              key={i}
              className="text-[10px] text-foreground/25 font-mono"
              style={{ width: 13, marginLeft: i === 0 ? ml.col * 16 : (ml.col - (monthLabels[i - 1]?.col ?? 0) - 1) * 16 }}
            >
              {ml.label}
            </div>
          ))}
        </div>
        <div className="flex" style={{ gap: 3 }}>
          <div className="flex flex-col justify-between py-0.5 mr-1" style={{ gap: 3 }}>
            {["M", "", "W", "", "F", "", ""].map((l, i) => (
              <div key={i} className="text-[9px] text-foreground/20 font-mono w-5 text-right leading-none" style={{ height: 13 }}>
                {l}
              </div>
            ))}
          </div>
          <div ref={cellRef} className="flex" style={{ gap: 3 }}>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: 3 }}>
                {week.map((cell) => (
                  <div
                    key={cell.date}
                    className="heat-cell-y rounded-[3px] cursor-default"
                    style={{ width: 13, height: 13, background: getHeatColor(cell.count) }}
                    title={`${cell.date}: ${cell.count} 句`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-3 justify-end">
          <span className="text-[10px] text-foreground/20">少</span>
          {[0, 5, 15, 30, 45].map((v) => (
            <div key={v} className="w-3 h-3 rounded-sm" style={{ background: getHeatColor(v) }} />
          ))}
          <span className="text-[10px] text-foreground/20">多</span>
        </div>
      </div>
    </div>
  )
}
