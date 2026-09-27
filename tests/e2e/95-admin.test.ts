/**
 * 后台管理接口（/api/admin/*）。
 *
 * 为什么单独覆盖：后台此前**完全没有自动化覆盖**，而实际审计发现了两类静默故障 ——
 *
 *   1. `/api/admin/subscriptions` 这个接口**根本不存在**，但订阅页和仪表盘都在调它。
 *      仪表盘把四个请求的 .json() 一起 Promise.all，而 404 返回 HTML，.json() 抛错
 *      → 整个仪表盘加载不出来（不只是订阅那一项）。
 *
 *   2. 若干列表页绑定的字段名是下划线风格（is_pro / created_at / out_trade_no），
 *      而接口返回的是 Drizzle 的驼峰属性名（isPro / createdAt / outTradeNo）。
 *      字段名对不上不会报错，只会让**整列显示空白** —— 最难被发现的那类 bug。
 *
 * 所以这里既校验「接口存在且返回 {data,total}」，也校验「页面绑定的字段真的在返回里」。
 * 后者是本文件的主要价值：将来谁把字段名改回下划线，测试会立刻红。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q } from "./helpers/db"
import { insertUser, insertPaidOrder } from "./helpers/factories"

/** 造一个管理员（requireAdmin 认 role='admin'）。 */
async function makeAdmin(): Promise<string> {
  const id = await insertUser({ name: "e2e 管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

/** 插一条订阅（夹具不生成订阅，而订阅列表需要至少一行才能验证字段）。 */
async function insertSubscription(userId: string, plan = "yearly"): Promise<void> {
  await q(
    `INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at, created_at)
     VALUES (UUID(), ?, ?, 'active', NOW(), DATE_ADD(NOW(), INTERVAL 365 DAY), NOW())`,
    [userId, plan]
  )
}

/**
 * 各后台列表的契约。**key 必须是 refine 的资源名**（决定接口 URL
 * `/api/admin/<resource>`），它与页面路由不一定同名 ——
 * 例如资源叫 `payment-orders` 而页面在 `/admin/payments`。
 * fields 取自页面实际绑定的 dataIndex，故意写死，字段名被改回下划线时会立刻红。
 */
const CONTRACT: Record<string, { page: string; fields: string[] }> = {
  users: {
    page: "/admin/users",
    fields: ["name", "phone", "role", "isPro", "createdAt"],
  },
  lessons: {
    page: "/admin/lessons",
    fields: ["title", "summary", "courseId", "sortOrder"],
  },
  "payment-orders": {
    page: "/admin/payments",
    fields: ["plan", "status", "amount", "outTradeNo", "createdAt", "paidAt"],
  },
  subscriptions: {
    page: "/admin/subscriptions",
    fields: ["plan", "status", "startsAt", "expiresAt", "createdAt"],
  },
  courses: {
    page: "/admin/courses",
    fields: ["title", "categoryKey", "coverUrl", "isPublished", "learnerCount", "sourceName"],
  },
  sentences: {
    page: "/admin/sentences",
    fields: ["chinese", "english", "category", "difficulty"],
  },
}

const RESOURCES = Object.keys(CONTRACT)

interface ListBody {
  data: Array<Record<string, unknown>>
  total: number
}

beforeEach(async () => {
  await seedFixtures()
})

describe("后台列表接口：存在性与响应结构", () => {
  it("每个 refine 资源都有对应的列表接口，且返回 { data, total }", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    for (const resource of RESOURCES) {
      const res = await api.get<ListBody>(`/api/admin/${resource}?current=1&pageSize=5`)
      expect(res.status, `${resource} 列表接口应存在并返回 200`).toBe(200)
      expect(Array.isArray(res.body.data), `${resource}.data 应是数组`).toBe(true)
      expect(typeof res.body.total, `${resource}.total 应是数字`).toBe("number")
    }
  })

  it("分页参数非法时不 500（下划线/超限/小数都夹回合法区间）", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    for (const qs of ["current=0", "current=-3", "pageSize=abc", "pageSize=2.5", "pageSize=99999"]) {
      const res = await api.get(`/api/admin/users?${qs}`)
      expect(res.status, `${qs} 不应导致 500`).toBe(200)
    }
  })

  it("未登录 / 非管理员一律 401", async () => {
    const anon = ApiClient.anonymous()
    const normal = ApiClient.asUser(FIXTURE.userFree)
    for (const resource of RESOURCES) {
      expect((await anon.get(`/api/admin/${resource}`)).status, `${resource} 匿名应 401`).toBe(401)
      expect((await normal.get(`/api/admin/${resource}`)).status, `${resource} 非管理员应 401`).toBe(401)
    }
  })
})

describe("后台列表接口：页面绑定字段必须存在", () => {
  it("users / lessons / courses / sentences 的字段齐全", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    for (const resource of ["users", "lessons", "courses", "sentences"]) {
      const res = await api.get<ListBody>(`/api/admin/${resource}?pageSize=5`)
      expect(res.status).toBe(200)
      expect(res.body.data.length, `${resource} 夹具应有数据可供校验`).toBeGreaterThan(0)

      const row = res.body.data[0]
      for (const field of CONTRACT[resource].fields) {
        expect(
          Object.prototype.hasOwnProperty.call(row, field),
          `${resource} 的返回缺少页面绑定的字段「${field}」—— ` +
            `字段名对不上不会报错，只会让该列整列空白`,
        ).toBe(true)
      }
    }
  })

  it("payments 的字段齐全（含 outTradeNo / paidAt）", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    await insertPaidOrder(FIXTURE.userFree, "yearly", 19900)

    const res = await api.get<ListBody>("/api/admin/payment-orders?pageSize=5")
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)

    const row = res.body.data[0]
    for (const field of CONTRACT["payment-orders"].fields) {
      expect(
        Object.prototype.hasOwnProperty.call(row, field),
        `支付订单缺字段「${field}」`,
      ).toBe(true)
    }
  })

  it("subscriptions 的字段齐全（该接口此前整体缺失，连仪表盘一起打挂）", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    await insertSubscription(FIXTURE.userFree)

    const res = await api.get<ListBody>("/api/admin/subscriptions?pageSize=5")
    expect(res.status, "订阅列表接口必须存在").toBe(200)
    expect(res.body.total).toBeGreaterThan(0)

    const row = res.body.data[0]
    for (const field of CONTRACT.subscriptions.fields) {
      expect(
        Object.prototype.hasOwnProperty.call(row, field),
        `订阅列表缺字段「${field}」`,
      ).toBe(true)
    }
  })
})

