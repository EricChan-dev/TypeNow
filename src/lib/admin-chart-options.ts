/**
 * 埋点分析页的 ECharts option 构造器。
 *
 * 刻意做成**纯函数**（输入数据、输出 option），不碰 React、不碰 fetch：
 *   - 页面组件因此只负责取数和摆放，不掺图表细节；
 *   - 纯函数能被 vitest 直接测（本项目 vitest 是 node 环境、没有 jsdom，
 *     组件测不了，但这类构造器可以测空数据/边界，见 src/__tests__/event-charts.test.ts）。
 *
 * 所有构造器都必须能接受**空数组**并返回一个合法 option：埋点库刚上线时
 * 每个事件都是 0 条，图表不能白屏或抛错 —— "没有数据"本身就是要展示的信息。
 */

import type { EChartsCoreOption } from "echarts/core"
import { eventLabel } from "@/lib/analytics-events"

/** 图表配色。取自品牌主色 #6366F1 及其邻近色，深浅色模式下都够对比度。 */
const PALETTE = [
  "#6366F1",
  "#22C55E",
  "#F59E0B",
  "#EC4899",
  "#06B6D4",
  "#8B5CF6",
  "#EF4444",
  "#14B8A6",
]

export interface TrendPoint {
  bucket: string
  [eventType: string]: string | number
}

/**
 * 事件趋势（堆叠面积图）。
 *
 * 堆叠而不是并排：要回答的是"总行为量在涨还是跌"，堆叠总高度直接给出答案，
 * 并排的话得自己心算各条之和。
 */
export function trendOption(
  trend: TrendPoint[],
  series: string[],
  granularity: "day" | "month",
): EChartsCoreOption {
  return {
    color: PALETTE,
    tooltip: { trigger: "axis" },
    legend: {
      type: "scroll",
      top: 0,
      // 图例用中文名：event_type 原文（trial_claimed）对运营不可读
      data: series.map(eventLabel),
    },
    grid: { left: 8, right: 16, bottom: 8, top: 40, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trend.map((t) => t.bucket),
      axisLabel: {
        // 按天时分两行显示（09-27），按月的 YYYY-MM 直接显示；
        // 数据点多时自动隔开，避免挤成一团黑
        hideOverlap: true,
      },
    },
    yAxis: { type: "value", minInterval: 1 },
    series: series.map((eventType) => ({
      name: eventLabel(eventType),
      type: "line",
      stack: "total",
      smooth: true,
      showSymbol: false,
      areaStyle: { opacity: 0.25 },
      emphasis: { focus: "series" },
      data: trend.map((t) => Number(t[eventType] ?? 0)),
    })),
    // 按天展示时给一个缩放条：90 天的数据挤在 800px 里看不清单日波动
    dataZoom:
      granularity === "day" && trend.length > 30
        ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 0 }]
        : undefined,
  }
}

export interface EventRankRow {
  eventType: string
  events: number
  users: number
}

/**
 * 事件排行（横向条形图，双系列：次数 vs 独立人数）。
 *
 * 横向而不是纵向：事件名是长中文/英文混合串，纵向柱状图的 x 轴标签会斜排或截断。
 *
 * 为什么两条都要：只看次数会被少数重度用户带偏 ——
 * 「切换主题 133 次、1 个人」和「页面浏览 133 次、40 个人」是完全不同的两件事。
 */
export function eventRankOption(rows: EventRankRow[]): EChartsCoreOption {
  // 横向条形图从下往上画，所以要把顺序倒过来，最大的才在最上面
  const ordered = [...rows].reverse()

  return {
    color: [PALETTE[0], PALETTE[1]],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0 },
    grid: { left: 8, right: 48, bottom: 8, top: 36, containLabel: true },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: {
      type: "category",
      data: ordered.map((r) => eventLabel(r.eventType)),
      axisLabel: { fontSize: 12 },
    },
    series: [
      {
        name: "事件次数",
        type: "bar",
        data: ordered.map((r) => r.events),
        label: { show: true, position: "right" },
      },
      {
        name: "独立用户",
        type: "bar",
        data: ordered.map((r) => r.users),
        label: { show: true, position: "right" },
      },
    ],
  }
}

