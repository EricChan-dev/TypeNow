/**
 * 链路一：登录 / 注册 / 账号
 *
 * 覆盖 发送验证码 → 校验验证码 → 建号或复用 → 种下会话 → /api/auth/me 的完整闭环，
 * 以及围绕它的三层限流、一次性验证码、邀请码归属。
 *
 * 环境前提（见 helpers/env.ts）：
 *   - NODE_ENV=development 且 DATABASE_URL 指向测试库，所以 send-sms / verify-code 里的
 *     `isDevMode()`（要求 !DATABASE_URL）为 false —— 走的是**真实数据库分支**，
 *     这正是要覆盖的路径。
 *   - ALIYUN_* 被清空，所以「验证码已发出去」这一步无法在测试里完成，用例改为
 *     直接插 verification_codes 行来构造「已发送」的前置状态；发送接口本身只覆盖
 *     校验与限流（含短信未配置时不落库）。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser } from "./helpers/factories"

const CODE_TTL_MS = 5 * 60 * 1000

/** 造一条「已发送」的验证码记录。默认未使用、5 分钟后过期。 */
async function insertCode(
  phone: string,
  code: string,
  opts: { used?: number; createdAt?: Date; expiresAt?: Date; ip?: string } = {}
): Promise<void> {
  await q(
    `INSERT INTO verification_codes (id, phone, code, ip, used, created_at, expires_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
    [
      phone,
      code,
      opts.ip ?? "",
      opts.used ?? 0,
      opts.createdAt ?? new Date(),
      opts.expiresAt ?? new Date(Date.now() + CODE_TTL_MS),
    ]
  )
}

/** 每个用例换一个 IP，避免共用进程内的 IP 限流桶互相干扰。 */
let ipSeq = 0
function nextIp(): string {
  ipSeq += 1
  return `203.0.113.${(ipSeq % 250) + 1}`
}
function headersFor(ip = nextIp()): Record<string, string> {
  return { "x-real-ip": ip }
}

beforeEach(async () => {
  await seedFixtures()
})

describe("发送验证码 /api/auth/send-sms", () => {
  it("手机号缺失或格式非法 → 400，且不落库", async () => {
    const api = ApiClient.anonymous()
    for (const body of [{}, { phone: "" }, { phone: "12345" }, { phone: "1663448201" }, { phone: "26634482010" }]) {
      const res = await api.post<{ error: string }>("/api/auth/send-sms", body, { headers: headersFor() })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe("请输入有效的手机号")
    }

    // 前后空格应该被 trim 后接受，不能因为空格判成非法号
    const spaced = await api.post<{ error: string }>(
      "/api/auth/send-sms",
      { phone: "  13800000009  " },
      { headers: headersFor() }
    )
    expect(spaced.status).not.toBe(400)

    const count = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM verification_codes WHERE phone IN ('', '12345', '1663448201', '26634482010')"
    )
    expect(Number(count?.c)).toBe(0)
  })

  it("请求体不是 JSON → 400「请求格式错误」", async () => {
    const res = await ApiClient.anonymous().request<{ error: string }>(
      "POST",
      "/api/auth/send-sms",
      { headers: { "Content-Type": "application/json", ...headersFor() } }
    )
    // 无 body 的 POST：request.json() 抛错 → 400
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("请求格式错误")
  })

  it("60 秒冷却：同一手机号刚发过 → 429，且 cooldown 是秒数而不是 8 小时", async () => {
    const phone = "13800000101"
    await insertCode(phone, "111111", { createdAt: new Date(), ip: "198.51.100.7" })

    const res = await ApiClient.anonymous().post<{ error: string; cooldown: number }>(
      "/api/auth/send-sms",
      { phone },
      { headers: headersFor() }
    )
    expect(res.status).toBe(429)
    // 关键回归：created_at(DB/应用写入) 与 Date.now() 必须同一时区口径。
    // 时区错位时这里会算出 28800 秒级别的剩余时间（用户要等 8 小时）。
    //
    // 上界取 61 而不是 60：DATETIME 只有秒精度，mysql2 写库时对毫秒做四舍五入
    // （实测 .5xx 会进位到下一秒），于是「刚插入」的行可能比 now 晚不到 1 秒，
    // Math.floor 得到 -1，remaining = 61。这不是时区问题，8 小时的错位依然会
    // 被这个断言抓到（28805 ≫ 61）。
    expect(res.body.cooldown).toBeGreaterThan(0)
    expect(res.body.cooldown).toBeLessThanOrEqual(61)
    expect(res.body.error).toContain("秒后再试")
  })

  it("同一手机号 1 小时 5 条 → 429「发送次数超限」", async () => {
    const phone = "13800000102"
    for (let i = 0; i < 5; i++) {
      await insertCode(phone, String(100000 + i), {
        createdAt: new Date(Date.now() - (10 + i) * 60_000), // 都在 1 小时外冷却、1 小时内
        ip: `198.51.100.${10 + i}`,
      })
    }

    const res = await ApiClient.anonymous().post<{ error: string }>(
      "/api/auth/send-sms",
      { phone },
      { headers: headersFor() }
    )
    expect(res.status).toBe(429)
    expect(res.body.error).toBe("发送次数超限，请1小时后再试")
  })

  it("同一手机号 24 小时 10 条 → 429「今日发送次数已达上限」", async () => {
    const phone = "13800000103"
    for (let i = 0; i < 10; i++) {
      await insertCode(phone, String(200000 + i), {
        createdAt: new Date(Date.now() - (2 * 3600_000 + i * 60_000)), // 2 小时前，仍在 24h 内
        ip: `198.51.100.${100 + i}`,
      })
    }

    const res = await ApiClient.anonymous().post<{ error: string }>(
      "/api/auth/send-sms",
      { phone },
      { headers: headersFor() }
    )
    expect(res.status).toBe(429)
    expect(res.body.error).toBe("今日发送次数已达上限，请明天再试")
  })

  it("同一 IP 1 分钟 3 条 → 429「请求过于频繁」", async () => {
    const ip = "198.51.100.200"
    for (let i = 0; i < 3; i++) {
      await insertCode(`1380000020${i}`, String(300000 + i), { createdAt: new Date(), ip })
    }

    const res = await ApiClient.anonymous().post<{ error: string }>(
      "/api/auth/send-sms",
      { phone: "13800000209" },
      { headers: headersFor(ip) }
    )
    expect(res.status).toBe(429)
    expect(res.body.error).toBe("请求过于频繁，请稍后再试")
  })

  it("限流全部通过但短信未配置 → 500，且不写入任何验证码记录", async () => {
    const phone = "13800000300"
    const before = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM verification_codes WHERE phone = ?",
      [phone]
    )
    expect(Number(before?.c)).toBe(0)

    const res = await ApiClient.anonymous().post<{ error: string }>(
      "/api/auth/send-sms",
      { phone },
      { headers: headersFor() }
    )
    // e2e 环境清空了 ALIYUN_*：发送失败绝不能留下一条「可用」的验证码
    expect(res.status).toBe(500)
    expect(res.body.error).toBe("短信服务未配置")

    const after = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM verification_codes WHERE phone = ?",
      [phone]
    )
    expect(Number(after?.c)).toBe(0)
  })
})

describe("验证码登录/注册 /api/auth/verify-code", () => {
  it("参数校验：手机号非法 / 验证码非 6 位 / 请求体非 JSON 一律 400", async () => {
    const api = ApiClient.anonymous()
    const cases: Array<[unknown, number]> = [
      [{ phone: "12345", code: "123456" }, 400],
      [{ phone: "13800000400", code: "12345" }, 400],
      [{ phone: "13800000400", code: "1234567" }, 400],
      [{ phone: "13800000400" }, 400],
    ]
    for (const [body, status] of cases) {
      const res = await api.post("/api/auth/verify-code", body, { headers: headersFor() })
      expect(res.status).toBe(status)
    }

    const noBody = await api.request(
      "POST",
      "/api/auth/verify-code",
      { headers: { "Content-Type": "application/json", ...headersFor() } }
    )
    expect(noBody.status).toBe(400)
  })

  it("没有下发过的验证码 → 400，且不建号", async () => {
    const phone = "13800000401"
    const res = await ApiClient.anonymous().post<{ error: string }>(
      "/api/auth/verify-code",
      { phone, code: "999999" },
      { headers: headersFor() }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("验证码错误或已过期")

    const user = await one("SELECT id FROM users WHERE phone = ?", [phone])
    expect(user).toBeUndefined()
  })

  it("验证码只能用一次：第二次提交 400", async () => {
    const phone = "13800000402"
    const ip = nextIp()
    await insertCode(phone, "424242", { ip })

    const first = await ApiClient.anonymous().post("/api/auth/verify-code", { phone, code: "424242" }, {
      headers: headersFor(ip),
    })
    expect(first.status).toBe(200)

    const second = await ApiClient.anonymous().post<{ error: string }>(
      "/api/auth/verify-code",
      { phone, code: "424242" },
      { headers: headersFor(ip) }
    )
    expect(second.status).toBe(400)
    expect(second.body.error).toBe("验证码错误或已过期")
  })

  it("过期验证码无效 → 400", async () => {
    const phone = "13800000403"
    await insertCode(phone, "434343", {
      createdAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() - 60_000),
    })

    const res = await ApiClient.anonymous().post<{ error: string }>(
      "/api/auth/verify-code",
      { phone, code: "434343" },
      { headers: headersFor() }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("验证码错误或已过期")
  })

  it("新手机号首次登录：建号 + 3 天试用 + 分配邀请码 + 种下会话", async () => {
    const phone = "13800000404"
    await insertCode(phone, "444444")

    const api = ApiClient.anonymous()
    const res = await api.post<{ success: boolean; user: { id: string; phone: string } }>(
      "/api/auth/verify-code",
      { phone, code: "444444" },
      { headers: headersFor() }
    )
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.user.phone).toBe(phone)

    const user = await one<{
      id: string
      is_pro: number
      pro_expires: Date
      invite_code: string | null
      referred_by: string | null
      name: string
    }>("SELECT id, is_pro, pro_expires, invite_code, referred_by, name FROM users WHERE phone = ?", [
      phone,
    ])
    expect(user?.id).toBe(res.body.user.id)
    expect(user?.is_pro).toBe(1)
    expect(user?.invite_code).toBeTruthy()
    expect(user?.referred_by).toBeNull()
    expect(user?.name).toMatch(/^用户\d{4}$/)

    // 新用户 3 天试用
    const trialDays = await one<{ d: number }>(
      "SELECT TIMESTAMPDIFF(HOUR, NOW(), pro_expires) AS d FROM users WHERE phone = ?",
      [phone]
    )
    expect(Number(trialDays?.d)).toBeGreaterThan(48)
    expect(Number(trialDays?.d)).toBeLessThanOrEqual(72)

    // 会话真的种下了，并且能读到自己的身份
    const me = await api.get<{ user: { id: string; is_pro: boolean } }>("/api/auth/me")
    expect(me.status).toBe(200)
    expect(me.body.user.id).toBe(res.body.user.id)
    expect(me.body.user.is_pro).toBe(true)
  })

  it("已存在的手机号：复用同一个账号，不动已有权益和邀请码", async () => {
    const phone = "13800000405"
    const existingId = await insertUser({
      phone,
      name: "老用户",
      isPro: 1,
      proExpires: new Date(Date.now() + 100 * 86400_000),
      inviteCode: "OLDCODE1",
    })
    await insertCode(phone, "454545")

    const api = ApiClient.anonymous()
    const res = await api.post<{ user: { id: string } }>(
      "/api/auth/verify-code",
      { phone, code: "454545" },
      { headers: headersFor() }
    )
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(existingId)

    const count = await one<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE phone = ?", [phone])
    expect(Number(count?.c)).toBe(1)

    const user = await one<{ invite_code: string; name: string; pro_expires: Date }>(
      "SELECT invite_code, name, pro_expires FROM users WHERE id = ?",
      [existingId]
    )
    expect(user?.invite_code).toBe("OLDCODE1")
    expect(user?.name).toBe("老用户")
    // 到期日不能被登录重置
    const days = await one<{ d: number }>(
      "SELECT TIMESTAMPDIFF(DAY, NOW(), pro_expires) AS d FROM users WHERE id = ?",
      [existingId]
    )
    expect(Number(days?.d)).toBeGreaterThan(95)
  })

  it("带有效 ref_code 注册：绑定邀请人，并给邀请人 +3 天试用、记一条任务日志", async () => {
    const partnerId = await insertUser({
      name: "邀请人",
      isPartner: 1,
      inviteCode: "PARTNER1",
      isPro: 1,
      proExpires: new Date(Date.now() + 30 * 86400_000),
    })
    const beforeDays = await one<{ d: number }>(
      "SELECT TIMESTAMPDIFF(HOUR, NOW(), pro_expires) AS d FROM users WHERE id = ?",
      [partnerId]
    )

    const phone = "13800000406"
    await insertCode(phone, "464646")

    const api = ApiClient.anonymous()
    api.setCookie("ref_code", "PARTNER1")
    const res = await api.post<{ user: { id: string } }>(
      "/api/auth/verify-code",
      { phone, code: "464646" },
      { headers: headersFor() }
    )
    expect(res.status).toBe(200)

    const newUser = await one<{ id: string; referred_by: string | null }>(
      "SELECT id, referred_by FROM users WHERE phone = ?",
      [phone]
    )
    expect(newUser?.id).toBe(res.body.user.id)
    expect(newUser?.referred_by).toBe(partnerId)

    // 邀请人 +3 天（原来的 30 天 → 33 天）
    const afterHours = await one<{ d: number }>(
      "SELECT TIMESTAMPDIFF(HOUR, NOW(), pro_expires) AS d FROM users WHERE id = ?",
      [partnerId]
    )
    expect(Number(afterHours?.d) - Number(beforeDays?.d)).toBeGreaterThanOrEqual(71)
    expect(Number(afterHours?.d) - Number(beforeDays?.d)).toBeLessThanOrEqual(73)

    const log = await one<{ task_type: string; reward_type: string; reward_amount: number; ref_id: string }>(
      "SELECT task_type, reward_type, reward_amount, ref_id FROM task_logs WHERE user_id = ?",
      [partnerId]
    )
    expect(log?.task_type).toBe("invite_register")
    expect(log?.reward_type).toBe("trial_days")
    expect(Number(log?.reward_amount)).toBe(3)
    expect(log?.ref_id).toBe(newUser?.id)

    // 被邀请人自己额外拿 3 天（3 天试用 + 3 天奖励 = 6 天）
    const inviteeHours = await one<{ d: number }>(
      "SELECT TIMESTAMPDIFF(HOUR, NOW(), pro_expires) AS d FROM users WHERE id = ?",
      [newUser?.id]
    )
    expect(Number(inviteeHours?.d)).toBeGreaterThan(120)
    expect(Number(inviteeHours?.d)).toBeLessThanOrEqual(144)
  })

  it("ref_code 不存在或格式不对：不绑定邀请人，也不报错", async () => {
    const phone = "13800000407"
    await insertCode(phone, "474747", { ip: "198.51.100.77" })

    const api = ApiClient.anonymous()
    api.setCookie("ref_code", "NOTEXIST")
    const res = await api.post("/api/auth/verify-code", { phone, code: "474747" }, {
      headers: headersFor("198.51.100.77"),
    })
    expect(res.status).toBe(200)

    const user = await one<{ referred_by: string | null }>(
      "SELECT referred_by FROM users WHERE phone = ?",
      [phone]
    )
    expect(user?.referred_by).toBeNull()
  })
})

describe("会话与账号状态 /api/auth/me", () => {
  it("未登录 → 200 且 user 为 null（不是 401，前端据此判断登录态）", async () => {
    const res = await ApiClient.anonymous().get<{ user: null }>("/api/auth/me")
    expect(res.status).toBe(200)
    expect(res.body.user).toBeNull()
  })

  it("真实 sessions 行的会话可用；过期会话不可用", async () => {
    const api = await ApiClient.asRealSession(FIXTURE.userPro)
    const ok = await api.get<{ user: { id: string } }>("/api/auth/me")
    expect(ok.body.user.id).toBe(FIXTURE.userPro)

    // 一条已过期的会话
    const expiredId = "ee000000-0000-4000-8000-00000000dead"
    await q("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
      expiredId,
      FIXTURE.userPro,
      new Date(Date.now() - 3600_000),
    ])
    const expired = ApiClient.anonymous()
    expired.setCookie("typenow_session", expiredId)
    const res = await expired.get<{ user: null }>("/api/auth/me")
    expect(res.body.user).toBeNull()
  })

  it("伪造的会话 cookie → 匿名", async () => {
    const forged = ApiClient.anonymous()
    forged.setCookie("typenow_session", "00000000-0000-4000-8000-000000000000")
    const res = await forged.get<{ user: null }>("/api/auth/me")
    expect(res.body.user).toBeNull()
  })

  it("会员口径：合伙人 → partner；有订阅的会员 → 订阅 plan；无订阅的会员 → trial", async () => {
    const partner = await ApiClient.asUser(FIXTURE.userPartner).get<{
      user: { is_partner: boolean; member_tier: string; is_pro: boolean }
    }>("/api/auth/me")
    expect(partner.body.user.is_partner).toBe(true)
    expect(partner.body.user.member_tier).toBe("partner")

    const trialUser = await insertUser({
      name: "试用会员",
      isPro: 1,
      proExpires: new Date(Date.now() + 2 * 86400_000),
    })
    const trial = await ApiClient.asUser(trialUser).get<{ user: { member_tier: string } }>("/api/auth/me")
    expect(trial.body.user.member_tier).toBe("trial")

    const monthlyUser = await insertUser({
      name: "月付会员",
      isPro: 1,
      proExpires: new Date(Date.now() + 30 * 86400_000),
    })
    await q(
      `INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at)
       VALUES (UUID(), ?, 'monthly', 'active', ?, ?)`,
      [monthlyUser, new Date(), new Date(Date.now() + 30 * 86400_000)]
    )
    const monthly = await ApiClient.asUser(monthlyUser).get<{ user: { member_tier: string } }>(
      "/api/auth/me"
    )
    expect(monthly.body.user.member_tier).toBe("monthly")

    const free = await ApiClient.asUser(FIXTURE.userFree).get<{
      user: { is_pro: boolean; member_tier: string }
    }>("/api/auth/me")
    expect(free.body.user.is_pro).toBe(false)
    expect(free.body.user.member_tier).toBe("free")
  })

  it("已过期会员读到 me 时被回收：is_pro 立刻变 false", async () => {
    const expiredId = await insertUser({
      name: "刚过期",
      isPro: 1,
      proExpires: new Date(Date.now() - 60_000),
    })
    const res = await ApiClient.asUser(expiredId).get<{ user: { is_pro: boolean } }>("/api/auth/me")
    expect(res.body.user.is_pro).toBe(false)

    const row = await one<{ is_pro: number; pro_expires: Date | null }>(
      "SELECT is_pro, pro_expires FROM users WHERE id = ?",
      [expiredId]
    )
    expect(row?.is_pro).toBe(0)
    expect(row?.pro_expires).toBeNull()
  })
})
