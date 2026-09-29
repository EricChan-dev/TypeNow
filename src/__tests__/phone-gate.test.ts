/**
 * 手机号强制绑定（src/lib/phone-gate.ts）。
 *
 * 撞号策略是这块的核心：**只有"壳账号还没有练习数据"时才允许自动转移**。
 * 一旦用户已经练过，自动转移会把记录留在被清空的壳账号上 —— 那是静默丢数据，
 * 比让人工介入糟得多。所以这里把闸门逐条钉住。
 */
import { describe, it, expect } from "vitest"
import { decideBindCollision, needsPhoneBinding, PHONE_BIND_PATH } from "@/lib/phone-gate"

const base = {
  currentUserId: "shell",
  currentWechatOpenid: "oWechatA",
  existingUserId: null as string | null,
  existingWechatOpenid: null as string | null,
  currentHasPracticeData: false,
}

describe("needsPhoneBinding", () => {
  it("没有手机号就要绑", () => {
    expect(needsPhoneBinding({ phone: null })).toBe(true)
    expect(needsPhoneBinding({ phone: "" })).toBe(true)
    expect(needsPhoneBinding({ phone: "   " })).toBe(true)
  })

  it("有手机号就放行", () => {
    expect(needsPhoneBinding({ phone: "13800000001" })).toBe(false)
  })

  it("开发态登录旁路永远放行（本地与 e2e 的账号没有手机号，不该被拦）", () => {
    expect(needsPhoneBinding({ phone: null, devBypass: true })).toBe(false)
  })

  it("落地路径是 /home 之外的一个独立页（否则会被重定向到自己）", () => {
    expect(PHONE_BIND_PATH).toBe("/bind-phone")
    expect(PHONE_BIND_PATH.startsWith("/home")).toBe(false)
  })
})

describe("decideBindCollision", () => {
  it("手机号没人用过 → 直接绑", () => {
    expect(decideBindCollision(base)).toEqual({ action: "bind" })
  })

  it("已经绑在自己身上 → 不重复绑", () => {
    expect(decideBindCollision({ ...base, existingUserId: "shell" })).toEqual({
      action: "already_bound",
    })
  })

  it("撞号且壳账号没有练习数据 → 转移（这是「防止两个号」能自动完成的关键）", () => {
    expect(
      decideBindCollision({
        ...base,
        existingUserId: "phone-account",
        existingWechatOpenid: null,
        currentHasPracticeData: false,
      }),
    ).toEqual({ action: "transfer" })
  })

  it("**撞号但壳账号已有练习数据 → 必须拒绝**（自动转移会静默丢记录）", () => {
    const v = decideBindCollision({
      ...base,
      existingUserId: "phone-account",
      currentHasPracticeData: true,
    })
    expect(v.action).toBe("refuse")
    if (v.action === "refuse") expect(v.reason).toContain("练过")
  })

  it("手机号账号已绑另一个微信号 → 拒绝（不能悄悄换掉别人的绑定）", () => {
    const v = decideBindCollision({
      ...base,
      existingUserId: "phone-account",
      existingWechatOpenid: "oWechatB",
    })
    expect(v.action).toBe("refuse")
    if (v.action === "refuse") expect(v.reason).toContain("另一个微信")
  })

  it("手机号账号绑的是**同一个**微信号 → 仍可转移（重复建号的清理场景）", () => {
    expect(
      decideBindCollision({
        ...base,
        existingUserId: "phone-account",
        existingWechatOpenid: "oWechatA",
      }),
    ).toEqual({ action: "transfer" })
  })

  it("拒绝优先于转移：有练习数据时，即使是同一个微信号也不自动动它", () => {
    const v = decideBindCollision({
      ...base,
      existingUserId: "phone-account",
      existingWechatOpenid: "oWechatA",
      currentHasPracticeData: true,
    })
    expect(v.action).toBe("refuse")
  })

  it("每个拒绝理由都是可照做的中文（不是「操作失败」）", () => {
    for (const input of [
      { ...base, existingUserId: "p", currentHasPracticeData: true },
      { ...base, existingUserId: "p", existingWechatOpenid: "oB" },
    ]) {
      const v = decideBindCollision(input)
      if (v.action === "refuse") {
        expect(v.reason.length).toBeGreaterThan(10)
        expect(v.reason).toMatch(/[\u4e00-\u9fa5]/)
      }
    }
  })
})
