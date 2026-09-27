/**
 * 后台「指标 → 列表」钻取链接（src/lib/admin-links.ts 的 listUrl）与
 * 条件提示（src/lib/admin-drilldown.ts）。
 *
 * 这里盯的是一个**跨库契约**：listUrl 发出的 URL 必须能被 refine 的
 * useTable 解析回 filters。
 *
 * 为什么非测不可：目标页用的是 refine 的 useTable + syncWithLocation，
 * 它只认自己那套 `filters[N][field]` 序列化。如果 linkUrl 用我们自己发明的
 * `?range=week`，refine 会在首次渲染时把 URL **重写成自己认识的样子**——
 * 也就是把 range 丢掉，钻取在落地那一刻就失效。而失效的表现是"列表里条数
 * 比仪表盘的数字多"，很容易被当成"报表算错了"，最难查的一类问题。
 *
 * 所以直接拿 refine 自己的解析器 `parseTableParams` 来验证往返一致：
 * 库升级改掉了格式，这个测试会立刻红，而不是等线上有人发现数字对不上。
 */
import { describe, it, expect } from "vitest"
import { parseTableParams } from "@refinedev/core"
import { eventsUrl, eventDetailUrl, listUrl } from "@/lib/admin-links"
import { drilldownBadges, withFilter, withoutDrilldown, isDrilldownFilter } from "@/lib/admin-drilldown"

/** 用 refine 的真实解析器把 URL 还原成它内部会用的 filters。 */
function refineFiltersOf(url: string) {
  const qsPart = url.includes("?") ? url.slice(url.indexOf("?")) : "?"
  return parseTableParams(qsPart).parsedFilters as Array<{
    field: string
    operator: string
    value: unknown
  }>
}

describe("listUrl 与 refine 的 URL 契约", () => {
  it("空条件返回裸路径", () => {
    expect(listUrl("/admin/users")).toBe("/admin/users")
    expect(listUrl("/admin/users", [])).toBe("/admin/users")
    expect(listUrl("/admin/users", [{ field: "range", value: null }])).toBe("/admin/users")
  })

  it("单个条件能被 refine 解析回同名的 field/value", () => {
    const url = listUrl("/admin/users", [{ field: "range", value: "week" }])
    expect(refineFiltersOf(url)).toEqual([
      { field: "range", operator: "eq", value: "week" },
    ])
  })

  it("多个条件的顺序与数量都能被 refine 还原", () => {
    const url = listUrl("/admin/users", [
      { field: "range", value: "month" },
      { field: "active", value: 1 },
    ])
    expect(refineFiltersOf(url)).toEqual([
      { field: "range", operator: "eq", value: "month" },
      { field: "active", operator: "eq", value: "1" },
    ])
  })

  it("refine 从 URL 解析出的 value **一律是字符串**", () => {
    // 这一点很关键：界面侧（drilldownBadges）必须按字符串比较 "1"，
    // 写成 `value === 1`（数字）会永远不成立，表现为提示条对布尔条件
    // 显示成「非活跃」或干脆不显示 —— 不报错，只是说错话
    const parsed = refineFiltersOf(listUrl("/admin/users", [{ field: "active", value: 1 }]))
    expect(parsed[0].value).toBe("1")
    expect(typeof parsed[0].value).toBe("string")
  })

  it("跳过空值但**不跳号**（跳号会让 refine 解析出 undefined 项）", () => {
    const url = listUrl("/admin/payments", [
      { field: "range", value: "week" },
      { field: "status", value: null },
      { field: "q", value: "abc" },
    ])
    const parsed = refineFiltersOf(url)
    expect(parsed).toHaveLength(2)
    expect(parsed.map((f) => f.field)).toEqual(["range", "q"])
    // 不能出现 field 为 undefined 的"空洞"
    expect(parsed.every((f) => typeof f.field === "string")).toBe(true)
  })

  it("布尔类条件写成 1 而不是 true（接口按 \"1\" 判断）", () => {
    const url = listUrl("/admin/users", [{ field: "trial", value: 1 }])
    expect(refineFiltersOf(url)).toEqual([{ field: "trial", operator: "eq", value: "1" }])
    // 不能写成 true：接口侧只认 "1"，写成 true 会静默筛不出东西
    expect(url).not.toContain("value=true")
  })

  it("每个钻取条件都带 operator（refine 缺这个键会解析不出这条 filter）", () => {
    const url = listUrl("/admin/users", [{ field: "active", value: 1 }])
    expect(url).toContain("filters%5B0%5D%5Boperator%5D=eq")
    expect(refineFiltersOf(url)[0].operator).toBe("eq")
  })

  it("仪表盘要用到的每一个钻取链接都能被 refine 解析", () => {
    // 与 src/app/admin/page.tsx 里的链接一一对应，改动那边时这里会失效
    const links: Array<[string, Parameters<typeof listUrl>[1]]> = [
      ["/admin/users", [{ field: "range", value: "week" }]],
      ["/admin/users", [{ field: "range", value: "week" }, { field: "active", value: 1 }]],
      ["/admin/users", [{ field: "range", value: "week" }, { field: "trial", value: 1 }]],
      ["/admin/practice", [{ field: "range", value: "week" }]],
      ["/admin/payments", [{ field: "range", value: "week" }, { field: "status", value: "paid" }]],
      ["/admin/subscriptions", [{ field: "status", value: "active" }]],
    ]
    for (const [path, filters] of links) {
      const parsed = refineFiltersOf(listUrl(path, filters))
      expect(parsed.length, `${path} 的钻取条件丢失`).toBe(filters!.length)
      for (const f of filters!) {
        expect(parsed.some((p) => p.field === f.field && String(p.value) === String(f.value))).toBe(
          true,
        )
      }
    }
  })
})

