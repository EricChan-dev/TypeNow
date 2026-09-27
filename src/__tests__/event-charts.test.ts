/**
 * ECharts option 构造器（src/lib/admin-chart-options.ts）。
 *
 * 这些构造器的输入全部来自接口，而线上最常见的情况恰恰是**没有数据**
 * （埋点刚接上、某个筛选组合没人命中）。空输入下一个 undefined 就足以让
 * 整个图表白屏，而白屏与"加载失败"在界面上难以区分。所以这里主要盯边界：
 *   - 空数组不抛错，且返回结构完整的 option；
 *   - 该补的刻度要补齐（24 小时分布只拿到 2 个小时的数据时，
 *     必须仍然是 24 根柱子，否则两个孤立的点会被画成相邻小时，属于误导）。
 */
import { describe, it, expect } from "vitest"
import {
  eventRankOption,
  funnelRateOption,
  hourlyOption,
  multiLineOption,
  pageRankOption,
  trendOption,
} from "@/lib/admin-chart-options"

type AnyOption = Record<string, unknown>

function seriesOf(option: unknown): AnyOption[] {
  return ((option as AnyOption).series ?? []) as AnyOption[]
}

describe("trendOption", () => {
  it("空数据不抛错，且 series 里每个事件都有一条空曲线", () => {
    const o = trendOption([], ["page_view", "click"], "day")
    expect(seriesOf(o)).toHaveLength(2)
    expect(seriesOf(o)[0].data).toEqual([])
  })

  it("堆叠：所有系列共用一个 stack，否则总高度没有意义", () => {
    const o = trendOption([{ bucket: "2026-09-01", page_view: 3 }], ["page_view"], "day")
    expect(seriesOf(o)[0].stack).toBe("total")
  })

  it("图例用中文名而不是 event_type 原文", () => {
    const o = trendOption([], ["trial_claimed"], "day")
    expect((o as AnyOption).legend).toMatchObject({ data: ["领取体验会员"] })
    expect(seriesOf(o)[0].name).toBe("领取体验会员")
  })

  it("每个系列按横轴顺序取数，缺失的点补 0 而不是断开", () => {
    const o = trendOption(
      [
        { bucket: "2026-09-01", click: 1 },
        { bucket: "2026-09-02" }, // 这天没有 click
        { bucket: "2026-09-03", click: 5 },
      ],
      ["click"],
      "day",
    )
    expect(seriesOf(o)[0].data).toEqual([1, 0, 5])
  })

  it("横轴刻度取自数据，数量与数据点一致", () => {
    const trend = [{ bucket: "2026-09-01" }, { bucket: "2026-09-02" }]
    const o = trendOption(trend, [], "day")
    expect((o as AnyOption).xAxis).toMatchObject({ data: ["2026-09-01", "2026-09-02"] })
  })

  it("按月聚合的结果不显示缩放条（点数很少，缩放条是干扰）", () => {
    const trend = Array.from({ length: 40 }, (_, i) => ({ bucket: `2026-${i}` }))
    expect((trendOption(trend, [], "month") as AnyOption).dataZoom).toBeUndefined()
  })

  it("按天且超过 30 个点时给出缩放条（90 天挤在一起看不清单日波动）", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ bucket: `d${i}` }))
    expect((trendOption(many, [], "day") as AnyOption).dataZoom).toBeDefined()
    const few = Array.from({ length: 7 }, (_, i) => ({ bucket: `d${i}` }))
    expect((trendOption(few, [], "day") as AnyOption).dataZoom).toBeUndefined()
  })
})

describe("eventRankOption", () => {
  it("空数组不抛错", () => {
    expect(seriesOf(eventRankOption([]))).toHaveLength(2)
  })

  it("同时给出「次数」和「独立用户」两条：只看次数会被少数重度用户带偏", () => {
    const o = eventRankOption([{ eventType: "theme_toggle", events: 133, users: 1 }])
    expect(seriesOf(o).map((s) => s.name)).toEqual(["事件次数", "独立用户"])
    expect(seriesOf(o)[0].data).toEqual([133])
    expect(seriesOf(o)[1].data).toEqual([1])
  })

  it("横向条形图把顺序倒过来，最大的显示在最上面", () => {
    const o = eventRankOption([
      { eventType: "page_view", events: 100, users: 10 },
      { eventType: "click", events: 5, users: 2 },
    ])
    // 倒序后 click 在数组前面 → 画在图的下方；page_view 在最后 → 最上方
    expect((o as AnyOption).yAxis).toMatchObject({ data: ["点击", "页面浏览"] })
  })
})

