/**
 * 链路：会员 / 订阅的「此刻是否生效」口径
 *
 * 起因（2026-09-27）：`users.is_pro` 是**标记**不是事实 —— 它只在
 * `checkAndExpirePro` 被调用时才回收，而后者只挂在三个接口上，所以
 * **再也不回来的用户会一直挂着 `is_pro=1`**。线上实测 18 行过期体验会员
 * 把这个数字从真实的 3 抬到 21（已手工回收，但根因是"统计读了标记"）。
 *
 * 这个套件钉住新口径：一切统计 / 筛选 / 展示都按
 * 「is_pro 且（无到期时间 或 未到期）」算，并且**仍要紧守钻取闭环** ——
 * 仪表盘卡片上的数字必须等于点进去的列表条数。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, scalar } from "./helpers/db"
import { insertUser, insertPaidOrder } from "./helpers/factories"

async function makeAdmin(): Promise<string> {
  const id = await insertUser({ name: "e2e 会员口径管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86400_000)
}

/** 造用户并直接写会员字段（绕过接口，构造"标记没被回收"的状态） */
async function makeMember(opts: {
  name: string
  isPro: number
  proExpires: Date | null
}): Promise<string> {
  const id = await insertUser({ name: opts.name })
  await q("UPDATE users SET is_pro = ?, pro_expires = ? WHERE id = ?", [
    opts.isPro,
    opts.proExpires,
    id,
  ])
  return id
}

interface UserRow {
  id: string
  name: string | null
  isPro: boolean
  isProFlagged: boolean
}

interface UsersBody {
  data: UserRow[]
  total: number
}

async function insertSubscription(
  userId: string,
  status: "active" | "cancelled" | "expired",
  expiresAt: Date | null,
): Promise<void> {
  await q(
    `INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at, created_at)
     VALUES (UUID(), ?, 'yearly', ?, NOW(), ?, NOW())`,
    [userId, status, expiresAt],
  )
}

beforeEach(async () => {
  await seedFixtures()
})

describe("会员口径：筛选 pro=1", () => {
  it("**只返回此刻仍然有效的会员**：过期未回收的标记不算，永久会员算", async () => {
    const active = await makeMember({ name: "有效会员", isPro: 1, proExpires: daysFromNow(10) })
    const stale = await makeMember({ name: "过期标记", isPro: 1, proExpires: daysFromNow(-1) })
    const forever = await makeMember({ name: "永久会员", isPro: 1, proExpires: null })
    const free = await makeMember({ name: "免费用户", isPro: 0, proExpires: null })

    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<UsersBody>("/api/admin/users?pro=1&pageSize=100")
    const ids = res.body.data.map((u) => u.id)

    expect(ids).toContain(active)
    expect(ids, "没有到期时间 = 不设到期，仍算会员").toContain(forever)
    expect(ids, "过期未回收的标记不该算会员").not.toContain(stale)
    expect(ids).not.toContain(free)

    // total 用**独立写的 SQL** 算一遍再比：夹具里本来就有会员用户，
    // 写死一个数字只会让这条用例在夹具变化时莫名其妙地红
    const expected = Number(
      await scalar<number>(
        "SELECT COUNT(*) FROM users WHERE is_pro = 1 AND (pro_expires IS NULL OR pro_expires > NOW())",
      ),
    )
    expect(res.body.total).toBe(expected)
    // 而且列表里的 isPro 必须全部为真（否则"会员"这一列与筛选口径不一致）
    expect(res.body.data.every((u) => u.isPro)).toBe(true)
  })

  it("列表里的 isPro 是「此刻是否有效」，过期那种行另外标出标记未回收", async () => {
    const stale = await makeMember({ name: "过期标记", isPro: 1, proExpires: daysFromNow(-1) })
    const active = await makeMember({ name: "有效会员", isPro: 1, proExpires: daysFromNow(10) })

    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<UsersBody>("/api/admin/users?pageSize=100")
    const byId = new Map(res.body.data.map((u) => [u.id, u]))

    // 过期的：isPro 为 false（界面显示"已过期"），但标记确实是 1 —— 两件事都要给出来
    expect(byId.get(stale)?.isPro).toBe(false)
    expect(byId.get(stale)?.isProFlagged).toBe(true)
    // 有效的：isPro true
    expect(byId.get(active)?.isPro).toBe(true)
    expect(byId.get(active)?.isProFlagged).toBe(true)
  })

  it("用户详情同样按有效口径返回", async () => {
    const stale = await makeMember({ name: "过期标记", isPro: 1, proExpires: daysFromNow(-1) })
    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<{ data: { isPro: boolean; isProFlagged: boolean } }>(
      `/api/admin/users/${stale}`,
    )
    expect(res.body.data.isPro).toBe(false)
    expect(res.body.data.isProFlagged).toBe(true)
  })
})

