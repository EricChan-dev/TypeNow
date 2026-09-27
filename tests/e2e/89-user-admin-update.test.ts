/**
 * 链路：后台修改用户（角色 / 会员 / 等级）的校验
 *
 * 这个接口前端**没有入口**（用户详情页只读），只能被手工构造的请求调用 ——
 * 正因为没人会顺手发现它出问题，这里把每一条守卫都钉住：
 * 类型范围、自我降权、最后一个管理员、isPro 与 proExpires 的一致性。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser } from "./helpers/factories"

async function makeAdmin(): Promise<string> {
  const id = await insertUser({ name: "e2e 用户管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

async function rowOf(id: string) {
  return one<{ role: string; is_pro: number; level: number; pro_expires: string | null }>(
    "SELECT role, is_pro, level, pro_expires FROM users WHERE id = ?",
    [id],
  )
}

beforeEach(async () => {
  await seedFixtures()
})

describe("PUT /api/admin/users/[id] 权限与入参校验", () => {
  it("未登录 → 401；非管理员 → 401", async () => {
    const patch = { json: { level: 2 } }
    expect(
      (await ApiClient.anonymous().request("PUT", `/api/admin/users/${FIXTURE.userFree}`, patch))
        .status,
    ).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).request("PUT", `/api/admin/users/${FIXTURE.userFree}`, patch))
        .status,
    ).toBe(401)
  })

  it("什么都不传 → 400（不能静默什么也不做，也不能 500）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, { json: {} })
    expect(res.status).toBe(400)
  })

  it("目标用户不存在 → 404", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request(
      "PUT",
      "/api/admin/users/00000000-0000-4000-8000-000000000000",
      { json: { level: 2 } },
    )
    expect(res.status).toBe(404)
  })

  it("非法 role → 400", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    for (const role of ["superadmin", "", 1, null]) {
      const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, { json: { role } })
      expect(res.status, `role=${JSON.stringify(role)} 应被拒`).toBe(400)
    }
  })

  it("isPro 只接受 0/1/true/false —— 原先 999 也能写进去", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    for (const bad of [999, -1, "1", 2, {}, []]) {
      const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
        json: { isPro: bad },
      })
      expect(res.status, `isPro=${JSON.stringify(bad)} 应被拒`).toBe(400)
    }

    // 合法值能过（带上 proExpires，见下一条的一致性要求）
    const ok = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
      json: { isPro: true, proExpires: "2030-01-01 00:00:00" },
    })
    expect(ok.status).toBe(200)
    expect((await rowOf(FIXTURE.userFree))?.is_pro).toBe(1)
  })

  it("level 只接受 0~1000 的整数 —— 原先字符串/小数/负数都能写进去", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    for (const bad of ["abc", 1.5, -1, 1001, true, {}]) {
      const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
        json: { level: bad },
      })
      expect(res.status, `level=${JSON.stringify(bad)} 应被拒`).toBe(400)
    }

    const ok = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, { json: { level: 5 } })
    expect(ok.status).toBe(200)
    expect((await rowOf(FIXTURE.userFree))?.level).toBe(5)
  })

  it("**把 isPro 置 1 却不给 proExpires → 400**（否则等于永久会员、永不自动过期）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
      json: { isPro: 1 },
    })
    expect(res.status).toBe(400)
    expect(String((res.body as { error?: string }).error)).toContain("proExpires")

    // 库里不能留下"会员但无到期时间"的状态
    expect((await rowOf(FIXTURE.userFree))?.is_pro).toBe(0)
  })

  it("给了 proExpires 就能开通；传一个很远的日期表示有意永久", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
      json: { isPro: 1, proExpires: "2099-12-31 23:59:59" },
    })
    expect(res.status).toBe(200)
    const row = await rowOf(FIXTURE.userFree)
    expect(row?.is_pro).toBe(1)
    // mysql2 把 DATETIME 还原成 Date；drizzle 侧只写到秒，所以按秒比对
    expect(new Date(row!.pro_expires!).getTime()).toBe(
      new Date("2099-12-31 23:59:59").getTime(),
    )
  })

  it("可以取消会员：isPro=0 同时清空 proExpires", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
      json: { isPro: 1, proExpires: "2030-01-01 00:00:00" },
    })
    const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
      json: { isPro: 0, proExpires: null },
    })
    expect(res.status).toBe(200)
    const row = await rowOf(FIXTURE.userFree)
    expect(row?.is_pro).toBe(0)
    expect(row?.pro_expires).toBeNull()
  })

  it("isPro=0 但没清 proExpires 时允许（到期时间留着，不影响非会员状态）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
      json: { isPro: 0 },
    })
    expect(res.status).toBe(200)
    expect((await rowOf(FIXTURE.userFree))?.is_pro).toBe(0)
  })

  it("非法 proExpires → 400", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, {
      json: { isPro: 1, proExpires: "不是时间" },
    })
    expect(res.status).toBe(400)
  })

  it("**禁止自我降权**（改了立刻失去后台访问权）", async () => {
    const me = await makeAdmin()
    const admin = ApiClient.asUser(me)
    const res = await admin.request("PUT", `/api/admin/users/${me}`, { json: { role: "user" } })
    expect(res.status).toBe(400)
    expect(String((res.body as { error?: string }).error)).toContain("自己")
    // 角色没变
    expect((await rowOf(me))?.role).toBe("admin")
  })

  it("**禁止降级最后一个管理员**（这里只有一位管理员）", async () => {
    const me = await makeAdmin()
    const other = await makeAdmin()
    // 现在有两位；先把 other 降级会被允许，降完只剩 me
    const ok = await ApiClient.asUser(other).request("PUT", `/api/admin/users/${other}`, {
      json: { role: "user" },
    })
    // other 改自己 → 被自我降权挡住（这正是上一条的行为）
    expect(ok.status).toBe(400)

    // 由 me 去降 other（不是自己，且管理员不止一位）→ 允许
    const allow = await ApiClient.asUser(me).request("PUT", `/api/admin/users/${other}`, {
      json: { role: "user" },
    })
    expect(allow.status).toBe(200)
    expect((await rowOf(other))?.role).toBe("user")

    // 此时 me 是最后一位管理员：别人（先提拔一个）来降他也应被拦
    const second = await makeAdmin()
    const blocked = await ApiClient.asUser(second).request("PUT", `/api/admin/users/${me}`, {
      json: { role: "user" },
    })
    // 还有两位管理员（me 与 second），所以这条允许 —— 用来区分"最后一个"的判断
    expect(blocked.status).toBe(200)

    // 现在只剩 second 一位；他去降自己 → 自我降权拦下
    const selfDown = await ApiClient.asUser(second).request("PUT", `/api/admin/users/${second}`, {
      json: { role: "user" },
    })
    expect(selfDown.status).toBe(400)
    expect((await rowOf(second))?.role).toBe("admin")
  })

  it("合法请求返回脱敏结果（不含 token / openid 原文 / 手机号）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request("PUT", `/api/admin/users/${FIXTURE.userFree}`, { json: { level: 3 } })
    const data = (res.body as { data: Record<string, unknown> }).data
    expect(data.level).toBe(3)
    expect(data.wechatAccessToken).toBeUndefined()
    expect(data.wechatRefreshToken).toBeUndefined()
    expect(data.phone).toBeUndefined()
    expect(data.email).toBeUndefined()
  })
})
