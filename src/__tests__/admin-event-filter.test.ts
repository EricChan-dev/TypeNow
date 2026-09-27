/**
 * 埋点分析页的钻取链接与筛选构造（src/lib/admin-links.ts、admin-event-filter.ts）。
 *
 * 这两个模块都是"错了也不会报错"的典型：
 *   - 链接参数名写错 → 点过去筛不出东西。而"筛不出东西"在本系统里恰好是
 *     最常见的正常状态（新站点数据少），所以错了没人发现；
 *   - LIKE 不转义 → 搜「100%」匹配到一堆无关记录，界面上看不出原因。
 * 所以这里专门盯住这两类静默错误。
 */
import { describe, it, expect } from "vitest"
import { eventsUrl, eventDetailUrl } from "@/lib/admin-links"
import { MySqlDialect } from "drizzle-orm/mysql-core"
import { escapeLike, parseEventFilter, buildEventWhere } from "@/lib/admin-event-filter"

function params(init: Record<string, string>): URLSearchParams {
  return new URLSearchParams(init)
}

describe("eventsUrl", () => {
  it("没有条件时返回裸路径", () => {
    expect(eventsUrl()).toBe("/admin/events")
    expect(eventsUrl({})).toBe("/admin/events")
  })

  it("空值不写进 query（避免 event=undefined 这种假筛选）", () => {
    const url = eventsUrl({ event: null, range: undefined, q: "", userId: null })
    expect(url).toBe("/admin/events")
    expect(url).not.toContain("undefined")
    expect(url).not.toContain("null")
  })

  it("identity=all 是默认值，不写进链接", () => {
    expect(eventsUrl({ identity: "all" })).toBe("/admin/events")
    expect(eventsUrl({ identity: "anonymous" })).toBe("/admin/events?identity=anonymous")
  })

  it("保留非默认条件并按插入顺序拼接", () => {
    expect(eventsUrl({ event: "click_subscribe", range: "month" })).toBe(
      "/admin/events?event=click_subscribe&range=month",
    )
  })

  it("对特殊字符做 URL 编码，且解析回来等于原值", () => {
    const url = eventsUrl({ q: "支付 成功" })
    // 不比对编码后的字面量：URLSearchParams 把空格编成 "+" 而不是 "%20"，
    // 断言形式会把测试绑死在实现细节上。只要"能解回原值"就够了
    expect(new URLSearchParams(url.split("?")[1]).get("q")).toBe("支付 成功")
    // & 会被编码，否则会把参数切断
    const url2 = eventsUrl({ q: "a&b=c" })
    expect(new URLSearchParams(url2.split("?")[1]).get("q")).toBe("a&b=c")
  })

  it("userId 也支持钻取（从订单跳用户再跳埋点）", () => {
    expect(eventsUrl({ userId: "abc-123" })).toBe("/admin/events?userId=abc-123")
  })
})

describe("eventDetailUrl", () => {
  it("数字与字符串 id 生成同一种链接", () => {
    expect(eventDetailUrl(42)).toBe("/admin/events/42")
    expect(eventDetailUrl("42")).toBe("/admin/events/42")
  })
})

describe("escapeLike", () => {
  it("转义百分号，否则「100%」会变成通配", () => {
    expect(escapeLike("100%")).toBe("100\\%")
  })

  it("转义下划线，否则「a_b」会匹配任意单字符", () => {
    expect(escapeLike("a_b")).toBe("a\\_b")
  })

  it("反斜杠先转义，不会产生双重转义", () => {
    // 输入一个反斜杠 → 输出两个；若顺序写反会得到四个
    expect(escapeLike("a\\b")).toBe("a\\\\b")
  })

  it("普通中文与字母不动", () => {
    expect(escapeLike("定价页 pricing")).toBe("定价页 pricing")
  })
})

describe("parseEventFilter", () => {
  it("缺省：range 回落 week，其余为空", () => {
    const f = parseEventFilter(params({}))
    expect(f.range).toBe("week")
    expect(f.from).not.toBeNull()
    expect(f.event).toBeNull()
    expect(f.category).toBeNull()
    expect(f.identity).toBe("all")
    expect(f.userId).toBeNull()
    expect(f.q).toBeNull()
  })

  it("非白名单事件名被丢弃（不筛，而不是筛出空表）", () => {
    expect(parseEventFilter(params({ event: "click_subscribe" })).event).toBe("click_subscribe")
    expect(parseEventFilter(params({ event: "not_an_event" })).event).toBeNull()
  })

  it("非法 range 回落默认，非法 category / identity 同理", () => {
    expect(parseEventFilter(params({ range: "decade" })).range).toBe("week")
    expect(parseEventFilter(params({ range: "all" })).from).toBeNull()
    expect(parseEventFilter(params({ category: "nope" })).category).toBeNull()
    expect(parseEventFilter(params({ identity: "robot" })).identity).toBe("all")
  })

  it("超长输入被截断（URL 是可控输入，别让它撑爆查询）", () => {
    const f = parseEventFilter(params({ q: "x".repeat(500), userId: "y".repeat(200) }))
    expect(f.q!.length).toBe(100)
    expect(f.userId!.length).toBe(36)
  })

  it("纯空白视为未填", () => {
    expect(parseEventFilter(params({ q: "   " })).q).toBeNull()
    expect(parseEventFilter(params({ pageUrl: "  " })).pageUrl).toBeNull()
  })
})

