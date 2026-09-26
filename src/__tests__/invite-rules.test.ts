/**
 * 邀请有礼规则层（src/lib/invite-rules.ts）。
 *
 * 这里看住三件容易在改动中被无声破坏的事：
 *   1. 受邀注册的 7 天 与 首购双方的天数 是两档不同的规则，不能互相串；
 *   2. 30 天归因窗口的**边界**（第 30 天当天仍算有效）；
 *   3. partner 套餐不参与天数制（它走现金佣金），否则就是双重让利。
 */
import { describe, it, expect } from "vitest"
import {
  INVITE_REGISTER_DAYS,
  INVITE_ATTRIBUTION_DAYS,
  purchaseReward,
  isWithinAttributionWindow,
  inviteTrialExpiryFrom,
} from "@/lib/invite-rules"

const DAY_MS = 24 * 60 * 60 * 1000

describe("常量", () => {
  it("受邀注册 7 天、归因窗口 30 天（对齐句乐部）", () => {
    expect(INVITE_REGISTER_DAYS).toBe(7)
    expect(INVITE_ATTRIBUTION_DAYS).toBe(30)
  })
})

describe("purchaseReward", () => {
  it("年卡双方都比月卡多（引导推广年卡）", () => {
    const yearly = purchaseReward("yearly")!
    const monthly = purchaseReward("monthly")!
    expect(yearly.inviterDays).toBeGreaterThan(monthly.inviterDays)
    expect(yearly.inviteeDays).toBeGreaterThan(monthly.inviteeDays)
  })

  it("年卡 30/20、月卡 5/3", () => {
    expect(purchaseReward("yearly")).toEqual({ inviterDays: 30, inviteeDays: 20 })
    expect(purchaseReward("monthly")).toEqual({ inviterDays: 5, inviteeDays: 3 })
  })

  it("partner 套餐不参与天数制（走现金佣金，避免双重让利）", () => {
    expect(purchaseReward("partner")).toBeNull()
  })

  it("未知套餐返回 null，不抛异常", () => {
    expect(purchaseReward("")).toBeNull()
    expect(purchaseReward("quarterly")).toBeNull()
  })
})

describe("isWithinAttributionWindow", () => {
  const now = new Date("2026-09-26T12:00:00.000Z")

  it("刚注册就在窗口内", () => {
    expect(isWithinAttributionWindow(new Date(now.getTime() - 1000), now)).toBe(true)
  })

  it("边界：正好第 30 天仍算有效", () => {
    expect(isWithinAttributionWindow(new Date(now.getTime() - 30 * DAY_MS), now)).toBe(true)
  })

  it("边界：超出 1 毫秒即失效", () => {
    expect(isWithinAttributionWindow(new Date(now.getTime() - 30 * DAY_MS - 1), now)).toBe(false)
  })

  it("远超窗口则失效", () => {
    expect(isWithinAttributionWindow(new Date(now.getTime() - 365 * DAY_MS), now)).toBe(false)
  })

  it("注册时间为空 → 放行（宁可发奖励，也不静默吞掉用户权益）", () => {
    expect(isWithinAttributionWindow(null, now)).toBe(true)
    expect(isWithinAttributionWindow(undefined, now)).toBe(true)
  })

  it("自定义窗口天数生效", () => {
    const tenDaysAgo = new Date(now.getTime() - 10 * DAY_MS)
    expect(isWithinAttributionWindow(tenDaysAgo, now, 7)).toBe(false)
    expect(isWithinAttributionWindow(tenDaysAgo, now, 14)).toBe(true)
  })
})

describe("inviteTrialExpiryFrom", () => {
  it("正好 7 天之后", () => {
    const base = 1_700_000_000_000
    expect(inviteTrialExpiryFrom(base).getTime()).toBe(base + 7 * DAY_MS)
  })

  it("比主动领取的 5 天更长（受邀更划算，才有动力用邀请链接）", () => {
    const base = Date.UTC(2026, 8, 26)
    expect(inviteTrialExpiryFrom(base).getTime()).toBeGreaterThan(base + 5 * DAY_MS)
  })
})
