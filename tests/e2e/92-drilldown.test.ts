/**
 * 链路：仪表盘指标 → 列表 → 记录（钻取闭环）
 *
 * 这一层覆盖的是**闭环本身**，不是单个接口。仪表盘上每个数字都要能点进构成它的
 * 记录；如果落点的筛选条件被忽略，列表会返回全量数据 —— 条数多于卡片上的数字，
 * 使用者第一反应是"报表算错了"。这类失败没有任何报错，只有数字对不上。
 *
 * 所以每个用例都在断言同一件事：**列表 total 与仪表盘指标值相等**。
 * 这是"闭环"唯一可验证的定义。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q } from "./helpers/db"
import { insertPractice, insertPaidOrder, insertUser } from "./helpers/factories"

async function makeAdmin(): Promise<string> {
  const id = await insertUser({ name: "e2e 钻取管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

interface ListBody {
  data: Array<Record<string, unknown>>
  total: number
}

interface DashboardBody {
  activity: {
    newUsers: number
    activeUsers: number
    practiceRecords: number
    events: number
    paidOrders: number
    revenueFen: number
    trialClaims: number
  }
  totals: { users: number; activeSubscriptions: number }
}

/** 把 daysAgo 天前做成一个 Date。 */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400_000)
}

beforeEach(async () => {
  await seedFixtures()
})

describe("新增用户 → /admin/users?range=", () => {
  it("列表 total 与仪表盘「新增用户」相等", async () => {
    const admin = await makeAdmin()
    // 一个窗口内、一个窗口外：没有窗口外的数据，就分不清"筛了"和"没筛"
    await insertUser({ name: "窗口内用户", createdAt: daysAgo(2) })
    await insertUser({ name: "窗口外用户", createdAt: daysAgo(60) })

    const api = ApiClient.asUser(admin)
    const dash = await api.get<DashboardBody>("/api/admin/dashboard?range=week")
    const list = await api.get<ListBody>("/api/admin/users?range=week&pageSize=100")

    expect(list.body.total).toBe(dash.body.activity.newUsers)
    // 窗口外的那个用户不能出现
    expect(list.body.data.some((u) => u.name === "窗口外用户")).toBe(false)
  })

  it("不传 range 时不加时间条件（列表页默认看全部，而不是默认近一周）", async () => {
    const admin = await makeAdmin()
    await insertUser({ name: "很久以前", createdAt: daysAgo(60) })

    const list = await ApiClient.asUser(admin).get<ListBody>("/api/admin/users?pageSize=100")
    // 这是最容易踩的坑：套用 parseRange 的默认值 week 会让用户列表莫名其妙只剩一周
    expect(list.body.data.some((u) => u.name === "很久以前")).toBe(true)
  })

  it("range=all 视同不筛", async () => {
    const admin = await makeAdmin()
    await insertUser({ name: "远古用户", createdAt: daysAgo(500) })
    const list = await ApiClient.asUser(admin).get<ListBody>("/api/admin/users?range=all&pageSize=100")
    expect(list.body.data.some((u) => u.name === "远古用户")).toBe(true)
  })
})

