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
    source: "db" | "events" | "traffic"
    value: number
    stepRate: number | null
    overallRate: number | null
  }>
  acquisition: {
    visitors: number
    converted: number
    conversionRate: number | null
    visitorShortfall: boolean
    note: string
  }
  domain: {
    registered: number
    practicedUsers: number
    practiceRecords: number
    paidUsers: number
    paidOrders: number
    revenueFen: number
    subscriptions: number
    visitors: number
  }
  events: Array<{ eventType: string; events: number; users: number }>
  daily: Array<{ date: string; events: number; users: number }>
  topPages: Array<{ page: string; count: number }>
}

/** 造一个合规的 visitor id（track 接口只认这个格式，见 lib/visitor.ts） */
function vid(n: number): string {
  const tail = String(n).padStart(12, "0")
  return `3f2504e0-4f89-41d3-9a0c-${tail}`
}

async function getFunnel(client: ApiClient, range?: string) {
  const qs = range ? `?range=${range}` : ""
  return client.get<FunnelResponse>(`/api/admin/analytics/funnel${qs}`)
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

  // ── 匿名访客身份（visitor_id）─────────────────────────────────────────────
  // 这几个用例钉住的是「匿名流量能不能归人」这件事：没有稳定 visitor 时，
  // 匿名事件只是一堆无法归人的记录，首启漏斗也就只能从「注册」那一步开始画。
  it("合法的 visitorId 落库", async () => {
    await ApiClient.anonymous().request("POST", "/api/analytics/track", {
      json: { event: "page_view", properties: {}, pageUrl: "/", visitorId: vid(1) },
    })
    expect(await dbScalar(`SELECT COUNT(*) AS n FROM analytics_events WHERE visitor_id = '${vid(1)}'`)).toBe(1)
  })

  it("**非法 visitorId 存 NULL 而不是拒绝上报**：丢身份可以，丢事件不行", async () => {
    const res = await ApiClient.anonymous().request("POST", "/api/analytics/track", {
      json: { event: "page_view", properties: {}, pageUrl: "/", visitorId: "随手编的字符串" },
    })
    expect(res.status).toBe(200)
    expect(await dbScalar("SELECT COUNT(*) AS n FROM analytics_events WHERE visitor_id IS NULL")).toBe(1)
  })

  it("完全不带 visitorId 也能上报（老客户端 / cookie 被拦）", async () => {
    const res = await ApiClient.anonymous().request("POST", "/api/analytics/track", {
      json: { event: "page_view", properties: {}, pageUrl: "/" },
    })
    expect(res.status).toBe(200)
    expect(await dbScalar("SELECT COUNT(*) AS n FROM analytics_events")).toBe(1)
  })

  it("同一 visitor 的上报与登录后的上报能串起来（visitor 绑定到账号）", async () => {
    // 先匿名逛，再登录上报 —— 后者同时带 user_id 与同一个 visitor_id，
    // 这就是「匿名 → 注册」归因成立的前提
    await ApiClient.anonymous().request("POST", "/api/analytics/track", {
      json: { event: "page_view", properties: {}, pageUrl: "/", visitorId: vid(7) },
    })
    await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/analytics/track", {
      json: { event: "page_view", properties: {}, pageUrl: "/home", visitorId: vid(7) },
    })

    expect(
      await dbScalar(
        `SELECT COUNT(*) AS n FROM analytics_events
          WHERE visitor_id = '${vid(7)}' AND user_id IS NOT NULL`
      )
    ).toBe(1)
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
    // 「注册」这一步是权威数据，零埋点也不是 0（夹具里有用户）
    expect(res.body.funnel.find((s) => s.key === "registered")?.value).toBeGreaterThan(0)
    // 而成品零埋点时，第一步「访问站点」只能取注册数作下界，并显式标记出来
    expect(res.body.acquisition.visitorShortfall).toBe(true)
    expect(res.body.acquisition.conversionRate).toBeNull()
  })

  // ── 获客段：匿名流量终于进了漏斗顶端 ─────────────────────────────────────
  //
  // 这几个用例一律**直接写库**而不是走上报接口来造访客：
  // /api/analytics/track 按 IP 限流（60 次/分钟），而这里经常要造十几个访客，
  // 走接口会把整个 e2e 套件打到 429，失败还看不出跟谁有关。
  // 接口侧的写入行为由上面「埋点上报」那组用例覆盖，这里只管报表口径。

  /** 写一条页面浏览。daysAgo 用于控制"首访时间" */
  async function insertView(
    visitorId: string | null,
    opts: { userId?: string | null; path?: string; daysAgo?: number } = {}
  ): Promise<void> {
    await q(
      `INSERT INTO analytics_events (event_type, user_id, visitor_id, session_id, page_url, created_at)
       VALUES ('page_view', ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [
        opts.userId ?? null,
        visitorId,
        visitorId ? `s-${visitorId}` : null,
        opts.path ?? "/",
        opts.daysAgo ?? 0,
      ]
    )
  }

  /**
   * 当前注册用户数（= 接口的 cohortSize 下界比较基准）。
   *
   * 为什么用例要自己算它：访客数少于注册数时，接口会按注册数取**下界**并标记
   * visitorShortfall（防止漏斗出现下游大于上游）。夹具里用户是现成的，
   * 所以用例必须先保证访客足够多，否则测的是下界逻辑而不是获客口径。
   */
  async function registeredCount(): Promise<number> {
    return dbScalar("SELECT COUNT(*) AS n FROM users")
  }

  it("匿名访客计入第一步「访问站点」（此前漏斗第一步就是注册，匿名流量整体缺席）", async () => {
    const adminId = await makeAdmin()
    const registered = await registeredCount()
    const total = registered + 3
    for (let i = 1; i <= total; i++) await insertView(vid(i))

    const res = await getFunnel(ApiClient.asUser(adminId))
    const visited = res.body.funnel.find((s) => s.key === "visited")
    expect(visited?.source).toBe("traffic")
    expect(res.body.acquisition.visitorShortfall).toBe(false)
    expect(visited?.value).toBe(total)
    expect(res.body.acquisition.visitors).toBe(total)
    // 这些访客一个账号都没绑上 —— 这正是"没注册的用户"的可观测形态
    expect(res.body.acquisition.converted).toBe(0)
    expect(res.body.acquisition.conversionRate).toBe(0)
  })

  it("同一访客多次访问只算一个人（按 visitor 去重，不是按事件数）", async () => {
    const adminId = await makeAdmin()
    const registered = await registeredCount()
    const total = registered + 2
    // 1 号访客留下 5 条事件，其余每人 1 条；事件总数远多于人数
    for (const path of ["/", "/pricing", "/login", "/pricing", "/"]) {
      await insertView(vid(1), { path })
    }
    for (let i = 2; i <= total; i++) await insertView(vid(i))

    const res = await getFunnel(ApiClient.asUser(adminId))
    expect(res.body.acquisition.visitors).toBe(total)
  })

  it("访客后来归属了账号 → converted 计数（匿名 → 注册的转化率）", async () => {
    const adminId = await makeAdmin()
    const registered = await registeredCount()
    const total = registered + 3
    for (let i = 1; i <= total; i++) {
      await insertView(vid(i))
    }
    // 其中 1 号访客后来又带上了 user_id：同一浏览器登录后继续上报就是这个形状
    await insertView(vid(1), { userId: FIXTURE.userFree, path: "/home" })

    const res = await getFunnel(ApiClient.asUser(adminId))
    expect(res.body.acquisition.visitors).toBe(total)
    expect(res.body.acquisition.converted).toBe(1)
    expect(res.body.acquisition.conversionRate).toBeCloseTo(1 / total, 5)
  })

  it("**老访客再访问不算新访客**：首访必须落在所选时间范围内", async () => {
    const adminId = await makeAdmin()
    const registered = await registeredCount()
    const total = registered + 2
    // 一个 30 天前就来过的老访客 + total 个本周新访客
    await insertView(vid(99), { daysAgo: 30 })
    for (let i = 1; i <= total; i++) await insertView(vid(i))

    const week = await getFunnel(ApiClient.asUser(adminId), "week")
    expect(week.body.acquisition.visitors).toBe(total)

    // 不限时间时，那位老访客同样计入
    const all = await getFunnel(ApiClient.asUser(adminId), "all")
    expect(all.body.acquisition.visitors).toBe(total + 1)
  })

  it("visitor_id 与 session_id 都缺的历史数据不并成一个『神秘访客』", async () => {
    const adminId = await makeAdmin()
    const registered = await registeredCount()
    const total = registered + 3
    for (let i = 1; i <= total; i++) await insertView(vid(i))
    // 加列之前的存量行就是"两列皆空"这个形状：它们聚合出的那个 NULL 分组
    // 不该被算成第 total + 1 个访客
    await q(
      `INSERT INTO analytics_events (event_type, visitor_id, session_id, page_url)
       VALUES ('page_view', NULL, NULL, '/'), ('page_view', NULL, NULL, '/pricing')`
    )

    const res = await getFunnel(ApiClient.asUser(adminId), "all")
    expect(res.body.acquisition.visitors).toBe(total)
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