describe("仪表盘统计 /api/admin/dashboard", () => {
  it("未登录 / 非管理员 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/dashboard")).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/dashboard")).status).toBe(401)
  })

  it("四个时间范围都可用，且返回 activity / totals / daily 三段", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    for (const range of ["week", "month", "quarter", "all"]) {
      const res = await api.get<{
        range: string
        activity: Record<string, number>
        totals: Record<string, number | null>
        daily: unknown[]
      }>(`/api/admin/dashboard?range=${range}`)
      expect(res.status, `range=${range}`).toBe(200)
      expect(res.body.range).toBe(range)
      expect(typeof res.body.activity.newUsers).toBe("number")
      expect(typeof res.body.activity.practiceRecords).toBe("number")
      expect(typeof res.body.totals.users).toBe("number")
      expect(Array.isArray(res.body.daily)).toBe(true)
    }
  })

  it("非法 range 回落到默认而不是 500", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    for (const bad of ["7d", "WEEK", "year", ""]) {
      const res = await api.get<{ range: string }>(`/api/admin/dashboard?range=${bad}`)
      expect(res.status).toBe(200)
      expect(res.body.range).toBe("week") // DEFAULT_RANGE
    }
  })

  it("内容总量不随时间范围变化（句子库走缓存，不是每次全表 COUNT）", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    const week = await api.get<{ totals: { users: number } }>("/api/admin/dashboard?range=week")
    const all = await api.get<{ totals: { users: number } }>("/api/admin/dashboard?range=all")
    expect(week.body.totals.users).toBe(all.body.totals.users)
  })
})

describe("支付订单与用户列表可追溯到人", () => {
  it("订单带出下单人信息，且支持按手机号搜索", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    const buyerId = await insertUser({ name: "e2e 买家", phone: "13800000999" })
    await insertPaidOrder(buyerId, "yearly", 19900)

    const all = await api.get<{ data: Array<Record<string, unknown>> }>(
      "/api/admin/payment-orders?pageSize=20"
    )
    const row = all.body.data.find((r) => r.userId === buyerId)
    expect(row, "应能查到刚插入的订单").toBeDefined()
    expect(row?.userName).toBe("e2e 买家")
    expect(row?.userPhone).toBe("13800000999")

    const searched = await api.get<{ data: Array<Record<string, unknown>>; total: number }>(
      "/api/admin/payment-orders?q=13800000999"
    )
    expect(searched.body.data.some((r) => r.userId === buyerId)).toBe(true)
  })

  it("用户列表带出练习数 / 埋点数 / 已付订单数（列表页据此分辨真用户）", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "e2e 带数据用户" })
    await insertPaidOrder(uid, "monthly", 2900)

    const res = await api.get<{ data: Array<Record<string, unknown>> }>(
      "/api/admin/users?pageSize=50"
    )
    const row = res.body.data.find((r) => r.id === uid)
    expect(row).toBeDefined()
    for (const f of ["practiceCount", "eventCount", "paidOrderCount", "hasWechat"]) {
      expect(
        Object.prototype.hasOwnProperty.call(row as object, f),
        `用户列表缺字段「${f}」`,
      ).toBe(true)
    }
    expect(Number(row?.paidOrderCount)).toBe(1)
  })

  it("用户搜索按姓名与手机号都能命中", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    const uid = await insertUser({ name: "唯一昵称ZZZ", phone: "13800000888" })
    for (const q of ["唯一昵称ZZZ", "13800000888"]) {
      const res = await api.get<{ data: Array<Record<string, unknown>> }>(
        `/api/admin/users?q=${encodeURIComponent(q)}`
      )
      expect(res.body.data.some((r) => r.id === uid), `搜索 ${q} 应命中`).toBe(true)
    }
  })
})
