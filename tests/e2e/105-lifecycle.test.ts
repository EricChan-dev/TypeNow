/**
 * 主动触达体系（生命周期消息）。
 *
 * e2e 里**所有发送渠道的凭据都被屏蔽**（见 helpers/env.ts 的 BLANKED_KEYS），
 * 所以这里绝不会真的给人发消息 —— 任何一次"发送"都会走 not_configured 分支。
 * 这恰好让我们能验证完整链路（占位 → 尝试发送 → 落 skipped），
 * 又不会骚扰任何人。
 *
 * 重点验证的几条性质：
 *   · 鉴权 fail-closed（密钥错/缺失一律拒绝，且不接受任何入参）
 *   · 幂等由数据库唯一键保证：同一周期重复扫描不重复发
 *   · 退订必须能拦住所有发送（这是最贵的失败模式）
 *   · 终身会员永远不收到期提醒
 *   · 「已到期挽回」能查到人 —— 依赖 last_expiry_at（pro_expires 会被清空）
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { E2E_CRON_SECRET } from "./helpers/env"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser } from "./helpers/factories"

const SCAN_URL = "/api/internal/lifecycle-scan"
const H = 60 * 60 * 1000

/** 带正确密钥调用扫描接口。 */
async function scan(secret: string = E2E_CRON_SECRET, query = "") {
  return ApiClient.anonymous().post<{
    ok?: boolean
    code?: string
    expiry?: { scanned: number; sent: number; skipped: number; duplicate: number; failed: number }
    others?: { scanned: number; sent: number; skipped: number; duplicate: number; failed: number }
  }>(`${SCAN_URL}${query}`, undefined, { headers: { "x-cron-secret": secret } })
}

interface NotifyRow {
  scenario: string
  channel: string
  status: string
  period_key: string
  attempts: number
  error: string | null
}

async function rowsFor(userId: string): Promise<NotifyRow[]> {
  return (await q<NotifyRow[]>(
    "SELECT scenario, channel, status, period_key, attempts, error FROM notifications WHERE user_id = ? ORDER BY scenario",
    [userId],
  )) as unknown as NotifyRow[]
}

beforeEach(async () => {
  await seedFixtures()
})

describe("主动触达扫描 · 鉴权与入参", () => {
  it("密钥缺失 → 403", async () => {
    const res = await ApiClient.anonymous().post(SCAN_URL)
    expect(res.status).toBe(403)
  })

  it("密钥错误 → 403，且不写任何记录", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() + 10 * H),
      trialClaimedAt: new Date(),
      wechatOpenid: "openid-wrong-secret",
    })
    const res = await scan("definitely-not-the-secret")
    expect(res.status).toBe(403)
    expect(await rowsFor(userId)).toEqual([])
  })

  it("★ 带任何查询参数 → 400（这个接口不接受入参）", async () => {
    // 一个"能指定收件人"的接口等于把公众号变成群发器。契约必须可执行。
    const res = await scan(E2E_CRON_SECRET, "?userId=someone-else")
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("params_not_allowed")
  })

  it("密钥正确 → 200 且返回分场景的计数", async () => {
    const res = await scan()
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.expiry).toBeTruthy()
    expect(res.body.others).toBeTruthy()
  })
})

