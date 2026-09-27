/**
 * 后台 AI 接口配额（src/lib/admin-ai-quota.ts）。
 *
 * 这个模块的价值是"拦住失控的成本"，而它最容易以两种方式静默失效：
 *   1. 配额配得太大 —— 加了限流但等于没加；
 *   2. 按 IP 而不是按账号 —— 两个管理员互相挤掉配额，单个账号的循环却拦不住。
 * 所以测试盯的是配额的**量级与分组**，以及超限时的返回体能不能让人知道该等多久。
 */
import { describe, it, expect } from "vitest"
import {
  ADMIN_AI_QUOTAS,
  checkAdminAiQuota,
  quotaExceededBody,
  type AdminAiAction,
} from "@/lib/admin-ai-quota"

const ACTIONS = Object.keys(ADMIN_AI_QUOTAS) as AdminAiAction[]

/** 每个用例用独立 userId，避免内存限流桶在用例之间串味。 */
let seq = 0
function freshUser(): string {
  return `admin-${Date.now()}-${++seq}`
}

describe("ADMIN_AI_QUOTAS 配置", () => {
  it("5 个会花钱的动作都有配额（漏配一个就等于那个接口没限流）", () => {
    expect(ACTIONS.sort()).toEqual([
      "ai-extract-sentences",
      "course-ai-generate",
      "materials-analyze",
      "sentence-analyze",
      "sentence-split",
    ])
  })

  it("配额都是正整数，窗口都是正数", () => {
    for (const a of ACTIONS) {
      expect(ADMIN_AI_QUOTAS[a].max).toBeGreaterThan(0)
      expect(Number.isInteger(ADMIN_AI_QUOTAS[a].max)).toBe(true)
      expect(ADMIN_AI_QUOTAS[a].windowMs).toBeGreaterThan(0)
    }
  })

  it("批量动作的配额必须严格小于单条动作（否则限流等于没加）", () => {
    // 批量接口一次调用会分块请求几十次 LLM，配额必须比"点一下分析一句"小得多。
    // 如果哪天有人把它们配成一样大，这条会红。
    const bulk = [ADMIN_AI_QUOTAS["materials-analyze"], ADMIN_AI_QUOTAS["ai-extract-sentences"]]
    const single = [ADMIN_AI_QUOTAS["sentence-analyze"], ADMIN_AI_QUOTAS["sentence-split"]]
    for (const b of bulk) {
      for (const s of single) {
        expect(b.max).toBeLessThan(s.max)
      }
    }
  })

  it("批量动作配额不超过 20 次/窗口（否则拦不住一次误操作批量重试）", () => {
    expect(ADMIN_AI_QUOTAS["materials-analyze"].max).toBeLessThanOrEqual(20)
    expect(ADMIN_AI_QUOTAS["ai-extract-sentences"].max).toBeLessThanOrEqual(20)
  })
})

describe("checkAdminAiQuota", () => {
  it("配额内的调用一律放行，且不带错误信息", () => {
    const user = freshUser()
    for (let i = 0; i < ADMIN_AI_QUOTAS["sentence-analyze"].max; i++) {
      const r = checkAdminAiQuota("sentence-analyze", user)
      expect(r.allowed).toBe(true)
      expect(r.message).toBeUndefined()
    }
  })

  it("超出配额后拒绝，并给出 retryAfter 秒数与可读的说明", () => {
    const user = freshUser()
    const max = ADMIN_AI_QUOTAS["sentence-analyze"].max
    for (let i = 0; i < max; i++) checkAdminAiQuota("sentence-analyze", user)

    const r = checkAdminAiQuota("sentence-analyze", user)
    expect(r.allowed).toBe(false)
    expect(r.retryAfter).toBeGreaterThan(0)
    expect(r.message).toBeTruthy()
    // 说明里必须带上"多少分钟后重试"，否则使用者只会反复重试、把窗口越拖越长
    expect(r.message).toMatch(/分钟后重试/)
  })

  it("配额按账号隔离：一个账号用尽不影响另一个", () => {
    const a = freshUser()
    const b = freshUser()
    const max = ADMIN_AI_QUOTAS["sentence-split"].max
    for (let i = 0; i < max; i++) checkAdminAiQuota("sentence-split", a)

    expect(checkAdminAiQuota("sentence-split", a).allowed).toBe(false)
    // 这正是"按账号而不是按 IP"的要点：同一出口 IP 的另一个管理员不该被牵连
    expect(checkAdminAiQuota("sentence-split", b).allowed).toBe(true)
  })

  it("配额按动作隔离：用尽批量额度不影响单条额度", () => {
    const user = freshUser()
    const max = ADMIN_AI_QUOTAS["materials-analyze"].max
    for (let i = 0; i < max; i++) checkAdminAiQuota("materials-analyze", user)

    expect(checkAdminAiQuota("materials-analyze", user).allowed).toBe(false)
    expect(checkAdminAiQuota("sentence-analyze", user).allowed).toBe(true)
  })

  it("拒绝之后继续拒绝（不会因为再试一次就被放行）", () => {
    const user = freshUser()
    const max = ADMIN_AI_QUOTAS["course-ai-generate"].max
    for (let i = 0; i < max; i++) checkAdminAiQuota("course-ai-generate", user)
    for (let i = 0; i < 3; i++) {
      expect(checkAdminAiQuota("course-ai-generate", user).allowed).toBe(false)
    }
  })
})

describe("quotaExceededBody", () => {
  it("返回体带 error 与 retryAfter（前端可据此显示「稍后再试」）", () => {
    const body = quotaExceededBody({ allowed: false, retryAfter: 42, message: "太多了" })
    expect(body).toEqual({ error: "太多了", retryAfter: 42 })
  })

  it("message 缺失时给兜底文案，不会返回 undefined", () => {
    const body = quotaExceededBody({ allowed: false })
    expect(body.error).toBeTruthy()
    expect(body.error).not.toBe("undefined")
  })
})
