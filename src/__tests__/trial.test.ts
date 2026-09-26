/**
 * 体验会员（src/lib/trial.ts + src/lib/trial-days.ts）。
 *
 * 存在的理由：体验会员从「注册无条件送 3 天」改成「未受邀用户主动领取 5 天」，
 * 而领取是一次性权益 —— 这里看住两件事：
 *   1. 天数只有一个来源（服务端授予与客户端文案不会各说各话）；
 *   2. 注册时「受邀自动领取」必须同时写上 trial_claimed_at，
 *      否则受邀用户会在自动拿到之后**再手动领一次**，等于发两份。
 *
 * claimTrial 本身依赖数据库（条件更新 + affectedRows），不在单测范围；
 * 它的幂等性由 SQL 的 WHERE 条件保证，见 supabase/migrations/00012_trial_claim.sql。
 */
import { describe, it, expect } from "vitest"
import { TRIAL_DAYS, trialExpiryFrom, trialGrantFields } from "@/lib/trial"

const DAY_MS = 24 * 60 * 60 * 1000

describe("TRIAL_DAYS", () => {
  it("为 5 天", () => {
    expect(TRIAL_DAYS).toBe(5)
  })
})

describe("trialExpiryFrom", () => {
  it("从给定时刻起算，正好 TRIAL_DAYS 天之后", () => {
    const base = 1_700_000_000_000
    expect(trialExpiryFrom(base).getTime()).toBe(base + TRIAL_DAYS * DAY_MS)
  })

  it("是纯函数：同一入参得到同一结果，不读当前时钟", () => {
    const base = 1_700_000_000_000
    expect(trialExpiryFrom(base).getTime()).toBe(trialExpiryFrom(base).getTime())
  })

  it("跨月也算得对（用固定时间戳避免时区/月末陷阱）", () => {
    // 2026-01-30T00:00:00Z + 5 天 = 2026-02-04T00:00:00Z
    const jan30 = Date.UTC(2026, 0, 30)
    expect(trialExpiryFrom(jan30).toISOString()).toBe("2026-02-04T00:00:00.000Z")
  })
})

describe("trialGrantFields（注册时受邀自动领取）", () => {
  it("同时给出会员身份、到期时间与『已领取』标记", () => {
    const now = new Date("2026-09-26T10:00:00.000Z")
    const f = trialGrantFields(now)

    expect(f.isPro).toBe(1)
    expect(f.trialClaimedAt).toBe(now)
    expect(f.proExpires.getTime()).toBe(now.getTime() + TRIAL_DAYS * DAY_MS)
  })

  it("关键不变量：必须带上 trialClaimedAt，否则受邀用户能再领一次", () => {
    const f = trialGrantFields(new Date("2026-09-26T10:00:00.000Z"))
    expect(f.trialClaimedAt).toBeInstanceOf(Date)
    expect(f.trialClaimedAt).not.toBeNull()
  })
})