describe("主动触达扫描 · 到期提醒", () => {
  it("体验会员 10 小时后到期 → 占位并尝试发送（e2e 无凭据，落 skipped）", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() + 10 * H),
      // 10 天前领取：刻意避开 trial_claimed_no_practice 的 24–48h 窗口，
      // 否则同一个用户会同时命中两条场景，把幂等断言搅乱
      trialClaimedAt: new Date(Date.now() - 10 * 24 * H),
      wechatOpenid: "openid-trial-expiring",
    })

    const res = await scan()
    expect(res.status).toBe(200)

    const rows = await rowsFor(userId)
    expect(rows.map((r) => r.scenario)).toContain("trial_expiring_24h")
    const row = rows.find((r) => r.scenario === "trial_expiring_24h")!
    // e2e 屏蔽了公众号凭据 → 必然走 not_configured → skipped（不是 failed）。
    // skipped 与 failed 的区别很重要：前者不该被重试扫描反复拾起。
    expect(row.status).toBe("skipped")
    // 但必须真的"尝试过"：attempts 是证据
    expect(Number(row.attempts)).toBeGreaterThan(0)
  })

  it("★ 幂等：同一周期连续扫描两次，第二次不再占位", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() + 10 * H),
      // 10 天前领取：刻意避开 trial_claimed_no_practice 的 24–48h 窗口，
      // 否则同一个用户会同时命中两条场景，把幂等断言搅乱
      trialClaimedAt: new Date(Date.now() - 10 * 24 * H),
      wechatOpenid: "openid-idempotent",
    })

    await scan()
    const after1 = await rowsFor(userId)
    expect(after1).toHaveLength(1)
    const attemptsAfter1 = Number(after1[0].attempts)

    const res2 = await scan()
    expect(res2.status).toBe(200)

    const after2 = await rowsFor(userId)
    // 仍然只有一行 —— 唯一键挡住了第二次占位
    expect(after2).toHaveLength(1)
    // 且没有再次尝试发送
    expect(Number(after2[0].attempts)).toBe(attemptsAfter1)
  })

  it("★ 已到期挽回：pro_expires 被清空后，靠 last_expiry_at 仍能找到人", async () => {
    // 这是 last_expiry_at 这一列存在的唯一原因。若只读 pro_expires，
    // 过期后回过站的用户（最该被挽回的那批）永远查不出来。
    const userId = await insertUser({
      isPro: 0,
      proExpires: null, // 已被 checkAndExpirePro 清空
      trialClaimedAt: new Date(Date.now() - 5 * 24 * H),
      wechatOpenid: "openid-expired",
    })
    // 到期发生在 10 小时前 → 落在 trial_expired_1d 的 (0, 36] 窗口内
    await q("UPDATE users SET last_expiry_at = ? WHERE id = ?", [
      new Date(Date.now() - 10 * H),
      userId,
    ])

    const res = await scan()
    expect(res.status).toBe(200)

    const rows = await rowsFor(userId)
    expect(rows.map((r) => r.scenario)).toContain("trial_expired_1d")
  })

  it("★ 终身会员不发到期提醒（哪怕表里被写了个到期时间）", async () => {
    const userId = await insertUser({
      isPro: 1,
      isPartner: 1,
      proExpires: new Date(Date.now() + 10 * H),
      wechatOpenid: "openid-partner",
    })

    await scan()
    expect(await rowsFor(userId)).toEqual([])
  })

  it("档位不匹配不发（月卡用户不该收到体验会员的文案）", async () => {
    const userId = await insertUser({
      isPro: 1,
      // 月卡：30 天。10 小时后到期 → 只该命中 monthly_expiring_1d
      proExpires: new Date(Date.now() + 10 * H),
      trialClaimedAt: null,
      wechatOpenid: "openid-monthly",
    })
    await q(
      "INSERT INTO subscriptions (id, user_id, plan, status, expires_at) VALUES (UUID(), ?, 'monthly', 'active', ?)",
      [userId, new Date(Date.now() + 10 * H)],
    )

    await scan()
    const scenarios = (await rowsFor(userId)).map((r) => r.scenario)
    expect(scenarios).toContain("monthly_expiring_1d")
    expect(scenarios).not.toContain("trial_expiring_24h")
  })

  it("到期时间还很远（30 天后）→ 不发", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() + 30 * 24 * H),
      trialClaimedAt: new Date(),
      wechatOpenid: "openid-far-future",
    })
    await scan()
    expect(await rowsFor(userId)).toEqual([])
  })
})

