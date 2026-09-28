/**
 * 链路：埋点分析（明细 / 图表数据 / 单条详情）
 *
 * 这个文件盯住三件容易静默出错的事：
 *
 * 1. **表格与图表必须同源**。两者共用 src/lib/admin-event-filter 的条件构造，
 *    如果哪天有人改动其中一边、忘了另一边，图表和明细就会对不上，
 *    而使用者只会以为"埋点丢了"。所以这里对同一组参数断言两边数字相等。
 * 2. **匿名事件不能被 JOIN 丢掉**。明细表 LEFT JOIN users 取用户名，
 *    一旦写成 INNER JOIN，未登录流量会整体消失 —— 而它正是漏斗的第一段。
 * 3. **钻取链路要能走通**。详情页要能按 user_id 找到同一用户的前后事件，
 *    否则"从指标钻到具体记录"只是一句口号。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q } from "./helpers/db"
import { insertUser } from "./helpers/factories"

/** 造一个管理员账号（requireAdmin 认 role='admin'）。 */
async function makeAdmin(): Promise<string> {
  const id = await insertUser({ name: "e2e 埋点管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

/** 直接插一条埋点记录，返回自增 id。 */
async function insertEvent(opts: {
  eventType: string
  userId?: string | null
  pageUrl?: string | null
  sessionId?: string | null
  visitorId?: string | null
  properties?: Record<string, unknown>
}): Promise<number> {
  const res = await q(
    `INSERT INTO analytics_events (event_type, user_id, properties, page_url, session_id, visitor_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      opts.eventType,
      opts.userId ?? null,
      JSON.stringify(opts.properties ?? {}),
      opts.pageUrl ?? null,
      opts.sessionId ?? null,
      opts.visitorId ?? null,
    ],
  )
  return Number((res as unknown as { insertId: number }).insertId)
}

interface EventsList {
  data: Array<{
    id: string
    eventType: string
    userId: string | null
    visitorId: string | null
    userName: string | null
    userPhone: string | null
    pageUrl: string | null
    properties: Record<string, unknown> | null
    createdAt: string
  }>
  total: number
}

interface StatsResponse {
  range: string
  granularity: "day" | "month"
  summary: {
    events: number
    users: number
    sessions: number
    visitors: number
    anonymous: number
    anonymousRate: number | null
  }
  series: string[]
  trend: Array<Record<string, string | number>>
  byEvent: Array<{ eventType: string; events: number; users: number; lastAt: string | null }>
  pages: Array<{ page: string; count: number; users: number }>
  hourly: Array<{ hour: number; count: number }>
}

beforeEach(async () => {
  await seedFixtures()
})

describe("埋点明细 /api/admin/events", () => {
  it("未登录 → 401；非管理员 → 401", async () => {
    const anon = await ApiClient.anonymous().get("/api/admin/events")
    expect(anon.status).toBe(401)

    const nonAdmin = await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/events")
    expect(nonAdmin.status).toBe(401)
  })

  it("管理员可读，且返回 refine 的列表契约 { data, total }", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({ eventType: "page_view", pageUrl: "/home" })

    const res = await admin.get<EventsList>("/api/admin/events?range=all")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(typeof res.body.total).toBe("number")
    expect(res.body.total).toBeGreaterThanOrEqual(1)
  })

  it("按事件类型筛选，只返回该事件", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({ eventType: "click_subscribe", userId: FIXTURE.userFree })
    await insertEvent({ eventType: "theme_toggle", userId: FIXTURE.userFree })

    const res = await admin.get<EventsList>("/api/admin/events?range=all&event=click_subscribe")
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.data.every((r) => r.eventType === "click_subscribe")).toBe(true)
  })

  it("未登记的事件名被忽略（返回全部，而不是筛出一张空表）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({ eventType: "page_view" })

    const res = await admin.get<EventsList>("/api/admin/events?range=all&event=not_a_real_event")
    expect(res.status).toBe(200)
    // 参数非法时回落成"不筛"，使用者能看出是参数问题而不是"没数据"
    expect(res.body.total).toBeGreaterThanOrEqual(1)
  })

  it("identity=anonymous 只看未登录；identity=registered 只看已登录", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({ eventType: "page_view" })
    await insertEvent({ eventType: "page_view", userId: FIXTURE.userFree })

    const anon = await admin.get<EventsList>("/api/admin/events?range=all&identity=anonymous")
    expect(anon.body.data.every((r) => r.userId === null)).toBe(true)

    const reg = await admin.get<EventsList>("/api/admin/events?range=all&identity=registered")
    expect(reg.body.data.length).toBeGreaterThanOrEqual(1)
    expect(reg.body.data.every((r) => r.userId !== null)).toBe(true)
  })

  it("匿名事件不会被 LEFT JOIN 丢掉（写成 INNER JOIN 时它整段消失）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const id = await insertEvent({ eventType: "theme_toggle", pageUrl: "/anon-check" })

    const res = await admin.get<EventsList>("/api/admin/events?range=all&pageUrl=/anon-check")
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].userId).toBeNull()
    expect(String(res.body.data[0].id)).toBe(String(id))
  })

  it("带出用户名但手机号脱敏（后台不需要完整号码）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "脱敏测试", phone: "13800001111" })
    await insertEvent({ eventType: "login_success", userId: uid, pageUrl: "/mask-check" })

    const res = await admin.get<EventsList>("/api/admin/events?range=all&pageUrl=/mask-check")
    expect(res.body.data[0].userName).toBe("脱敏测试")
    expect(res.body.data[0].userPhone).toBe("138****1111")
  })

  it("按 userId 筛选只返回该用户的记录", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "筛选对象" })
    await insertEvent({ eventType: "page_view", userId: uid })
    await insertEvent({ eventType: "page_view", userId: FIXTURE.userFree })

    const res = await admin.get<EventsList>(`/api/admin/events?range=all&userId=${uid}`)
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].userId).toBe(uid)
  })

  it("关键词能搜到 properties 里的内容（JSON 列要先 CAST 再比较）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({
      eventType: "click_subscribe",
      properties: { plan: "yearly_uniq_marker" },
    })

    const res = await admin.get<EventsList>("/api/admin/events?range=all&q=yearly_uniq_marker")
    expect(res.body.total).toBe(1)
  })

  it("分页参数非法时回落（pageSize=abc 不能变成无 LIMIT 的全表查询）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    for (let i = 0; i < 3; i++) await insertEvent({ eventType: "page_view" })

    const bad = await admin.get<EventsList>("/api/admin/events?range=all&pageSize=abc")
    expect(bad.status).toBe(200)
    expect(bad.body.data.length).toBeLessThanOrEqual(20)

    const zero = await admin.get<EventsList>("/api/admin/events?range=all&current=0")
    expect(zero.status).toBe(200)
  })
})

describe("埋点图表数据 /api/admin/events/stats", () => {
  it("未登录 → 401；非管理员 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/events/stats")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/events/stats")).status,
    ).toBe(401)
  })

  it("没有埋点时也不报错，返回可渲染的空结构（新站点的正常状态）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=all&pageUrl=/nowhere")
    expect(res.status).toBe(200)
    expect(res.body.summary.events).toBe(0)
    expect(res.body.summary.anonymousRate).toBeNull() // 0/0 必须是 null 而不是 NaN
    expect(res.body.trend).toEqual([])
    expect(res.body.byEvent).toEqual([])
  })

  it("汇总数字与明细表的 total 一致（两边共用同一份筛选条件）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "一致性" })
    for (let i = 0; i < 4; i++) {
      await insertEvent({ eventType: "page_view", userId: uid, pageUrl: "/consistency" })
    }

    const query = `range=all&userId=${uid}&pageUrl=/consistency`
    const list = await admin.get<EventsList>(`/api/admin/events?${query}`)
    const stats = await admin.get<StatsResponse>(`/api/admin/events/stats?${query}`)
    expect(stats.body.summary.events).toBe(list.body.total)
  })

  it("**明细行带出 visitor_id**：匿名记录之间才分得清是几个不同的人", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const v1 = "3f2504e0-4f89-41d3-9a0c-000000000301"
    const v2 = "3f2504e0-4f89-41d3-9a0c-000000000302"
    await insertEvent({ eventType: "page_view", visitorId: v1, pageUrl: "/vv-list" })
    await insertEvent({ eventType: "page_view", visitorId: v1, pageUrl: "/vv-list" })
    await insertEvent({ eventType: "page_view", visitorId: v2, pageUrl: "/vv-list" })
    // 存量行（两列皆空）也必须能渲染，visitorId 为 null 而不是报错
    await insertEvent({ eventType: "page_view", pageUrl: "/vv-list" })

    const res = await admin.get<EventsList>("/api/admin/events?range=all&pageUrl=/vv-list")
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(4)
    const ids = res.body.data.map((r) => r.visitorId)
    expect(ids.filter((v) => v === v1).length).toBe(2)
    expect(ids.filter((v) => v === v2).length).toBe(1)
    expect(ids.filter((v) => v === null).length).toBe(1)
  })

  it("关键词按 visitor_id 能筛出同一个访客的全部轨迹（界面点访客码就靠它）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const v = "3f2504e0-4f89-41d3-9a0c-000000000303"
    await insertEvent({ eventType: "page_view", visitorId: v, pageUrl: "/q-a" })
    await insertEvent({ eventType: "theme_toggle", visitorId: v, pageUrl: "/q-b" })
    await insertEvent({ eventType: "page_view", visitorId: "3f2504e0-4f89-41d3-9a0c-000000000304", pageUrl: "/q-c" })

    const res = await admin.get<EventsList>(`/api/admin/events?range=all&q=${v}`)
    expect(res.body.total).toBe(2)
    expect(res.body.data.every((r) => r.visitorId === v)).toBe(true)
  })

  it("事件排行给出次数与独立人数两个口径", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const a = await insertUser({ name: "A" })
    const b = await insertUser({ name: "B" })
    await insertEvent({ eventType: "theme_toggle", userId: a, pageUrl: "/rank" })
    await insertEvent({ eventType: "theme_toggle", userId: a, pageUrl: "/rank" })
    await insertEvent({ eventType: "theme_toggle", userId: b, pageUrl: "/rank" })

    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=all&pageUrl=/rank")
    const row = res.body.byEvent.find((r) => r.eventType === "theme_toggle")
    expect(row?.events).toBe(3)
    // 次数 3 但只有 2 个人 —— 只看次数会被重度用户带偏，所以两个都要有
    expect(row?.users).toBe(2)
  })

  it("趋势序列按天给出，且每个系列的点数与横轴一致", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({ eventType: "page_view", pageUrl: "/trend" })
    await insertEvent({ eventType: "page_view", pageUrl: "/trend" })

    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=week&pageUrl=/trend")
    expect(res.body.granularity).toBe("day")
    expect(res.body.trend.length).toBeGreaterThanOrEqual(1)
    for (const point of res.body.trend) {
      for (const eventType of res.body.series) {
        // 每个刻度上每个系列都要有值（缺失补 0），否则前端会出现断线
        expect(typeof point[eventType]).toBe("number")
      }
    }
  })

  it("range=all 时按天铺满会拉到几百个点，改为按月聚合", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=all")
    expect(res.body.granularity).toBe("month")
  })

  it("24 小时分布只返回有数据的小时（补齐刻度是前端的事）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({ eventType: "page_view", pageUrl: "/hourly" })

    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=all&pageUrl=/hourly")
    expect(res.body.hourly.length).toBeGreaterThanOrEqual(1)
    for (const row of res.body.hourly) {
      expect(row.hour).toBeGreaterThanOrEqual(0)
      expect(row.hour).toBeLessThanOrEqual(23)
      expect(row.count).toBeGreaterThan(0)
    }
  })

  it("匿名占比按 0~1 返回（界面负责乘 100）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "占比" })
    await insertEvent({ eventType: "page_view", pageUrl: "/rate" })
    await insertEvent({ eventType: "page_view", userId: uid, pageUrl: "/rate" })

    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=all&pageUrl=/rate")
    expect(res.body.summary.events).toBe(2)
    expect(res.body.summary.anonymousRate).toBeCloseTo(0.5, 5)
  })

  it("独立访客含未登录的人，且按 visitor_id 去重（同一人多条事件只算一个）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "访客口径" })
    // 未登录访客：同一个 visitor 三条事件
    for (let i = 0; i < 3; i++) {
      await insertEvent({ eventType: "page_view", pageUrl: "/vv", visitorId: "3f2504e0-4f89-41d3-9a0c-000000000101" })
    }
    // 已登录用户：另一个 visitor
    await insertEvent({ eventType: "page_view", userId: uid, pageUrl: "/vv", visitorId: "3f2504e0-4f89-41d3-9a0c-000000000102" })

    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=all&pageUrl=/vv")
    expect(res.body.summary.events).toBe(4)
    // 独立用户只数登录账号（1），独立访客把匿名的那位也算进来（2）
    expect(res.body.summary.users).toBe(1)
    expect(res.body.summary.visitors).toBe(2)
  })

  it("visitor_id 缺失时退回按 session_id 计，不会把两列皆空的行并成一个访客", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertEvent({ eventType: "page_view", pageUrl: "/fb", sessionId: "s1" })
    await insertEvent({ eventType: "page_view", pageUrl: "/fb", sessionId: "s1" })
    await insertEvent({ eventType: "page_view", pageUrl: "/fb", sessionId: "s2" })
    // 两列皆空：不该被算成第 3 个访客
    await insertEvent({ eventType: "page_view", pageUrl: "/fb" })

    const res = await admin.get<StatsResponse>("/api/admin/events/stats?range=all&pageUrl=/fb")
    expect(res.body.summary.visitors).toBe(2)
  })
})

describe("埋点详情 /api/admin/events/:id", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/events/1")).status).toBe(401)
  })

  it("id 不是正整数 → 400（不让 MySQL 做隐式转换扫全表）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      const res = await admin.get(`/api/admin/events/${bad}`)
      expect(res.status, `id=${bad} 应当被拒`).toBe(400)
    }
  })

  it("记录不存在 → 404", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get("/api/admin/events/999999999")
    expect(res.status).toBe(404)
  })

  it("返回记录本身 + 该用户的前后上下文（上下文是排查的关键）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "上下文用户" })
    await insertEvent({ eventType: "page_view", userId: uid, pageUrl: "/ctx/pre" })
    const target = await insertEvent({ eventType: "click_subscribe", userId: uid, pageUrl: "/ctx/target" })
    await insertEvent({ eventType: "paywall_shown", userId: uid, pageUrl: "/ctx/post" })

    const res = await admin.get<{
      data: {
        id: string
        eventType: string
        userId: string | null
        context: Array<{ id: string; eventType: string }>
        contextScope: string
        user: { id: string; name: string | null; eventCount: number } | null
      }
    }>(`/api/admin/events/${target}`)

    expect(res.status).toBe(200)
    expect(res.body.data.eventType).toBe("click_subscribe")
    expect(res.body.data.contextScope).toBe("user")
    expect(res.body.data.user?.name).toBe("上下文用户")
    expect(res.body.data.user?.eventCount).toBe(3)

    const types = res.body.data.context.map((c) => c.eventType)
    expect(types).toContain("page_view")
    expect(types).toContain("paywall_shown")

    // 当前记录不在 context 数组里（前端负责把它插进时间线并高亮）
    expect(res.body.data.context.some((c) => c.id === String(target))).toBe(false)

    // 上下文按 id 数值升序（字符串比较会把 "10" 排到 "9" 前面）
    const ids = res.body.data.context.map((c) => Number(c.id))
    expect([...ids].sort((x, y) => x - y)).toEqual(ids)
  })

  it("匿名记录优先按 visitor 取上下文（跨访问的轨迹不断开）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const visitor = "3f2504e0-4f89-41d3-9a0c-000000000201"
    // 同一访客在两个不同会话里的记录：按 session 只能看到一半，按 visitor 才是完整轨迹
    await insertEvent({ eventType: "page_view", sessionId: "s-day1", visitorId: visitor, pageUrl: "/v/pre" })
    const targetId = await insertEvent({
      eventType: "pricing_view",
      sessionId: "s-day2",
      visitorId: visitor,
      pageUrl: "/v/target",
    })
    await insertEvent({ eventType: "click_subscribe", sessionId: "s-day2", visitorId: visitor, pageUrl: "/v/post" })

    const res = await admin.get<{
      data: {
        visitorId: string | null
        contextScope: string
        context: Array<{ eventType: string }>
      }
    }>(`/api/admin/events/${targetId}`)

    expect(res.body.data.contextScope).toBe("visitor")
    expect(res.body.data.visitorId).toBe(visitor)
    // 另一个会话里的那条 page_view 也在上下文里 —— 这正是 visitor 归并的意义
    expect(res.body.data.context.map((c) => c.eventType)).toContain("page_view")
  })

  it("匿名记录没有 visitor 时按 session 取上下文（逐级退化）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const sid = "e2e-session-ctx"
    await insertEvent({ eventType: "page_view", sessionId: sid, pageUrl: "/s/pre" })
    const target = await insertEvent({ eventType: "click", sessionId: sid, pageUrl: "/s/target" })
    await insertEvent({ eventType: "theme_toggle", sessionId: sid, pageUrl: "/s/post" })

    const res = await admin.get<{
      data: { contextScope: string; user: unknown; context: Array<{ eventType: string }> }
    }>(`/api/admin/events/${target}`)

    expect(res.body.data.contextScope).toBe("session")
    expect(res.body.data.user).toBeNull()
    expect(res.body.data.context.length).toBe(2)
  })

  it("既无 user_id 也无 visitor_id / session_id 时只返回记录本身，不报错", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const id = await insertEvent({ eventType: "page_view" })

    const res = await admin.get<{ data: { contextScope: string; context: unknown[] } }>(
      `/api/admin/events/${id}`,
    )
    expect(res.status).toBe(200)
    expect(res.body.data.contextScope).toBe("none")
    expect(res.body.data.context).toEqual([])
  })
})