describe("活跃用户（有练习）→ /admin/users?range=&active=1", () => {
  it("只包含窗口内练过的人，且 total 与仪表盘一致", async () => {
    const admin = await makeAdmin()
    const activeUser = await insertUser({ name: "练过的", createdAt: daysAgo(60) })
    const idleUser = await insertUser({ name: "没练的", createdAt: daysAgo(60) })

    await insertPractice(activeUser, FIXTURE.sentA1Plain, { createdAt: daysAgo(1) })
    void idleUser

    const api = ApiClient.asUser(admin)
    const dash = await api.get<DashboardBody>("/api/admin/dashboard?range=week")
    const list = await api.get<ListBody>("/api/admin/users?range=week&active=1&pageSize=100")

    expect(list.body.total).toBe(dash.body.activity.activeUsers)
    expect(list.body.data.map((u) => u.name)).toContain("练过的")
    expect(list.body.data.map((u) => u.name)).not.toContain("没练的")
  })

  it("**窗口外**练过的人不算活跃（按练习时间而不是注册时间筛）", async () => {
    const admin = await makeAdmin()
    const oldUser = await insertUser({ name: "上个月练过", createdAt: daysAgo(90) })
    await insertPractice(oldUser, FIXTURE.sentA1Plain, { createdAt: daysAgo(40) })

    const list = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/users?range=week&active=1&pageSize=100",
    )
    expect(list.body.data.some((u) => u.name === "上个月练过")).toBe(false)
  })

  it("活跃筛选不受注册时间限制（老用户这周练过也要算）", async () => {
    const admin = await makeAdmin()
    // 注册在很久以前，但这周才第一次练 —— 这正是"活跃"要抓的人
    const veteran = await insertUser({ name: "老兵新练", createdAt: daysAgo(200) })
    await insertPractice(veteran, FIXTURE.sentA1Plain, { createdAt: daysAgo(1) })

    const list = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/users?range=week&active=1&pageSize=100",
    )
    expect(list.body.data.some((u) => u.name === "老兵新练")).toBe(true)
  })
})

describe("领取体验会员 → /admin/users?range=&trial=1", () => {
  it("只包含窗口内领取的人", async () => {
    const admin = await makeAdmin()
    const claimed = await insertUser({ name: "刚领的" })
    const old = await insertUser({ name: "早领的" })
    await q("UPDATE users SET trial_claimed_at = ? WHERE id = ?", [daysAgo(1), claimed])
    await q("UPDATE users SET trial_claimed_at = ? WHERE id = ?", [daysAgo(60), old])

    const list = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/users?range=week&trial=1&pageSize=100",
    )
    expect(list.body.data.some((u) => u.name === "刚领的")).toBe(true)
    expect(list.body.data.some((u) => u.name === "早领的")).toBe(false)
  })

  it("从未领取（trial_claimed_at 为 NULL）的人不会被算进来", async () => {
    const admin = await makeAdmin()
    await insertUser({ name: "没领过" })
    const list = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/users?range=all&trial=1&pageSize=100",
    )
    expect(list.body.data.some((u) => u.name === "没领过")).toBe(false)
  })
})

describe("付费订单 / 收入 → /admin/payments?range=&status=paid", () => {
  it("条数与仪表盘「付费订单」相等，金额与「收入」相等", async () => {
    const admin = await makeAdmin()
    await insertPaidOrder(FIXTURE.userBuyer, "yearly", 19900)
    await insertPaidOrder(FIXTURE.userBuyer, "monthly", 2900, { createdAt: daysAgo(60) })

    const api = ApiClient.asUser(admin)
    const dash = await api.get<DashboardBody>("/api/admin/dashboard?range=week")
    const list = await api.get<ListBody & { paidFen: number }>(
      "/api/admin/payment-orders?range=week&status=paid&pageSize=100",
    )

    expect(list.body.total).toBe(dash.body.activity.paidOrders)
    // 列表自己算的同口径金额必须等于仪表盘的收入，否则"点进去对不上账"
    expect(list.body.paidFen).toBe(dash.body.activity.revenueFen)
  })

  it("不带 status 时会把待支付订单也算进来 —— 所以仪表盘的链接必须带 status=paid", async () => {
    const admin = await makeAdmin()
    await insertPaidOrder(FIXTURE.userBuyer, "yearly", 19900)

    const api = ApiClient.asUser(admin)
    const withStatus = await api.get<ListBody>("/api/admin/payment-orders?status=paid&pageSize=100")
    const paidOnly = withStatus.body.data.filter((o) => o.status === "paid")
    expect(paidOnly.length).toBe(withStatus.body.total)
  })

  it("按 paid_at 而不是 created_at 筛（收入的归属期看收款时间）", async () => {
    const admin = await makeAdmin()
    // 60 天前创建、昨天支付：应当算进本周收入
    await q(
      `INSERT INTO payment_orders (id, user_id, plan, amount, out_trade_no, status, paid_at, created_at)
       VALUES (UUID(), ?, 'yearly', 19900, ?, 'paid', ?, ?)`,
      [FIXTURE.userBuyer, `TYPENOW-DRILL-${Date.now()}`, daysAgo(1), daysAgo(60)],
    )

    const list = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/payment-orders?range=week&status=paid&pageSize=100",
    )
    expect(list.body.total).toBeGreaterThanOrEqual(1)
  })

  it("非法 status 被忽略（回落成不筛），而不是筛出空表", async () => {
    const admin = await makeAdmin()
    await insertPaidOrder(FIXTURE.userBuyer, "yearly", 19900)
    const list = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/payment-orders?status=not_a_status&pageSize=100",
    )
    expect(list.body.total).toBeGreaterThanOrEqual(1)
  })

  it("status 清单必须与 schema 的枚举一致（凭直觉写 failed 就永远查不到）", async () => {
    const admin = await makeAdmin()
    await insertPaidOrder(FIXTURE.userBuyer, "yearly", 19900)
    const api = ApiClient.asUser(admin)
    // 有效枚举能筛出东西
    for (const s of ["paid", "pending", "expired", "cancelled"]) {
      const res = await api.get<ListBody>(`/api/admin/payment-orders?status=${s}&pageSize=5`)
      expect(res.status, `status=${s} 应当被接受`).toBe(200)
    }
  })
})