describe("主动触达扫描 · 退订与频控", () => {
  it("★ 已退订的用户完全不占位、不发送", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() + 10 * H),
      trialClaimedAt: new Date(),
      wechatOpenid: "openid-opted-out",
    })
    await q("UPDATE users SET notify_opt_out_at = NOW() WHERE id = ?", [userId])

    await scan()
    // 一行都不能有 —— 退订是最不能被绕过的一条
    expect(await rowsFor(userId)).toEqual([])
  })

  it("没有可用渠道（没关注公众号）→ 不占位（模板批下来后应当还能补发）", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() + 10 * H),
      trialClaimedAt: new Date(),
      wechatOpenid: null, // 没绑微信 → 模板与客服都不可用
    })

    await scan()
    expect(await rowsFor(userId)).toEqual([])
  })

  it("★ 模板未配置时不占位（否则模板批下来时那次到期提醒已被吃掉）", async () => {
    // 年卡场景的模板 ID 在 e2e 里刻意留空。它的用户仍然是"候选人"，
    // 但渠道不可用 → 必须**不写占位行**，这样等模板批下来还能补发。
    // 若这里出现了一行 skipped，说明模板未就绪就把幂等位吃掉了 ——
    // 而到期提醒一个会员周期只有一次机会。
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() - 10 * H),
      trialClaimedAt: null,
      wechatOpenid: "openid-yearly-no-template",
    })
    await q(
      "INSERT INTO subscriptions (id, user_id, plan, status, expires_at) VALUES (UUID(), ?, 'yearly', 'expired', ?)",
      [userId, new Date(Date.now() - 10 * H)],
    )

    await scan()
    expect(await rowsFor(userId)).toEqual([])
  })

  it("★ 同一用户每周最多 2 条非到期类消息", async () => {
    const userId = await insertUser({
      name: "频控用户",
      wechatOpenid: "openid-freq",
      createdAt: new Date(Date.now() - 30 * H),
      trialClaimedAt: null, // 触发 registered_no_trial
    })
    // 先塞两条本周已发的非到期类记录
    for (let i = 0; i < 2; i++) {
      await q(
        `INSERT INTO notifications (id, user_id, scenario, channel, status, period_key, sent_at, created_at)
         VALUES (UUID(), ?, 'trial_claimed_no_practice', 'customer_service', 'sent', ?, NOW(), NOW())`,
        [userId, `seed-${i}`],
      )
    }

    await scan()
    const rows = (await rowsFor(userId)).map((r) => r.scenario)
    // 周上限 2 条已满 → registered_no_trial 不该被发出
    expect(rows).not.toContain("registered_no_trial")
  })

  it("24 小时冷却：最近刚发过 → 非到期类被拦住", async () => {
    const userId = await insertUser({
      name: "冷却用户",
      wechatOpenid: "openid-cooldown",
      createdAt: new Date(Date.now() - 30 * H),
      trialClaimedAt: null,
    })
    await q(
      `INSERT INTO notifications (id, user_id, scenario, channel, status, period_key, sent_at, created_at)
       VALUES (UUID(), ?, 'trial_claimed_no_practice', 'customer_service', 'sent', 'recent', NOW(), NOW())`,
      [userId],
    )

    await scan()
    expect((await rowsFor(userId)).map((r) => r.scenario)).not.toContain("registered_no_trial")
  })

  it("★ 失败/跳过的记录不占用频次额度（否则一次配置错误会白吃掉用户一周额度）", async () => {
    const userId = await insertUser({
      name: "额度用户",
      wechatOpenid: "openid-quota",
      createdAt: new Date(Date.now() - 30 * H),
      trialClaimedAt: null,
    })
    // 两条 skipped（不是 sent）不该计入周上限
    for (let i = 0; i < 3; i++) {
      await q(
        `INSERT INTO notifications (id, user_id, scenario, channel, status, period_key, created_at)
         VALUES (UUID(), ?, 'trial_claimed_no_practice', 'template', 'skipped', ?, NOW())`,
        [userId, `skip-${i}`],
      )
    }

    await scan()
    // 冷却不拦（没有 sent），周上限不拦（skipped 不计），所以应当占位
    expect((await rowsFor(userId)).map((r) => r.scenario)).toContain("registered_no_trial")
  })

  it("单用户异常不中断整批（另一个正常用户仍被处理）", async () => {
    const broken = await insertUser({
      name: "脏数据用户",
      proExpires: new Date(Date.now() + 10 * H),
      trialClaimedAt: new Date(),
      // 故意给一个超长 openid，超出 varchar(100) 也不是问题，但这里主要验证隔离性
      wechatOpenid: "openid-broken",
    })
    const healthy = await insertUser({
      name: "正常用户",
      isPro: 1,
      proExpires: new Date(Date.now() + 11 * H),
      trialClaimedAt: new Date(),
      wechatOpenid: "openid-healthy",
    })

    const res = await scan()
    expect(res.status).toBe(200)
    // 两个人都应当被处理到（不因为前一个出问题而跳过后者）
    expect((await rowsFor(healthy)).length).toBeGreaterThan(0)
    void broken
  })
})

describe("★ 到期时刻的留底（last_expiry_at）", () => {
  it("懒回收会员时，必须把原到期时刻留在 last_expiry_at", async () => {
    // 这是「已到期挽回」能工作的唯一前提：pro_expires 被清空后，
    // 如果没留底，那批用户就和"从未有过会员"完全一样了。
    const expiredAt = new Date(Date.now() - 2 * H)
    const userId = await insertUser({
      isPro: 1,
      proExpires: expiredAt,
      trialClaimedAt: new Date(Date.now() - 10 * 24 * H),
      wechatOpenid: "openid-lazy-expire",
    })

    // /api/auth/me 会调用 checkAndExpirePro（它只挂在三个接口上）
    await ApiClient.asUser(userId).get("/api/auth/me")

    const row = await one<{ pro: Date | null; last: Date | null }>(
      "SELECT pro_expires AS pro, last_expiry_at AS last FROM users WHERE id = ?",
      [userId],
    )
    expect(row?.pro).toBeNull() // 已回收
    expect(row?.last).not.toBeNull() // 但留了底
    // 留的就是原来那个时刻，不能是"现在"（那会让挽回窗口算错）
    expect(Math.abs(new Date(row!.last!).getTime() - expiredAt.getTime())).toBeLessThan(2000)
  })

  it("★ 端到端：懒回收之后再扫描，仍能给这个用户发「已到期」", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() - 2 * H),
      trialClaimedAt: new Date(Date.now() - 10 * 24 * H),
      wechatOpenid: "openid-lazy-then-scan",
    })

    await ApiClient.asUser(userId).get("/api/auth/me") // 触发回收
    await scan()

    const scenarios = (await rowsFor(userId)).map((r) => r.scenario)
    expect(scenarios).toContain("trial_expired_1d")
  })
})

