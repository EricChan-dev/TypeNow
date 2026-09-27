"use client"

/**
 * ECharts 通用封装（后台图表专用）。
 *
 * 为什么不用 echarts 的全量入口 `import * as echarts from "echarts"`：
 * 全量包 gzip 后接近 1MB，而后台只用了折线/柱状/饼图三种图。
 * 从 echarts/core 按需注册能把体积压到十几分之一 —— 后台用户多在移动网络
 * 或临时排查时打开，首屏多等 1MB 是很明显的体感差异。
 *
 * 为什么自己写而不装 @ant-design/plots：那个库本身就依赖全量 echarts，
 * 换不来体积收益，还多一层 API。这里只有 ~70 行。
 *
 * 主题：后台支持深浅色切换（next-themes）。echarts 的暗色主题只能在
 * init 时指定，运行时切换必须 dispose 重建，所以把 theme 放进 deps 依赖里。
 * 不这么做的话，切到浅色后图表文字仍是白色，在白底上完全看不见 ——
 * 这是最容易被忽略、又最影响可用性的一类回归。
 */

import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import * as echarts from "echarts/core"
import { BarChart, LineChart, PieChart } from "echarts/charts"
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import type { EChartsCoreOption } from "echarts/core"

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  CanvasRenderer,
])

interface Props {
  option: EChartsCoreOption
  /** 图表高度。给默认值时别用百分比 —— 容器高度为 auto 时百分比会算成 0。 */
  height?: number
  loading?: boolean
  /** 数据为空时显示的占位，避免"图表一片空白"被误读成加载失败。 */
  empty?: boolean
  emptyText?: string
}

export default function EChart({
  option,
  height = 280,
  loading = false,
  empty = false,
  emptyText = "暂无数据",
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"

  // 初始化与主题重建
  useEffect(() => {
    const el = ref.current
    if (!el || empty) return

    // echarts 6 的 init 在元素已有实例时会告警并复用，不会重复创建 canvas；
    // 显式 dispose 旧实例是为了换主题，否则暗色主题会一直留着
    chartRef.current?.dispose()
    const chart = echarts.init(el, dark ? "dark" : undefined, { renderer: "canvas" })
    chartRef.current = chart

    // ResizeObserver 而不是 window.resize：后台侧边栏折叠时窗口尺寸没变，
    // 只有容器宽度变了，监听 window 的话图表会一直按旧宽度绘制（右侧空白）
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [dark, empty])

  // 数据更新（不重建实例，保留动画过渡）
  useEffect(() => {
    if (empty) return
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option, empty])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (loading) {
      chart.showLoading("default", {
        text: "加载中",
        color: "#6366F1",
        textColor: dark ? "#e5e7eb" : "#374151",
        maskColor: dark ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.7)",
      })
    } else {
      chart.hideLoading()
    }
  }, [loading, dark])

  if (empty) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(128,128,128,0.85)",
          fontSize: 13,
        }}
      >
        {emptyText}
      </div>
    )
  }

  return <div ref={ref} style={{ width: "100%", height }} />
}
