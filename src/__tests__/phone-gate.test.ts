/**
 * 手机号强制绑定（src/lib/phone-gate.ts）。
 *
 * 撞号策略是这块的核心：**只有"壳账号还没有练习数据"时才允许自动转移**。
 * 一旦用户已经练过，自动转移会把记录留在被清空的壳账号上 —— 那是静默丢数据，
 * 比让人工介入糟得多。所以这里把闸门逐条钉住。
 */
import { describe, it, expect } from "vitest"
import * as mod from "@/lib/phone-gate"
import {
  decideBindCollision,
  needsPhoneBinding,
  loginBindPath,
  inheritReferral,
  isDevWechatOpenid,
} from "@/lib/phone-gate"

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

  it("拦截方式不含「独立落地页」语义：不再有 PHONE_BIND_PATH 这种'目的地'路径", () => {
    // 这条断言是给未来的人看的：曾经用 redirect 到一个独立绑定页，
    // 结果是「正在看的课/句都被拽走，绑完还得自己找回来」。
    // 后来改成全局弹窗（盖在 home/layout 上），再后来改成登录校验——
    // 现在是送去登录页的「验证码登录」tab（loginBindPath），
    // 复用用户本来就会用的表单，而不是一个只有绑定才出现的界面。
    // 所以这里钉的是：不要再冒出一个「绑定专用落地路径」。
    expect(Object.keys(mod)).not.toContain("PHONE_BIND_PATH")
  })
})

describe("loginBindPath", () => {
  it("不带 next 时只带 bind=1", () => {
    expect(loginBindPath()).toBe("/login?bind=1")
  })

  it("带 next 时原样带上（让用户绑完能回到他本来要去的地方）", () => {
    expect(loginBindPath("/home?login_success=wechat")).toBe(
      "/login?bind=1&next=%2Fhome%3Flogin_success%3Dwechat",
    )
  })

  it("next 里的 query 必须被编码，否则会串成外层参数", () => {
    // 不编码的话 `?next=/home?a=1` 里的 a=1 会被解析成绑定页自己的参数，
    // 回跳目标就丢了 —— 这正是 URLSearchParams 存在的理由。
    const path = loginBindPath("/a?b=1&c=2")
    expect(path.startsWith("/login?bind=1&next=")).toBe(true)
    expect(path).not.toContain("?b=1&c=2")
    expect(decodeURIComponent(path.split("next=")[1])).toBe("/a?b=1&c=2")
  })

  it("空字符串 next 不产生 next 参数（避免 ?next= 这种空壳）", () => {
    expect(loginBindPath("")).toBe("/login?bind=1")
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

  it("手机号账号挂的是 dev 旁路的假 openid → 视同未绑定，可转移", () => {
    // 真实案例：老板的手机号账号是本地开发连生产库调试时建的，挂着
    // dev_wechat_user。若把它当成「另一个微信号」，他扫自己的微信绑手机号
    // 会被无端拒绝，只能来找人工。dev_* 必须视同未绑定。
    for (const devOpenid of ["dev_wechat_user", "dev_oa_user"]) {
      expect(
        decideBindCollision({
          ...base,
          existingUserId: "phone-account",
          existingWechatOpenid: devOpenid,
        }),
      ).toEqual({ action: "transfer" })
    }
  })

  it("dev 假 openid 的判定只看 dev_ 前缀，真 openid 不受影响", () => {
    expect(isDevWechatOpenid("dev_wechat_user")).toBe(true)
    expect(isDevWechatOpenid("dev_oa_user")).toBe(true)
    expect(isDevWechatOpenid("oQxWvUtRpOnMlKjIgFeDcBa9876")).toBe(false)
    expect(isDevWechatOpenid(null)).toBe(false)
    expect(isDevWechatOpenid(undefined)).toBe(false)
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

describe("inheritReferral", () => {
  it("壳账号经邀请链接注册的归因，在转移时继承给没有归因的目标账号", () => {
    // 这是「把邀请码存下来对接推荐体系」的关键一步：归因记在壳账号上，
    // 转移只搬微信身份的话，归因会随壳账号一起被注销口径抹掉。
    expect(inheritReferral({ targetReferredBy: null, shellReferredBy: "inviter-1" })).toBe(
      "inviter-1",
    )
  })

  it("目标账号已有自己的归因时保持不动（先到的归因不作废）", () => {
    expect(inheritReferral({ targetReferredBy: "inviter-0", shellReferredBy: "inviter-1" })).toBe(
      "inviter-0",
    )
  })

  it("两边都没有归因 → null", () => {
    expect(inheritReferral({ targetReferredBy: null, shellReferredBy: null })).toBeNull()
  })
})
