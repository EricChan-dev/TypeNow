import { describe, it, expect } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, scalar } from "./helpers/db"
import { E2E_BASE_URL } from "./helpers/env"

describe("e2e 基建自检", () => {
  it("测试库确实连的是 typenow_test（防止误伤生产库）", async () => {
    const db = await scalar<string>("SELECT DATABASE()")
    expect(db).toBe("typenow_test")
  })

  it("夹具已写入", async () => {
    expect(await scalar<number>("SELECT COUNT(*) FROM courses")).toBe(2)
    expect(await scalar<number>("SELECT COUNT(*) FROM users")).toBe(5)
    expect(await scalar<number>("SELECT COUNT(*) FROM sentences")).toBe(5)
  })

  it("服务端在 NODE_ENV=development 下运行（支付模拟与 dev 会话的前提）", async () => {
    const res = await fetch(`${E2E_BASE_URL}/api/courses/list?pageSize=1`)
    expect(res.status).toBe(200)
  })

  it("dev 会话旁路可用（userFree 能读到自己的身份）", async () => {
    const c = ApiClient.asUser(FIXTURE.userFree)
    const res = await c.get<{ user: { id: string; name: string } | null }>("/api/auth/me")
    expect(res.status).toBe(200)
    expect(res.body.user?.id).toBe(FIXTURE.userFree)
  })

  it("未登录时 /api/auth/me 返回 user:null 而不是 401", async () => {
    const res = await ApiClient.anonymous().get<{ user: unknown }>("/api/auth/me")
    expect(res.status).toBe(200)
    expect(res.body.user).toBeNull()
  })
})