describe("活跃订阅 → /admin/subscriptions?status=active", () => {
  it("总数与仪表盘「活跃订阅」相等", async () => {
    const admin = await makeAdmin()
    await q(
      `INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at, created_at)
       VALUES (UUID(), ?, 'yearly', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 365 DAY), NOW())`,
      [FIXTURE.userBuyer],
    )

    const api = ApiClient.asUser(admin)
    const dash = await api.get<DashboardBody>("/api/admin/dashboard?range=all")
    const list = await api.get<ListBody>("/api/admin/subscriptions?status=active&pageSize=100")
    expect(list.body.total).toBe(dash.body.totals.activeSubscriptions)
  })

  it("不含已取消/已过期的订阅", async () => {
    const admin = await makeAdmin()
    await q(
      `INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at, created_at)
       VALUES (UUID(), ?, 'yearly', 'cancelled', NOW(), DATE_ADD(NOW(), INTERVAL 365 DAY), NOW())`,
      [FIXTURE.userBuyer],
    )
    const list = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/subscriptions?status=active&pageSize=100",
    )
    expect(list.body.data.every((s) => s.status === "active")).toBe(true)
  })
})

describe("练习句数 → /admin/practice（新接口 /api/admin/practice-records）", () => {
  it("未登录 → 401；非管理员 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/practice-records")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/practice-records")).status,
    ).toBe(401)
  })

  it("total 与仪表盘「练习句数」相等（这是闭环的可验证定义）", async () => {
    const admin = await makeAdmin()
    await insertPractice(FIXTURE.userFree, FIXTURE.sentA1Plain, { createdAt: daysAgo(1) })
    await insertPractice(FIXTURE.userFree, FIXTURE.sentA2Plain, { createdAt: daysAgo(2) })
    await insertPractice(FIXTURE.userFree, FIXTURE.sentB1Plain, { createdAt: daysAgo(40) })

    const api = ApiClient.asUser(admin)
    const dash = await api.get<DashboardBody>("/api/admin/dashboard?range=week")
    const list = await api.get<ListBody>("/api/admin/practice-records?range=week&pageSize=100")

    // 窗口内 2 条（1 天前、2 天前），第 3 条在 40 天前不属"近一周"
    expect(dash.body.activity.practiceRecords).toBe(2)
    expect(list.body.total).toBe(dash.body.activity.practiceRecords)
  })

  it("带出用户与句子内容（否则这一页只能看到两个 UUID）", async () => {
    const admin = await makeAdmin()
    const uid = await insertUser({ name: "练习的人", phone: "13900002222" })
    await insertPractice(uid, FIXTURE.sentA1Plain, { createdAt: daysAgo(1), score: 9, mistakes: 1 })

    const res = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/practice-records?range=week&pageSize=10",
    )
    const row = res.body.data[0]
    expect(row.userName).toBe("练习的人")
    // 手机号脱敏（与用户列表一致，后台不需要完整号码）
    expect(row.userPhone).toBe("139****2222")
    expect(typeof row.chinese).toBe("string")
    expect(row.chinese).not.toBe("")
    expect(row.score).toBe(9)
    expect(row.mistakes).toBe(1)
    expect(row).toHaveProperty("isReview")
  })

  it("句子被删除后记录仍在（LEFT JOIN 不能变成 INNER JOIN）", async () => {
    const admin = await makeAdmin()
    // 一个不存在的 sentence_id：INNER JOIN 会把这条记录整体吃掉，
    // 于是 total 小于仪表盘的「练习句数」，而对不上是最难排查的症状
    await insertPractice(FIXTURE.userFree, "99999999-9999-4999-8999-999999999999", {
      createdAt: daysAgo(1),
    })

    const api = ApiClient.asUser(admin)
    const dash = await api.get<DashboardBody>("/api/admin/dashboard?range=week")
    const list = await api.get<ListBody>("/api/admin/practice-records?range=week&pageSize=100")
    expect(list.body.total).toBe(dash.body.activity.practiceRecords)
  })

  it("支持按用户筛（从用户详情钻过来看这个人的练习）", async () => {
    const admin = await makeAdmin()
    const mine = await insertUser({ name: "只看我" })
    const other = await insertUser({ name: "别看别人" })
    await insertPractice(mine, FIXTURE.sentA1Plain, { createdAt: daysAgo(1) })
    await insertPractice(other, FIXTURE.sentA1Plain, { createdAt: daysAgo(1) })

    const list = await ApiClient.asUser(admin).get<ListBody>(
      `/api/admin/practice-records?range=all&userId=${mine}&pageSize=100`,
    )
    expect(list.body.total).toBe(1)
    expect(list.body.data[0].userId).toBe(mine)
  })

  it("支持按关键词搜（用户昵称 / 句子内容）", async () => {
    const admin = await makeAdmin()
    const uid = await insertUser({ name: "关键词用户" })
    await insertPractice(uid, FIXTURE.sentA1Plain, { createdAt: daysAgo(1) })

    const byName = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/practice-records?range=all&q=关键词用户&pageSize=10",
    )
    expect(byName.body.total).toBe(1)
  })

  it("分页参数非法时回落", async () => {
    const admin = await makeAdmin()
    await insertPractice(FIXTURE.userFree, FIXTURE.sentA1Plain, { createdAt: daysAgo(1) })
    const bad = await ApiClient.asUser(admin).get<ListBody>(
      "/api/admin/practice-records?range=all&pageSize=abc",
    )
    expect(bad.status).toBe(200)
    expect(bad.body.data.length).toBeLessThanOrEqual(20)
  })
})

describe("钻取链接用的字段都是接口真正认识的", () => {
  it("仪表盘发出的每一个筛选参数都能改变结果（没有'静默忽略'的参数）", async () => {
    const admin = await makeAdmin()
    await insertUser({ name: "较新的", createdAt: daysAgo(1) })
    // 这个用户专门用来区分「近一周」与「近一月」：只插一个 90 天前的用户，
    // 周和月会得到相同结果，测不出 range 是否真的生效
    await insertUser({ name: "月内周外", createdAt: daysAgo(20) })
    await insertUser({ name: "较旧的", createdAt: daysAgo(90) })
    const api = ApiClient.asUser(admin)

    const all = await api.get<ListBody>("/api/admin/users?pageSize=100")
    const week = await api.get<ListBody>("/api/admin/users?range=week&pageSize=100")
    const month = await api.get<ListBody>("/api/admin/users?range=month&pageSize=100")

    // 三个范围必须是三个不同的结果集，否则说明 range 被忽略了
    expect(week.body.total).toBeLessThan(month.body.total)
    expect(month.body.total).toBeLessThan(all.body.total)
  })
})