describe("订阅口径：到期未清理的行不算生效", () => {
  /** 4 条订阅里只有 1 条真的生效（其余是各种"看起来像生效"的） */
  async function seedFourSubscriptions(): Promise<void> {
    const u = FIXTURE.userBuyer
    await insertSubscription(u, "active", daysFromNow(30)) // 真生效
    await insertSubscription(u, "active", daysFromNow(-1)) // 到期未回收
    await insertSubscription(u, "cancelled", daysFromNow(30))
    await insertSubscription(u, "expired", daysFromNow(30))
  }

  it("仪表盘「活跃订阅」只算真正生效的那条", async () => {
    await seedFourSubscriptions()
    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<{ totals: { activeSubscriptions: number } }>(
      "/api/admin/dashboard?range=all",
    )
    expect(res.body.totals.activeSubscriptions).toBe(1)
  })

  it("钻取闭环：列表 total 必须等于卡片上的数字（含「到期未回收」这种行也一样）", async () => {
    await seedFourSubscriptions()
    const api = ApiClient.asUser(await makeAdmin())
    const dash = await api.get<{ totals: { activeSubscriptions: number } }>(
      "/api/admin/dashboard?range=all",
    )
    const list = await api.get<{ total: number }>("/api/admin/subscriptions?status=active&pageSize=100")
    expect(list.body.total).toBe(dash.body.totals.activeSubscriptions)
  })

  it("**到期未清理的订阅不会从列表里消失**：不带 status 时仍能看到，并标成 expired_stale", async () => {
    await seedFourSubscriptions()
    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<{ data: Array<{ status: string; effectiveStatus: string; expiresAt: string }> }>(
      "/api/admin/subscriptions?pageSize=100",
    )
    expect(res.body.data.length).toBe(4)
    const stale = res.body.data.filter((r) => r.effectiveStatus === "expired_stale")
    expect(stale.length, "status=active 但已到期的那条要能被认出来").toBe(1)
    expect(stale[0].status).toBe("active")
    // 真生效的那条仍是 active
    expect(res.body.data.filter((r) => r.effectiveStatus === "active").length).toBe(1)
  })

  it("漏斗报表的付费步与仪表盘同口径", async () => {
    await seedFourSubscriptions()
    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<{ steps?: Array<{ key: string; value: number }> }>(
      "/api/admin/analytics/funnel?range=all",
    )
    const paid = res.body.steps?.find((s) => s.key === "paid")
    // 漏斗里有"付费"这一步（db 口径）；只断言它不把 4 条订阅都算成有效
    if (paid) expect(paid.value).toBeLessThanOrEqual(1)
  })
})

describe("会员标记：展示型接口也用同一口径", () => {
  it("支付订单列表里的「用户是会员」按有效口径算", async () => {
    const stale = await makeMember({ name: "过期标记买家", isPro: 1, proExpires: daysFromNow(-1) })
    await insertPaidOrder(stale, "yearly", 19900)

    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<{ data: Array<{ userId: string; userIsPro: unknown }> }>(
      "/api/admin/payment-orders?pageSize=100",
    )
    const row = res.body.data.find((r) => r.userId === stale)
    expect(row).toBeTruthy()
    // NOW() 在库侧算出来是 1/0
    expect(Number(row!.userIsPro)).toBe(0)
  })

  it("有效会员在同一个接口里仍然是 1（证明上面那个 0 不是「整个字段坏了」）", async () => {
    const active = await makeMember({ name: "有效买家", isPro: 1, proExpires: daysFromNow(10) })
    await insertPaidOrder(active, "yearly", 19900)

    const api = ApiClient.asUser(await makeAdmin())
    const res = await api.get<{ data: Array<{ userId: string; userIsPro: unknown }> }>(
      "/api/admin/payment-orders?pageSize=100",
    )
    const row = res.body.data.find((r) => r.userId === active)
    expect(Number(row!.userIsPro)).toBe(1)
  })
})
