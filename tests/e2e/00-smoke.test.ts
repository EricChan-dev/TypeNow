import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, scalar, seedFixtures } from "./helpers/db"
import { E2E_BASE_URL } from "./helpers/env"

/**
 * 这个套件**必须自己重建夹具**，不能依赖 globalSetup 那一次。
 *
 * 它是唯一一个曾经不写 beforeEach(seedFixtures) 的套件，于是断言的是"全局初始化
 * 那一刻"的库状态。文件执行顺序一变（例如新增测试文件），它就会在别的套件
 * 已经造过数据之后运行，把 `users = 5` 断言成 6 而失败 —— 一次与它自身
 * 毫无关系的假红。加了自己这一份之后，顺序怎么变都成立。
 */
beforeEach(async () => {
  await seedFixtures()
})

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
