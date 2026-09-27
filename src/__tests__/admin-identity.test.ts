/**
 * 「谁是管理员」的唯一定义（src/lib/admin-identity.ts）。
 *
 * 为什么值得单独测：这条规则此前在四处各写了一遍，而它们**真的漂移了** ——
 * /api/auth/me 曾在 development 下无条件认一个硬编码手机号（连 ADMIN_PHONES
 * 都不看），而 proxy.ts 与 requireAdmin 完全没有这个兜底。结果是开发态
 * "前端说你是管理员、后台接口全 401"，两边各说各话。
 *
 * 所以这里的重点是：**两条规则的优先级、dev 兜底的边界、以及"没配就是不启用"**。
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { getAdminPhones, isAdminUser, judgeAdmin } from "@/lib/admin-identity"

/**
 * NODE_ENV 在 Next 的类型里是只读的，直接赋值编译不过；用 vitest 的 stubEnv
 * （它在内部用 defineProperty 处理，并且 unstub 后能干净还原）。
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("judgeAdmin", () => {
  it("role=admin 命中，via=role", () => {
    vi.stubEnv("ADMIN_PHONES", "")
    const v = judgeAdmin({ role: "admin", phone: null })
    expect(v).toEqual({ isAdmin: true, via: "role" })
  })

  it("手机号在白名单里命中，via=phone", () => {
    vi.stubEnv("ADMIN_PHONES", "13800000000, 13911111111")
    const v = judgeAdmin({ role: "user", phone: "13911111111" })
    expect(v).toEqual({ isAdmin: true, via: "phone" })
  })

  it("白名单里的手机号也做 trim（配置里带空格是最常见的写错方式）", () => {
    vi.stubEnv("ADMIN_PHONES", " 13800000000 , 13911111111 ")
    expect(judgeAdmin({ role: "user", phone: "13800000000" }).isAdmin).toBe(true)
  })

  it("普通用户不是管理员", () => {
    vi.stubEnv("ADMIN_PHONES", "13800000000")
    expect(judgeAdmin({ role: "user", phone: "13700000000" })).toEqual({
      isAdmin: false,
      via: null,
    })
  })

  it("null / undefined 不是管理员（未登录）", () => {
    expect(judgeAdmin(null).isAdmin).toBe(false)
    expect(judgeAdmin(undefined).isAdmin).toBe(false)
  })

  it("空手机号字符串不算命中（'' 与 null 都表示没有手机号）", () => {
    vi.stubEnv("ADMIN_PHONES", "")
    expect(judgeAdmin({ role: "user", phone: "" }).isAdmin).toBe(false)
  })

  it("role=admin 优先于手机号规则（via 要能指出靠哪条进来的）", () => {
    vi.stubEnv("ADMIN_PHONES", "13800000000")
    expect(judgeAdmin({ role: "admin", phone: "13800000000" }).via).toBe("role")
  })
})

describe("getAdminPhones 的 dev 兜底", () => {
  it("配了 ADMIN_PHONES 就用它，且**优先于** dev 兜底", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("ADMIN_PHONES", "13800000000")
    expect(getAdminPhones()).toEqual(["13800000000"])
  })

  it("development 且未配置时回落到兜底手机号（e2e / 本地开发靠它拿后台权限）", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("ADMIN_PHONES", "")
    expect(getAdminPhones()).toHaveLength(1)
  })

  it("**production 未配置时返回空数组** —— 兜底绝不能在生产生效", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_PHONES", "")
    expect(getAdminPhones()).toEqual([])
  })

  it("兜底手机号与测试夹具的号段（139xxxxxxxx）错开，避免测试用户被意外提权", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("ADMIN_PHONES", "")
    for (const p of getAdminPhones()) {
      expect(p.startsWith("139")).toBe(false)
    }
  })
})

describe("isAdminUser", () => {
  it("是 judgeAdmin 的布尔投影（两处判定不能出现分歧）", () => {
    vi.stubEnv("ADMIN_PHONES", "13800000000")
    const cases = [
      { role: "admin", phone: null },
      { role: "user", phone: "13800000000" },
      { role: "user", phone: "13700000000" },
      null,
    ]
    for (const c of cases) {
      expect(isAdminUser(c)).toBe(judgeAdmin(c).isAdmin)
    }
  })
})
