"use client"

/**
 * 首页「练习趋势」折线图。
 *
 * 为什么不复用 `src/components/admin/EChart.tsx`：
 * 那个封装是后台专用的，`echarts.use()` 里注册了 Bar/Pie/Legend/DataZoom 一大串
 * 后台图表才用得到的东西。首页只需要一条折线，独立注册能把首屏 JS 压到最小 ——
 * 后台是低频页面，首页是每次进站都要下载的路径，两者不该共用一个体积预算。
 *
 * ECharts 初始化配置：
 * 橙色 #f97316 折线、smooth、symbol none、connectNulls、渐变 areaStyle、
 * 1500ms cubicOut 动画、tooltip trigger axis 且 axisPointer 关闭。
 * x 轴固定「星期一…星期日」七天，与后端 `weekly` 序列一一对应。
 *
 * 与后台封装一样用 ResizeObserver 而不是 window.resize：侧边栏折叠时窗口尺寸
 * 不变，只有容器宽度变了，监听 window 图表会按旧宽度绘制（右侧留白）。
 */

import { useEffect, useRef } from "react"
import * as echarts from "echarts/core"
import { LineChart } from "echarts/charts"
import { GridComponent, TooltipComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

/** 星期一…星期日，x 轴七天标签。 */
const WEEKDAY_LABELS = [
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
  "星期日",
]

interface Props {
  /** 最近 7 天，按日期升序；最后一项恒为「今天」（服务端保证上海时区）。 */
  data: { date: string; count: number }[]
  height?: number
}

/** 把服务端日期串取成星期几（上海正午取值，避免 UTC 解析把星期算偏）。 */
function dowLabel(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00+08:00`).getDay()
  // getDay(): 0=周日 … 6=周六；WEEKDAY_LABELS 从周一开始
  return WEEKDAY_LABELS[(dow + 6) % 7]
}

export function PracticeTrendChart({ data, height = 300 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  // 初始化 / 销毁
  useEffect(() => {
    const el = ref.current
    if (!el) return

    // 显式 dispose 旧实例：StrictMode 下会挂载两次，不留残余 canvas。
    chartRef.current?.dispose()
    const chart = echarts.init(el, undefined, { renderer: "canvas" })
    chartRef.current = chart

    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  // 数据更新（不重建实例，保留动画过渡）
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

 // 把服务端的 7 个日期映射成「星期X」，缺的日期补 0。
    // 服务端 weekly 保证是连续 7 天且升序，所以这里直接按序映射即可。
    const labels = data.length === 7 ? data.map((d) => dowLabel(d.date)) : [...WEEKDAY_LABELS]
    const counts = data.length === 7 ? data.map((d) => d.count) : []

    chart.setOption(
      {
        color: ["#f97316"],
        // ECharts 6 起 `grid.containLabel` 已废弃，且**默认不再生效**：只有显式
        // `echarts.use(LegacyGridContainLabel)` 才会走旧行为，否则控制台报
        // "Specified `grid.containLabel` but no `use(LegacyGridContainLabel`)"，
        // 并且轴标签会溢出容器（右侧「星期日」被裁掉）。
        // 官方给出的等价新写法（见 node_modules/echarts/types/dist/echarts.d.ts:2958）：
        //   `containLabel: true` ≡ { outerBoundsMode: "same", outerBoundsContain: "axisLabel" }
        // 这里用新 API，不引 legacy 包（首页体积预算敏感，见文件头说明）。
        grid: {
          left: "0%",
          right: "3%",
          top: "2%",
          bottom: "2%",
          outerBoundsMode: "same",
          outerBoundsContain: "axisLabel",
        },
        tooltip: { trigger: "axis", axisPointer: { type: "none" } },
        xAxis: {
          type: "category",
          data: labels,
          boundaryGap: false,
          axisTick: { lineStyle: { color: "#999" } },
          axisLine: { lineStyle: { color: "#999" } },
          axisLabel: { color: "#999", fontSize: 12 },
        },
        yAxis: { type: "value", show: false },
        series: [
          {
            name: "练习句子数",
            type: "line",
            data: counts,
            smooth: true,
            symbol: "none",
            lineStyle: { color: "#f97316", width: 2 },
            connectNulls: true,
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(249,115,22,0.1)" },
                { offset: 1, color: "rgba(249,115,22,0.01)" },
              ]),
            },
            animationDuration: 1500,
            animationEasing: "cubicOut",
          },
        ],
      },
      { notMerge: true },
    )
  }, [data])

  return <div ref={ref} style={{ width: "100%", height }} />
}
