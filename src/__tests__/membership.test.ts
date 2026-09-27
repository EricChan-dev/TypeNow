/**
 * 会员 / 订阅「此刻是否生效」的纯函数单测。
 *
 * 背景（2026-09-27）：`users.is_pro` 是**标记**不是事实 —— 它只在
 * `checkAndExpirePro` 被调用的那一刻才回收，而后者只挂在三个接口上。
 * 于是再也不回来的用户会一直挂着 `is_pro=1`：线上实测 18 行过期体验会员
 * 把后台会员数从真实的 3 抬到 21。
 *
 * 这些边界容易写错且错了不报错，所以逐条钉住。
 */
import { describe, it, expect } from "vitest"
import { isProActive, isSubscriptionActive } from "@/lib/subscription"

const NOW = new Date("2026-09-28T12:00:00.000Z")
const past = new Date("2026-09-01T12:00:00.000Z")
const future = new Date("2026-10-28T12:00:00.000Z")

describe("isProActive", () => {
  it("标记为会员且未到期 → true", () => {
    expect(isProActive({ isPro: 1, proExpires: future }, NOW)).toBe(true)
  })

  it("标记为会员但已过期 → **false**（这就是让会员数虚高的那种行）", () => {
    expect(isProActive({ isPro: 1, proExpires: past }, NOW)).toBe(false)
  })

  it("**没有到期时间 = 不设到期，仍算会员**（历史遗留的永久会员）", () => {
    expect(isProActive({ isPro: 1, proExpires: null }, NOW)).toBe(true)
    expect(isProActive({ isPro: 1 }, NOW)).toBe(true)
  })

  it("没过期时间与过了期不同：这一条决定了「永久会员」会不会被算没", () => {
    // 两个都会让 checkAndExpirePro 不动它（它只处理 proExpires 非空且已过期），
    // 所以口径必须与之一致
    expect(isProActive({ isPro: 1, proExpires: null }, NOW)).toBe(true)
    expect(isProActive({ isPro: 1, proExpires: past }, NOW)).toBe(false)
  })

  it("非会员 → false（无论到期时间）", () => {
    expect(isProActive({ isPro: 0, proExpires: future }, NOW)).toBe(false)
    expect(isProActive({ isPro: 0, proExpires: null }, NOW)).toBe(false)
  })

  it("到期时间正好等于此刻 → false（边界取「仍然有效」而非「刚好失效」）", () => {
    expect(isProActive({ isPro: 1, proExpires: NOW }, NOW)).toBe(false)
    expect(isProActive({ isPro: 1, proExpires: new Date(NOW.getTime() + 1) }, NOW)).toBe(true)
  })

  it("字符串日期也接受（接口 JSON 里是字符串）", () => {
    expect(isProActive({ isPro: 1, proExpires: future.toISOString() }, NOW)).toBe(true)
    expect(isProActive({ isPro: 1, proExpires: past.toISOString() }, NOW)).toBe(false)
  })

  it("坏日期当作已失效，而不是抛错或默认有效", () => {
    expect(isProActive({ isPro: 1, proExpires: "不是时间" }, NOW)).toBe(false)
  })

  it("null / undefined 用户 → false", () => {
    expect(isProActive(null, NOW)).toBe(false)
    expect(isProActive(undefined, NOW)).toBe(false)
  })
})

describe("isSubscriptionActive", () => {
  it("active 且未到期 → true", () => {
    expect(isSubscriptionActive({ status: "active", expiresAt: future }, NOW)).toBe(true)
  })

  it("**status 写着 active 但已到期 → false**（到期未清理的那种行）", () => {
    expect(isSubscriptionActive({ status: "active", expiresAt: past }, NOW)).toBe(false)
  })

  it("cancelled / expired 一律 false（不看到期时间）", () => {
    expect(isSubscriptionActive({ status: "cancelled", expiresAt: future }, NOW)).toBe(false)
    expect(isSubscriptionActive({ status: "expired", expiresAt: future }, NOW)).toBe(false)
  })

  it("没有到期时间 = 不设到期，仍算生效", () => {
    expect(isSubscriptionActive({ status: "active", expiresAt: null }, NOW)).toBe(true)
  })

  it("坏日期与空值都是 false", () => {
    expect(isSubscriptionActive({ status: "active", expiresAt: "xx" }, NOW)).toBe(false)
    expect(isSubscriptionActive(null, NOW)).toBe(false)
  })
})