describe("eventsUrl 与 listUrl 互不干扰", () => {
  it("eventsUrl 仍用扁平参数（埋点分析页自己读 URL，不经 refine）", () => {
    expect(eventsUrl({ event: "click", range: "week" })).toBe(
      "/admin/events?event=click&range=week",
    )
  })

  it("eventDetailUrl 指向详情页", () => {
    expect(eventDetailUrl(12)).toBe("/admin/events/12")
  })
})

describe("drilldownBadges", () => {
  it("没有 filters 或没有钻取字段时返回空（调用方据此隐藏提示条）", () => {
    expect(drilldownBadges(undefined)).toEqual([])
    expect(drilldownBadges([])).toEqual([])
    expect(
      drilldownBadges([{ field: "q", operator: "eq", value: "abc" }]),
    ).toEqual([])
  })

  it("把 range 翻译成中文档位名", () => {
    const badges = drilldownBadges([{ field: "range", operator: "eq", value: "month" }])
    expect(badges).toEqual([{ field: "range", label: "时间：近一月" }])
  })

  it("布尔类给整句话，而不是「活跃：活跃」这种拼接", () => {
    expect(drilldownBadges([{ field: "active", operator: "eq", value: "1" }])[0].label).toBe(
      "仅这段时间练过的用户",
    )
    expect(drilldownBadges([{ field: "trial", operator: "eq", value: "1" }])[0].label).toBe(
      "仅这段时间领取过体验会员的用户",
    )
    // 值必须是字符串 "1"（refine 从 URL 解析出来的就是字符串）
    expect(drilldownBadges([{ field: "active", operator: "eq", value: "true" }])[0].label).toBe(
      "仅这段时间练过的用户",
    )
  })

  it("状态值翻译成中文", () => {
    expect(drilldownBadges([{ field: "status", operator: "eq", value: "paid" }])[0].label).toBe(
      "状态：已支付",
    )
    expect(drilldownBadges([{ field: "status", operator: "eq", value: "active" }])[0].label).toBe(
      "状态：生效中",
    )
  })

  it("未知值原样显示（能看出「这个参数不是我发的」，而不是悄悄消失）", () => {
    expect(drilldownBadges([{ field: "status", operator: "eq", value: "weird" }])[0].label).toBe(
      "状态：weird",
    )
    expect(drilldownBadges([{ field: "range", operator: "eq", value: "decade" }])[0].label).toBe(
      "时间：decade",
    )
  })

  it("搜索词不产生提示条（q 不属于钻取字段）", () => {
    const filters = [
      { field: "range", operator: "eq" as const, value: "week" },
      { field: "q", operator: "eq" as const, value: "abc" },
    ]
    expect(drilldownBadges(filters).map((b) => b.field)).toEqual(["range"])
  })
})

describe("isDrilldownFilter / withoutDrilldown", () => {
  const filters = [
    { field: "range", operator: "eq" as const, value: "week" },
    { field: "active", operator: "eq" as const, value: "1" },
    { field: "q", operator: "eq" as const, value: "abc" },
  ]

  it("只认钻取字段", () => {
    expect(isDrilldownFilter(filters[0])).toBe(true)
    expect(isDrilldownFilter(filters[2])).toBe(false)
  })

  it("清空钻取条件时保留搜索词（否则使用者正在搜的东西会被一起清掉）", () => {
    expect(withoutDrilldown(filters)).toEqual([{ field: "q", operator: "eq", value: "abc" }])
  })

  it("undefined 不抛错", () => {
    expect(withoutDrilldown(undefined)).toEqual([])
  })
})

describe("withFilter", () => {
  const filters = [
    { field: "range", operator: "eq" as const, value: "week" },
    { field: "active", operator: "eq" as const, value: "1" },
    { field: "q", operator: "eq" as const, value: "old" },
  ]

  it("替换同名字段而不是追加（追加会让旧关键词继续生效，搜索结果莫名其妙）", () => {
    const next = withFilter(filters, "q", "new")
    expect(next.filter((f) => "field" in f && f.field === "q")).toHaveLength(1)
    expect(next).toContainEqual({ field: "q", operator: "eq", value: "new" })
  })

  it("保留钻取条件（搜索时不能把时间范围丢掉）", () => {
    const next = withFilter(filters, "q", "new")
    expect(next.some((f) => "field" in f && f.field === "range")).toBe(true)
    expect(next.some((f) => "field" in f && f.field === "active")).toBe(true)
  })

  it("传空字符串表示取消这个条件，而不是筛空串", () => {
    const next = withFilter(filters, "q", "")
    expect(next.some((f) => "field" in f && f.field === "q")).toBe(false)
    expect(next).toHaveLength(2)
  })

  it("原本没有该字段时追加", () => {
    const next = withFilter([{ field: "range", operator: "eq", value: "week" }], "q", "x")
    expect(next).toHaveLength(2)
  })
})