export interface NamedSeries {
  key: string
  label: string
}

/**
 * 通用多系列折线（不堆叠）。
 *
 * 用于「新增用户 / 练习句数 / 埋点事件」这类量纲不同、不该相加的指标 ——
 * 堆叠起来的总高度没有意义（用户数 + 句数是什么？）。要堆叠的是同一类行为的
 * 不同事件，那是 trendOption 的活。
 */
export function multiLineOption(
  rows: Record<string, string | number>[],
  xKey: string,
  series: NamedSeries[],
  granularity: "day" | "month" = "day",
): EChartsCoreOption {
  return {
    color: PALETTE,
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", top: 0, data: series.map((s) => s.label) },
    grid: { left: 8, right: 16, bottom: 8, top: 40, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((r) => String(r[xKey] ?? "")),
      axisLabel: { hideOverlap: true },
    },
    yAxis: { type: "value", minInterval: 1 },
    series: series.map((s) => ({
      name: s.label,
      type: "line",
      smooth: true,
      showSymbol: false,
      emphasis: { focus: "series" },
      data: rows.map((r) => Number(r[s.key] ?? 0)),
    })),
    dataZoom:
      granularity === "day" && rows.length > 30
        ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 0 }]
        : undefined,
  }
}

export interface PageRankRow {
  page: string
  count: number
  /** 独立用户数。dashboard 的 topPages 只有次数，所以这里可选。 */
  users?: number
}

/** 页面排行。回答"流量落在哪些页面"，是判断入口是否有效的直接依据。 */
export function pageRankOption(rows: PageRankRow[]): EChartsCoreOption {
  const ordered = [...rows].reverse()
  return {
    color: [PALETTE[4]],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 48, bottom: 8, top: 16, containLabel: true },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: { type: "category", data: ordered.map((r) => r.page) },
    series: [
      {
        name: "事件次数",
        type: "bar",
        data: ordered.map((r) => r.count),
        label: { show: true, position: "right" },
      },
    ],
  }
}

export interface HourlyRow {
  hour: number
  count: number
}

/**
 * 24 小时分布。
 *
 * x 轴**必须补齐 0-23 全部小时**：接口只返回有数据的小时，
 * 直接拿返回的数组当刻度的话，"只有 9 点和 20 点有数据"会被画成两根相邻的柱子，
 * 看起来像两个连续小时，完全是误读。
 */
export function hourlyOption(rows: HourlyRow[]): EChartsCoreOption {
  const byHour = new Map(rows.map((r) => [r.hour, r.count]))
  const hours = Array.from({ length: 24 }, (_, h) => h)

  return {
    color: [PALETTE[2]],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 16, bottom: 8, top: 16, containLabel: true },
    xAxis: {
      type: "category",
      data: hours.map((h) => `${String(h).padStart(2, "0")}:00`),
      axisLabel: { interval: 1 },
    },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      {
        name: "事件次数",
        type: "bar",
        data: hours.map((h) => byHour.get(h) ?? 0),
      },
    ],
  }
}

/** 漏斗转化率条形图（横向，显示每步相对上一步的转化）。 */
export function funnelRateOption(
  steps: { label: string; value: number; stepRate: number | null }[],
): EChartsCoreOption {
  const ordered = [...steps].reverse()
  return {
    color: [PALETTE[0]],
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[]
        const i = arr[0]?.dataIndex ?? 0
        const s = ordered[i]
        if (!s) return ""
        const rate = s.stepRate === null ? "—" : `${(s.stepRate * 100).toFixed(1)}%`
        return `${s.label}<br/>人数：${s.value}<br/>较上一步：${rate}`
      },
    },
    grid: { left: 8, right: 48, bottom: 8, top: 16, containLabel: true },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: { type: "category", data: ordered.map((s) => s.label) },
    series: [
      {
        name: "人数",
        type: "bar",
        data: ordered.map((s) => s.value),
        label: { show: true, position: "right" },
      },
    ],
  }
}
