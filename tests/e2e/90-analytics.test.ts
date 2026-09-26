/**
 * 链路：埋点上报与首启漏斗报表
 *
 * 为什么单独覆盖：在这之前 lib/analytics.ts 里的 8 个上报函数只有 3 个被调用，
 * page_view / practice_complete / login_success 从写下那天起就没被调用过，
 * 于是线上后台的「热门页面」永远是空表 —— 报表没坏，是没人往上送数。
 * 这个文件把「事件名两端一致」与「漏斗口径正确」两件事都钉住。
 *
 * 覆盖三层：
 *   1. 上报接口的白名单（登记的事件能进、没登记的被拒、匿名可用）
 *   2. 漏斗接口的鉴权（未登录 / 非管理员都 401）
 *   3. 漏斗数值口径 —— 尤其**权威步骤必须来自数据库**（注册/练习/付费），
 *      不能因为埋点缺失而变成 0
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser } from "./helpers/factories"
import { ALLOWED_EVENTS, FUNNEL_STEPS } from "@/lib/analytics-events"

/** 造一个管理员账号（requireAdmin 认 role='admin'）。 */
async function makeAdmin(): Promise<string> {
  const id = await insertUser({ name: "e2e 管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

/** 直接读数据库，作为漏斗报表的对照口径。 */
async function dbScalar(sqlText: string): Promise<number> {
  const row = await one<{ n: number }>(sqlText)
  return Number(row?.n ?? 0)
}

interface FunnelResponse {
  funnel: Array<{
    key: string
    label: string
    source: "db" | "events"
    value: number
    stepRate: number | null
    overallRate: number | null
  }>
  domain: {
    registered: number
    practicedUsers: number
    practiceRecords: number
    paidUsers: number
    paidOrders: number
    revenueFen: number
    subscriptions: number
  }
  events: Array<{ eventType: string; events: number; users: number }>
  daily: Array<{ date: string; events: number; users: number }>
  topPages: Array<{ page: string; count: number }>
}

async function getFunnel(client: ApiClient) {
  return client.get<FunnelResponse>("/api/admin/analytics/funnel")
}

beforeEach(async () => {
  await seedFixtures()
})

describe("埋点上报 /api/analytics/track", () => {
  it("接受白名单里的全部事件（含本次新增的漏斗事件）", async () => {
    for (const event of ALLOWED_EVENTS) {
      const res = await ApiClient.asUser(FIXTURE.userFree).request(
        "POST",
        "/api/analytics/track",
        { json: { event, properties: {}, pageUrl: "/x", sessionId: "s" } }
      )
      expect(res.status, `事件「${event}」应被接受，实际 ${res.status}`).toBe(200)
    }
  })

  it("拒绝未登记的事件名（防灌库）", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).request(
      "POST",
      "/api/analytics/track",
      { json: { event: "偷偷加的事件", properties: {} } }
    )
    expect(res.status).toBe(400)
  })

  it("未登录也能上报，且落库时 user_id 为 NULL（匿名流量是漏斗的一部分）", async () => {
    const res = await ApiClient.anonymous().request("POST", "/api/analytics/track", {
      json: { event: "page_view", properties: {}, pageUrl: "/", sessionId: "anon" },
    })
    expect(res.status).toBe(200)

    const nullUsers = await dbScalar(
      "SELECT COUNT(*) AS n FROM analytics_events WHERE user_id IS NULL"
    )
    expect(nullUsers).toBe(1)
  })

  it("登录用户上报时带上 user_id", async () => {
    await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/analytics/track", {
      json: { event: "course_open", properties: { courseId: "c1" } },
    })
    const n = await dbScalar(
      `SELECT COUNT(*) AS n FROM analytics_events WHERE user_id = '${FIXTURE.userFree}'`
    )
    expect(n).toBe(1)
  })
})

