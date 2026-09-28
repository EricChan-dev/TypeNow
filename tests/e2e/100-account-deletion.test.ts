/**
 * 自助注销 /api/user/delete
 *
 * 注销是不可逆操作，所以这里既验证"该清的清干净"，也验证"该拦的拦住" ——
 * 后者尤其重要：有未结佣金的合伙人一旦注销，partner_id 会变成一个再也没人
 * 能登录的内部 id，那笔钱就永久卡死了。
 *
 * 口径的完整说明见 src/lib/account-deletion；隐私政策的表述必须与它一致。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import {
  insertCommission,
  insertPractice,
  insertSession,
  insertUser,
  nextPhone,
} from "./helpers/factories"
import { DELETED_USER_NAME, DELETION_CONFIRM_PHRASE } from "@/lib/account-deletion"

const ENDPOINT = "/api/user/delete"

beforeEach(async () => {
  await seedFixtures()
})

/** 造一个"信息齐全"的账号：手机号、微信、邀请码、会员、钻石、头像。 */
async function seedRichUser(): Promise<{ userId: string; phone: string; openid: string }> {
  const phone = nextPhone()
  const openid = `openid-${crypto.randomUUID()}`
  const userId = await insertUser({
    phone,
    wechatOpenid: openid,
    name: "待注销用户",
    isPro: 1,
    proExpires: new Date(Date.now() + 30 * 86400_000),
    inviteCode: `DEL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    referredBy: FIXTURE.userPartner,
  })
  await q("UPDATE users SET avatar = ?, diamonds = ?, email = ? WHERE id = ?", [
    "data:image/png;base64,AAAA",
    120,
    "bye@example.com",
    userId,
  ])
  return { userId, phone, openid }
}

describe("注销 /api/user/delete", () => {
  it("未登录 → 401", async () => {
    const res = await ApiClient.anonymous().post(ENDPOINT, { confirm: DELETION_CONFIRM_PHRASE })
    expect(res.status).toBe(401)
  })

  it("确认词不匹配 → 400，且账号信息原样未动", async () => {
    const { userId, phone } = await seedRichUser()
    const api = ApiClient.asUser(userId)

    for (const bad of ["", "注销", "确认注销", null]) {
      const res = await api.post(ENDPOINT, { confirm: bad })
      expect(res.status).toBe(400)
    }

    const row = await one<{ phone: string | null; name: string | null; diamonds: number }>(
      "SELECT phone, name, diamonds FROM users WHERE id = ?",
      [userId],
    )
    expect(row?.phone).toBe(phone)
    expect(row?.name).toBe("待注销用户")
    expect(Number(row?.diamonds)).toBe(120)
  })

  it("正常注销 → 200：清空账户信息、删掉自有内容与会话，保留练习记录", async () => {
    const { userId, phone } = await seedRichUser()
    const api = ApiClient.asUser(userId)

    // 前置数据：一条会话、一条该手机号的验证码、生词本与笔记各一条、一条练习记录
    await insertSession(userId)
    await q(
      "INSERT INTO verification_codes (id, phone, code, ip, expires_at) VALUES (UUID(), ?, '123456', '127.0.0.1', ?)",
      [phone, new Date(Date.now() + 300_000)],
    )
    await q("INSERT INTO wordbook_items (id, user_id, word) VALUES (UUID(), ?, 'hello')", [userId])
    await q(
      "INSERT INTO user_notes (id, user_id, title, content) VALUES (UUID(), ?, 'n', 'c')",
      [userId],
    )
    await insertPractice(userId, FIXTURE.sentA1Plain)

    const res = await api.post<{ success: boolean }>(ENDPOINT, { confirm: DELETION_CONFIRM_PHRASE })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // ── 该清的：直接标识、凭据、关系、权益 ──
    const row = await one<Record<string, unknown>>(
      `SELECT phone, email, wechat_openid, wechat_unionid, avatar, invite_code, referred_by,
              signup_source, is_pro, pro_expires, is_partner, diamonds, role, name
       FROM users WHERE id = ?`,
      [userId],
    )
    expect(row?.phone).toBeNull()
    expect(row?.email).toBeNull()
    expect(row?.wechat_openid).toBeNull()
    expect(row?.wechat_unionid).toBeNull()
    expect(row?.avatar).toBeNull()
    expect(row?.invite_code).toBeNull()
    expect(row?.referred_by).toBeNull()
    expect(row?.signup_source).toBeNull()
    expect(Number(row?.is_pro)).toBe(0)
    expect(row?.pro_expires).toBeNull()
    expect(Number(row?.is_partner)).toBe(0)
    expect(Number(row?.diamonds)).toBe(0)
    expect(row?.role).toBe("user")
    expect(row?.name).toBe(DELETED_USER_NAME)

    // ── 该删的：会话（全端登出）、验证码（含手机号与 IP）、自有内容 ──
    const sessions = await one<{ c: number }>("SELECT COUNT(*) c FROM sessions WHERE user_id = ?", [userId])
    expect(Number(sessions?.c)).toBe(0)
    const codes = await one<{ c: number }>("SELECT COUNT(*) c FROM verification_codes WHERE phone = ?", [phone])
    expect(Number(codes?.c)).toBe(0)
    const words = await one<{ c: number }>("SELECT COUNT(*) c FROM wordbook_items WHERE user_id = ?", [userId])
    expect(Number(words?.c)).toBe(0)
    const notes = await one<{ c: number }>("SELECT COUNT(*) c FROM user_notes WHERE user_id = ?", [userId])
    expect(Number(notes?.c)).toBe(0)

    // ── 该留的：练习记录（去标识化后作为统计口径） ──
    const practice = await one<{ c: number }>("SELECT COUNT(*) c FROM practice_records WHERE user_id = ?", [userId])
    expect(Number(practice?.c)).toBe(1)

    // ── 同一个手机号可以重新注册（否则这条 UNIQUE 会把人永久挡在门外） ──
    const reuse = await insertUser({ phone, name: "重新注册" })
    expect(reuse).not.toBe(userId)
  })

  it("管理员 → 409，且账号未被清空", async () => {
    const userId = await insertUser({ name: "管理员", phone: nextPhone() })
    await q("UPDATE users SET role = 'admin' WHERE id = ?", [userId])

    const res = await ApiClient.asUser(userId).post<{ error: string }>(ENDPOINT, {
      confirm: DELETION_CONFIRM_PHRASE,
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain("管理员")

    const row = await one<{ role: string; phone: string | null }>(
      "SELECT role, phone FROM users WHERE id = ?",
      [userId],
    )
    expect(row?.role).toBe("admin")
    expect(row?.phone).not.toBeNull()
  })

  it("有未结佣金的合伙人 → 409（钱会卡在一个没人能登录的 id 上）", async () => {
    const userId = await insertUser({ name: "合伙人", phone: nextPhone(), isPartner: 1 })
    await insertCommission(userId, FIXTURE.userFree, 50, { status: "available" })

    const res = await ApiClient.asUser(userId).post<{ error: string }>(ENDPOINT, {
      confirm: DELETION_CONFIRM_PHRASE,
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain("佣金")
  })

  it("佣金已结清（withdrawn / clawed_back）的合伙人可以注销", async () => {
    const userId = await insertUser({ name: "已结清合伙人", phone: nextPhone(), isPartner: 1 })
    await insertCommission(userId, FIXTURE.userFree, 50, { status: "withdrawn" })
    await insertCommission(userId, FIXTURE.userPro, 30, { status: "clawed_back" })

    const res = await ApiClient.asUser(userId).post(ENDPOINT, { confirm: DELETION_CONFIRM_PHRASE })
    expect(res.status).toBe(200)
  })
})