describe("pageRankOption", () => {
  it("空数组不抛错", () => {
    const o = pageRankOption([])
    expect(seriesOf(o)).toHaveLength(1)
    expect(seriesOf(o)[0].data).toEqual([])
  })

  it("页面路径原样作为 y 轴刻度（不翻译）", () => {
    const o = pageRankOption([{ page: "/home/pricing", count: 9 }])
    expect((o as AnyOption).yAxis).toMatchObject({ data: ["/home/pricing"] })
  })
})

describe("hourlyOption", () => {
  it("空数组仍然给出 24 根柱子（不能因为没数据就把刻度也省掉）", () => {
    const o = hourlyOption([])
    expect((o as AnyOption).xAxis).toMatchObject({ data: expect.any(Array) })
    const labels = ((o as AnyOption).xAxis as AnyOption).data as string[]
    expect(labels).toHaveLength(24)
    expect(labels[0]).toBe("00:00")
    expect(labels[23]).toBe("23:00")
    expect(seriesOf(o)[0].data).toEqual(Array(24).fill(0))
  })

  it("只有零星几个小时有数据时，其余小时补 0（否则两个孤立的点会被画成相邻小时）", () => {
    const o = hourlyOption([
      { hour: 9, count: 4 },
      { hour: 20, count: 7 },
    ])
    const data = seriesOf(o)[0].data as number[]
    expect(data).toHaveLength(24)
    expect(data[9]).toBe(4)
    expect(data[20]).toBe(7)
    // 9 点与 20 点之间的 10 个小时必须是 0，而不是被挤到相邻位置
    expect(data.slice(10, 20)).toEqual(Array(10).fill(0))
    expect(data[0]).toBe(0)
  })

  it("接口返回的顺序被打乱也能对上刻度", () => {
    const o = hourlyOption([
      { hour: 23, count: 1 },
      { hour: 0, count: 2 },
    ])
    const data = seriesOf(o)[0].data as number[]
    expect(data[0]).toBe(2)
    expect(data[23]).toBe(1)
  })
})

describe("funnelRateOption", () => {
  it("空数组不抛错", () => {
    const o = funnelRateOption([])
    expect(seriesOf(o)).toHaveLength(1)
    expect(seriesOf(o)[0].data).toEqual([])
  })

  it("倒序排列，漏斗第一步显示在最上方", () => {
    const o = funnelRateOption([
      { label: "注册", value: 24, stepRate: null },
      { label: "付费", value: 2, stepRate: 0.08 },
    ])
    // 倒序后"付费"在前（画在下方），"注册"在最后（画在最上方）
    expect((o as AnyOption).yAxis).toMatchObject({ data: ["付费", "注册"] })
  })

  it("tooltip 对 stepRate=null 显示破折号而不是 NaN", () => {
    const o = funnelRateOption([{ label: "注册", value: 24, stepRate: null }])
    const formatter = ((o as AnyOption).tooltip as AnyOption).formatter as (
      p: unknown,
    ) => string
    const text = formatter([{ dataIndex: 0 }])
    expect(text).toContain("注册")
    expect(text).toContain("24")
    expect(text).toContain("—")
    expect(text).not.toContain("NaN")
  })
})

describe("multiLineOption", () => {
  const rows = [
    { date: "2026-09-01", newUsers: 3, practice: 10, events: 40 },
    { date: "2026-09-02", newUsers: 1, practice: 0, events: 7 },
  ]

  it("空数据不抛错", () => {
    const o = multiLineOption([], "date", [{ key: "a", label: "A" }])
    expect(seriesOf(o)[0].data).toEqual([])
  })

  it("不堆叠：量纲不同的指标相加没有意义（用户数 + 句数是什么？）", () => {
    const o = multiLineOption(rows, "date", [
      { key: "newUsers", label: "新增用户" },
      { key: "practice", label: "练习句数" },
    ])
    for (const s of seriesOf(o)) expect(s.stack).toBeUndefined()
  })

  it("按 key 取数、按 label 显示，缺字段的补 0", () => {
    const o = multiLineOption(rows, "date", [{ key: "practice", label: "练习句数" }])
    expect(seriesOf(o)[0]).toMatchObject({ name: "练习句数", data: [10, 0] })
    expect((o as AnyOption).legend).toMatchObject({ data: ["练习句数"] })
  })

  it("横轴取 xKey 指定的字段", () => {
    const o = multiLineOption(rows, "date", [])
    expect((o as AnyOption).xAxis).toMatchObject({ data: ["2026-09-01", "2026-09-02"] })
  })

  it("值缺失或为空字符串时按 0 处理，不产生 NaN", () => {
    const o = multiLineOption(
      [{ date: "d1", v: "" }, { date: "d2" }],
      "date",
      [{ key: "v", label: "V" }],
    )
    expect(seriesOf(o)[0].data).toEqual([0, 0])
  })
})