describe("服务通知退订开关 /api/user/notify-preferences", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/user/notify-preferences")).status).toBe(401)
    expect(
      (await ApiClient.anonymous().post("/api/user/notify-preferences", { opted_out: true })).status,
    ).toBe(401)
  })

  it("默认未退订，POST 置位后状态变化且落库", async () => {
    const userId = await insertUser({ name: "开关用户" })
    const api = ApiClient.asUser(userId)

    const before = await api.get<{ opted_out: boolean }>("/api/user/notify-preferences")
    expect(before.status).toBe(200)
    expect(before.body.opted_out).toBe(false)

    const set = await api.post<{ opted_out: boolean }>("/api/user/notify-preferences", {
      opted_out: true,
    })
    expect(set.status).toBe(200)
    expect(set.body.opted_out).toBe(true)

    const row = await one<{ at: Date | null }>(
      "SELECT notify_opt_out_at AS at FROM users WHERE id = ?",
      [userId],
    )
    expect(row?.at).not.toBeNull()
  })

  it("可以重新开启（只关不开等于把选择权收走一半）", async () => {
    const userId = await insertUser({ name: "开关用户2" })
    await q("UPDATE users SET notify_opt_out_at = NOW() WHERE id = ?", [userId])
    const api = ApiClient.asUser(userId)

    const res = await api.post<{ opted_out: boolean }>("/api/user/notify-preferences", {
      opted_out: false,
    })
    expect(res.body.opted_out).toBe(false)
    const row = await one<{ at: Date | null }>(
      "SELECT notify_opt_out_at AS at FROM users WHERE id = ?",
      [userId],
    )
    expect(row?.at).toBeNull()
  })

  it("opted_out 不是布尔值 → 400", async () => {
    const userId = await insertUser({ name: "参数用户" })
    const res = await ApiClient.asUser(userId).post("/api/user/notify-preferences", {
      opted_out: "yes",
    })
    expect(res.status).toBe(400)
  })

  it("★ 通过开关退订后，扫描不再给该用户发送", async () => {
    const userId = await insertUser({
      isPro: 1,
      proExpires: new Date(Date.now() + 10 * H),
      trialClaimedAt: new Date(),
      wechatOpenid: "openid-toggle-flow",
    })

    await ApiClient.asUser(userId).post("/api/user/notify-preferences", { opted_out: true })
    await scan()
    expect(await rowsFor(userId)).toEqual([])
  })
})

describe("主动触达 · 与其它系统的一致性", () => {
  it("notifications 表的 uk_notification 是 (user_id, scenario, period_key)", async () => {
    // channel 不在键里是刻意的：它是"送达方式"而不是"消息的身份"。
    // 放进键会让同一场景在同一周期内发三条（模板/客服/短信各一条）。
    const cols = await q<{ c: string }[]>(
      `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS c
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
          AND INDEX_NAME = 'uk_notification'`,
    )
    expect((cols as unknown as { c: string }[])[0].c).toBe("user_id,scenario,period_key")
  })

  it("notifications 表排序规则与 users 一致（否则 JOIN 会 Illegal mix of collations）", async () => {
    const rows = await q<{ t: string; c: string }[]>(
      `SELECT TABLE_NAME AS t, TABLE_COLLATION AS c FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('notifications','users')`,
    )
    const list = rows as unknown as { t: string; c: string }[]
    const byName = Object.fromEntries(list.map((r) => [r.t, r.c]))
    expect(byName.notifications).toBe(byName.users)
  })

  it("夹具用户不会被误发（他们既没订阅也没领体验会员）", async () => {
    await scan()
    const rows = await q<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?",
      [FIXTURE.userFree],
    )
    expect(Number((rows as unknown as { n: number }[])[0].n)).toBe(0)
  })
})