describe("漏斗报表 /api/admin/analytics/funnel", () => {
  it("未登录 → 401；非管理员 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/analytics/funnel")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/analytics/funnel")).status
    ).toBe(401)
  })

  it("管理员可读，且漏斗步骤与 FUNNEL_STEPS 一一对应", async () => {
    const res = await getFunnel(ApiClient.asUser(await makeAdmin()))
    expect(res.status).toBe(200)
    expect(res.body.funnel.map((s) => s.key)).toEqual(FUNNEL_STEPS.map((s) => s.key))
    expect(res.body.funnel.map((s) => s.source)).toEqual(FUNNEL_STEPS.map((s) => s.source))
  })

  it("**权威步骤取自数据库**：注册/练习/付费 与库内实际数字一致", async () => {
    const adminId = await makeAdmin()
    const res = await getFunnel(ApiClient.asUser(adminId))
    expect(res.status).toBe(200)

    // 这三步即使一条埋点都没有，也必须给出真实数字
    expect(res.body.funnel.find((s) => s.key === "registered")?.value).toBe(
      await dbScalar("SELECT COUNT(*) AS n FROM users")
    )
    expect(res.body.domain.practicedUsers).toBe(
      await dbScalar("SELECT COUNT(DISTINCT user_id) AS n FROM practice_records")
    )
    expect(res.body.domain.paidUsers).toBe(
      await dbScalar(
        "SELECT COUNT(DISTINCT user_id) AS n FROM payment_orders WHERE status = 'paid'"
      )
    )
  })

  it("行为步骤取自埋点：上报 course_open 后该步人数立刻反映出来", async () => {
    const adminId = await makeAdmin()

    const before = await getFunnel(ApiClient.asUser(adminId))
    const beforeVal = before.body.funnel.find((s) => s.key === "course_open")?.value ?? 0

    await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/analytics/track", {
      json: { event: "course_open", properties: { courseId: "c1" } },
    })

    const after = await getFunnel(ApiClient.asUser(adminId))
    const afterVal = after.body.funnel.find((s) => s.key === "course_open")?.value ?? 0
    expect(afterVal).toBe(beforeVal + 1)
  })

  it("没有埋点时行为步骤为 0，但报表不报错（新站点的正常状态）", async () => {
    const adminId = await makeAdmin()
    const res = await getFunnel(ApiClient.asUser(adminId))
    expect(res.status).toBe(200)

    const courseOpen = res.body.funnel.find((s) => s.key === "course_open")
    expect(courseOpen?.value).toBe(0)
    // 第一步是权威数据，所以即使零埋点也不是 0（夹具里有用户）
    expect(res.body.funnel[0].value).toBeGreaterThan(0)
  })

  it("事件分布与每日趋势随上报更新", async () => {
    const adminId = await makeAdmin()
    await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/analytics/track", {
      json: { event: "lesson_start", properties: {} },
    })

    const res = await getFunnel(ApiClient.asUser(adminId))
    const lesson = res.body.events.find((e) => e.eventType === "lesson_start")
    expect(lesson?.events).toBe(1)
    expect(lesson?.users).toBe(1)
    expect(res.body.daily.length).toBeGreaterThan(0)
  })

  it("热门页面取自 pageUrl（而不是恒为空的 properties.page）", async () => {
    const adminId = await makeAdmin()
    await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/analytics/track", {
      json: { event: "page_view", properties: {}, pageUrl: "/home/store" },
    })

    const res = await getFunnel(ApiClient.asUser(adminId))
    expect(res.body.topPages.find((p) => p.page === "/home/store")?.count).toBe(1)
  })

  it("换算率：上一步为 0 时返回 null 而不是 NaN/Infinity", async () => {
    const adminId = await makeAdmin()
    const res = await getFunnel(ApiClient.asUser(adminId))
    for (const step of res.body.funnel) {
      if (step.stepRate !== null) expect(Number.isFinite(step.stepRate)).toBe(true)
      if (step.overallRate !== null) expect(Number.isFinite(step.overallRate)).toBe(true)
    }
  })
})
