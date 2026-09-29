/**
 * 邀请有礼规则层（src/lib/invite-rules.ts）。
 *
 * 这里看住三件容易在改动中被无声破坏的事：
 *   1. 受邀注册的天数 与 首购双方的天数 是两档不同的规则，不能互相串；
 *   2. 30 天归因窗口的**边界**（第 30 天当天仍算有效）；
 *   3. partner（终身会员）不参与天数制。
 *
 * 数值在 2026-09-29 收紧（注册 7→5；年卡 30/20→7/7；月卡 5/3→3/3），
 * 原因是原值一次年卡首购就送出 50 天会员，会让「拉人」比「卖课」更划算。
 * 断言尽量引用常量，避免下次调数值时漏改。
 */
import { describe, it, expect } from "vitest"
import {
  INVITE_REGISTER_DAYS,
  INVITE_ATTRIBUTION_DAYS,
  purchaseReward,
  isWithinAttributionWindow,
  inviteTrialExpiryFrom,
} from "@/lib/invite-rules"
import { TRIAL_DAYS } from "@/lib/trial-days"

const DAY_MS = 24 * 60 * 60 * 1000

describe("常量", () => {
  it("受邀注册 5 天、归因窗口 30 天", () => {
    expect(INVITE_REGISTER_DAYS).toBe(5)
    expect(INVITE_ATTRIBUTION_DAYS).toBe(30)
  })

  it("受邀注册必须比主动领取更长，否则没人愿意走邀请链接", () => {
    expect(INVITE_REGISTER_DAYS).toBeGreaterThan(TRIAL_DAYS)
  })
})

describe("purchaseReward", () => {
  it("年卡双方都比月卡多（引导推广年卡）", () => {
    const yearly = purchaseReward("yearly")!
    const monthly = purchaseReward("monthly")!
    expect(yearly.inviterDays).toBeGreaterThan(monthly.inviterDays)
    expect(yearly.inviteeDays).toBeGreaterThan(monthly.inviteeDays)
  })

  it("年卡双方各 7 天", () => {
    expect(purchaseReward("yearly")).toEqual({ inviterDays: 7, inviteeDays: 7 })
  })

  it("月卡与季卡都是双方各 3 天", () => {
    expect(purchaseReward("monthly")).toEqual({ inviterDays: 3, inviteeDays: 3 })
    expect(purchaseReward("quarterly")).toEqual({ inviterDays: 3, inviteeDays: 3 })
  })

  it("首购奖励是「双方对称」的 —— 不能只给邀请人", () => {
    for (const plan of ["monthly", "quarterly", "yearly"]) {
      const r = purchaseReward(plan)!
      expect(r.inviterDays).toBe(r.inviteeDays)
      expect(r.inviteeDays).toBeGreaterThan(0)
    }
  })

  it("partner（终身会员）不参与天数制", () => {
    expect(purchaseReward("partner")).toBeNull()
  })

  it("未知套餐返回 null，不抛异常", () => {
    expect(purchaseReward("")).toBeNull()
    expect(purchaseReward("lifetime")).toBeNull()
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
  it("正好 INVITE_REGISTER_DAYS 天之后", () => {
    const base = 1_700_000_000_000
    expect(inviteTrialExpiryFrom(base).getTime()).toBe(base + INVITE_REGISTER_DAYS * DAY_MS)
  })

  it("比主动领取更长（受邀更划算，才有动力用邀请链接）", () => {
    const base = Date.UTC(2026, 8, 26)
    expect(inviteTrialExpiryFrom(base).getTime()).toBeGreaterThan(base + TRIAL_DAYS * DAY_MS)
  })
})
