/**
 * 强制绑定手机号 · 撞号自动转移（/api/auth/bind/phone）
 *
 * 这是「防止同一个人用微信和手机号注册成两个号」的关键路径，而且它会在两个
 * 账号之间搬运唯一键（wechat_openid 是 UNIQUE）并作废会话 —— 这类操作一旦写错
 * 就是丢账号或串账号，所以必须有真实库上的端到端覆盖。
 *
 * 三种结果：
 *   · 手机号没人用        → 直接绑到当前（微信）账号
 *   · 撞号 + 壳号无数据   → 把微信身份转到手机号账号，壳号清空，会话切过去
 *   · 撞号 + 壳号有数据   → 拒绝（自动转移会把这些记录留在被清空的壳号上）
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import {
  insertPractice,
  insertSession,
  insertUser,
  insertVerificationCode,
  nextPhone,
} from "./helpers/factories"

const CODE = "246810"

beforeEach(async () => {
  await seedFixtures()
})

async function phoneAccount(phone: string, name = "手机号用户") {
  return insertUser({ phone, name })
}

async function wechatShell(openid: string, name = "微信壳账号") {
  return insertUser({ phone: null, wechatOpenid: openid, name })
}

const row = (id: string) =>
  one<{ phone: string | null; wechat_openid: string | null; name: string | null }>(
    "SELECT phone, wechat_openid, name FROM users WHERE id = ?",
    [id],
  )

describe("绑定手机号 · 手机号没人用过", () => {
  it("直接绑到当前账号，openid 不动", async () => {
    const phone = nextPhone()
    const shell = await wechatShell(`openid-${crypto.randomUUID()}`)
    await insertVerificationCode(phone, CODE)

    const res = await ApiClient.asUser(shell).post<{ success: boolean; switched?: boolean }>(
      "/api/auth/bind/phone",
      { phone, code: CODE },
    )
    expect(res.status).toBe(200)
    expect(res.body.switched).toBeUndefined()

    const r = await row(shell)
    expect(r?.phone).toBe(phone)
    expect(r?.wechat_openid).not.toBeNull()
  })
})

describe("绑定手机号 · 撞号且微信壳账号还没有练习数据", () => {
  it("把微信身份转到手机号账号，壳账号被清空，并切换会话", async () => {
    const phone = nextPhone()
    const openid = `openid-${crypto.randomUUID()}`
    const target = await phoneAccount(phone)
    const shell = await wechatShell(openid)
    await insertSession(shell)
    await insertVerificationCode(phone, CODE)

    const api = ApiClient.asUser(shell)
    const res = await api.post<{ success: boolean; switched?: boolean }>(
      "/api/auth/bind/phone",
      { phone, code: CODE },
    )
    expect(res.status).toBe(200)
    expect(res.body.switched).toBe(true)

    // 微信身份挂到了手机号账号上（这样以后用微信登录也进这个账号）
    const t = await row(target)
    expect(t?.wechat_openid).toBe(openid)
    // 手机号账号原有的手机号与昵称没被动
    expect(t?.phone).toBe(phone)
    expect(t?.name).toBe("手机号用户")

    // 壳账号被清空：手机号没写进去、openid 已归还、昵称变成注销占位
    const s = await row(shell)
    expect(s?.phone).toBeNull()
    expect(s?.wechat_openid).toBeNull()
    expect(s?.name).toBe("已注销用户")

    // 壳账号的旧会话被作废（避免旧 cookie 还能用它）
    const sessions = await one<{ c: number }>(
      "SELECT COUNT(*) c FROM sessions WHERE user_id = ?",
      [shell],
    )
    expect(Number(sessions?.c)).toBe(0)
  })

  it("手机号账号已绑另一个微信号 → 409，且两个账号都不动", async () => {
    const phone = nextPhone()
    const target = await insertUser({ phone, name: "手机号用户", wechatOpenid: `openid-${crypto.randomUUID()}` })
    const targetOpenid = (await row(target))?.wechat_openid
    const shell = await wechatShell(`openid-${crypto.randomUUID()}`)
    await insertVerificationCode(phone, CODE)

    const res = await ApiClient.asUser(shell).post<{ error: string; code: string }>(
      "/api/auth/bind/phone",
      { phone, code: CODE },
    )
    expect(res.status).toBe(409)
    expect(res.body.code).toBe("PHONE_TAKEN")
    expect(res.body.error).toContain("另一个微信")

    expect((await row(target))?.wechat_openid).toBe(targetOpenid)
    expect((await row(shell))?.phone).toBeNull()
  })
})

describe("绑定手机号 · 撞号但微信壳账号已经练过", () => {
  it("拒绝并说明原因（自动转移会把练习记录留在被清空的账号上）", async () => {
    const phone = nextPhone()
    const target = await phoneAccount(phone)
    const shell = await wechatShell(`openid-${crypto.randomUUID()}`)
    await insertPractice(shell, FIXTURE.sentA1Plain)
    await insertVerificationCode(phone, CODE)

    const res = await ApiClient.asUser(shell).post<{ error: string; code: string }>(
      "/api/auth/bind/phone",
      { phone, code: CODE },
    )
    expect(res.status).toBe(409)
    expect(res.body.code).toBe("PHONE_TAKEN")
    expect(res.body.error).toContain("练过")

    // 两个账号都不许被动：壳账号的 openid 仍在、手机号账号没拿到 openid
    expect((await row(shell))?.wechat_openid).not.toBeNull()
    expect((await row(target))?.wechat_openid).toBeNull()
  })
})

describe("绑定手机号 · 验证码", () => {
  it("验证码错误 → 400，且不做任何转移", async () => {
    const phone = nextPhone()
    const target = await phoneAccount(phone)
    const shell = await wechatShell(`openid-${crypto.randomUUID()}`)
    await insertVerificationCode(phone, CODE)

    const res = await ApiClient.asUser(shell).post("/api/auth/bind/phone", {
      phone,
      code: "000000",
    })
    expect(res.status).toBe(400)
    expect((await row(shell))?.wechat_openid).not.toBeNull()
    expect((await row(target))?.wechat_openid).toBeNull()
  })
})