describe("buildEventWhere", () => {
  // 用 MySQL dialect 把 SQL 对象渲染成真正的 SQL 文本 + 参数。
  // 不拿 SQL 对象做 JSON.stringify 对比：drizzle 的 SQL 对象带循环引用，
  // 序列化会直接抛错；而且比较文本更接近"数据库到底收到什么"
  const dialect = new MySqlDialect()
  const render = (sp: URLSearchParams) => {
    const w = buildEventWhere(parseEventFilter(sp))
    return w ? dialect.sqlToQuery(w) : null
  }

  it("没有任何条件时返回 undefined（drizzle 视为不加 WHERE）", () => {
    expect(buildEventWhere(parseEventFilter(params({ range: "all" })))).toBeUndefined()
    expect(render(params({ range: "all" }))).toBeNull()
  })

  it("指定事件时生成 event_type 条件", () => {
    const q = render(params({ event: "click", range: "all" }))!
    expect(q.sql).toContain("event_type")
    expect(q.params).toContain("click")
  })

  it("只筛选分类时展开成 IN (...) 且只含该分类的事件", () => {
    const q = render(params({ category: "payment", range: "all" }))!
    expect(q.sql).toContain("in")
    // 付费分类下的事件应当都在参数里，学习分类的不该出现
    expect(q.params).toContain("click_subscribe")
    expect(q.params).not.toContain("lesson_start")
  })

  it("具体事件优先于分类（两者矛盾时不制造恒空条件）", () => {
    const both = render(params({ event: "click", category: "payment", range: "all" }))!
    const onlyEvent = render(params({ event: "click", range: "all" }))!
    expect(both.sql).toBe(onlyEvent.sql)
    expect(both.params).toEqual(onlyEvent.params)
  })

  it("userId 优先于 identity（同样不制造恒空条件）", () => {
    const both = render(params({ userId: "u1", identity: "anonymous", range: "all" }))!
    const onlyUser = render(params({ userId: "u1", range: "all" }))!
    expect(both.sql).toBe(onlyUser.sql)
    expect(both.params).toEqual(onlyUser.params)
  })

  it("identity=anonymous 生成 IS NULL，registered 生成 IS NOT NULL", () => {
    expect(render(params({ identity: "anonymous", range: "all" }))!.sql).toContain("is null")
    expect(render(params({ identity: "registered", range: "all" }))!.sql).toContain("is not null")
  })

  it("时间范围会真的进入条件并带上起点参数", () => {
    const q = render(params({ range: "week" }))!
    expect(q.sql).toContain("created_at")
    expect(q.params.length).toBeGreaterThan(0)
    // 参数必须能还原成一个近 7 天的时刻。
    // 容差给到 ±半天：drizzle 把 Date 参数渲染成字符串时用的是 UTC，
    // 而 new Date("YYYY-MM-DD HH:mm:ss") 按本地时区解析，在 UTC+8 上
    // 天然差 8 小时 —— 这不是 bug，别把测试绑死在时区上
    const days = (Date.now() - new Date(q.params[0] as string).getTime()) / 86400000
    expect(days).toBeGreaterThan(6.5)
    expect(days).toBeLessThan(7.5)
  })

  it("近一月比近一周的起点更早（档位真的换算了，不是恒返回同一个值）", () => {
    const week = new Date(render(params({ range: "week" }))!.params[0] as string).getTime()
    const month = new Date(render(params({ range: "month" }))!.params[0] as string).getTime()
    const quarter = new Date(render(params({ range: "quarter" }))!.params[0] as string).getTime()
    expect(month).toBeLessThan(week)
    expect(quarter).toBeLessThan(month)
    // range=all 不加任何条件（render 对 undefined 返回 null）
    expect(render(params({ range: "all" }))).toBeNull()
  })

  it("关键词同时匹配页面、事件名与 properties（JSON 列要 CAST 后比较）", () => {
    const q = render(params({ q: "pricing", range: "all" }))!
    expect(q.sql).toContain("page_url")
    expect(q.sql).toContain("event_type")
    expect(q.sql.toUpperCase()).toContain("CAST")
  })

  it("LIKE 的通配符被转义后再进参数", () => {
    const q = render(params({ q: "100%", range: "all" }))!
    // 三个条件各带一份参数（页面 / 事件名 / properties），都必须是转义后的。
    // 期望值是 "%100\%%"：外层两个 % 是 LIKE 的通配，中间的 \% 是用户输入的
    // 那个百分号被转义后的样子 —— 没转义的话它会变成"匹配任意内容"
    expect(q.params.length).toBe(3)
    for (const p of q.params) expect(p).toBe("%100\\%%")
  })
})
