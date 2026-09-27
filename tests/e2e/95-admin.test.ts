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

describe("仪表盘依赖的四个接口", () => {
  it("仪表盘用到的请求全部可用（任一 404 会让整页 Promise.all 崩掉）", async () => {
    const api = ApiClient.asUser(await makeAdmin())
    await insertPaidOrder(FIXTURE.userFree, "monthly", 2900)
    await insertSubscription(FIXTURE.userFree, "monthly")

    // 与 src/app/admin/page.tsx 的请求保持一致
    const urls = [
      "/api/admin/users?pageSize=1",
      "/api/admin/subscriptions?pageSize=1",
      "/api/admin/sentences?pageSize=1",
      "/api/admin/payment-orders?pageSize=10",
    ]
    for (const url of urls) {
      const res = await api.get<ListBody>(url)
      expect(res.status, `仪表盘依赖 ${url}`).toBe(200)
      // 关键：必须是 JSON。404 时 Next 返回 HTML，.json() 会抛错并打挂整个仪表盘
      expect(Array.isArray(res.body?.data), `${url} 必须返回 JSON 且含 data`).toBe(true)
    }
  })
})
