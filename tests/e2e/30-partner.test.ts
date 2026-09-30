/**
 * 链路二之二：分销（合伙人）与提现
 *
 * 覆盖 佣金统计 → 佣金明细 → 提现 → 提现记录 的完整闭环。
 *
 * 环境前提（见 helpers/env.ts）：WECHAT_PAY_* 被全部置空，因此
 * `isWeChatPayConfigured()` 为 false，`wechatTransferBatch` 必然抛错。这恰好
 * 让我们可以确定性地覆盖「转账失败 → 佣金回滚」这条最容易出现资金事故的分支。
 * 真实打款成功分支只能靠生产侧人工/沙箱验证，不在这里假装覆盖。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertCommission, insertPractice, insertUser, setWechatOpenid } from "./helpers/factories"

const MIN_WITHDRAW = 5000

const PAST = new Date(Date.now() - 3600 * 1000)
const FUTURE = new Date(Date.now() + 15 * 24 * 3600 * 1000)

async function commissionStatus(id: string): Promise<string | undefined> {
  const row = await one<{ status: string }>(
    "SELECT status FROM partner_commissions WHERE id = ?",
    [id]
  )
  return row?.status
}

beforeEach(async () => {
  await seedFixtures()
})

describe("合伙人看板 /api/partner/dashboard", () => {
  it("未登录 → 401；未加入推广计划的注册用户 → 403（门禁是协议同意，不是付费）", async () => {
    expect((await ApiClient.anonymous().get("/api/partner/dashboard")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).get("/api/partner/dashboard")).status
    ).toBe(403)
  })

  it("合伙人：返还邀请码与三类佣金口径（已扣回不计入）", async () => {
    await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, 1000, {
      status: "available",
      commissionType: "first",
    })
    await insertCommission(FIXTURE.userPartner, FIXTURE.userBuyer, 600, {
      status: "cooling",
      commissionType: "renewal",
      availableAt: FUTURE,
    })
    await insertCommission(FIXTURE.userPartner, FIXTURE.userFree, 900, {
      status: "clawed_back",
      commissionType: "renewal",
    })

    const res = await ApiClient.asUser(FIXTURE.userPartner).get<{
      inviteCode: string
      totalEarned: number
      available: number
      cooling: number
      referredCount: number
      paidCount: number
    }>("/api/partner/dashboard")

    expect(res.status).toBe(200)
    expect(res.body.inviteCode).toBe(FIXTURE.inviteCodePartner)
    // totalEarned = available + cooling + withdrawn，唯独排除已扣回
    expect(res.body.totalEarned).toBe(1600)
    expect(res.body.available).toBe(1000)
    expect(res.body.cooling).toBe(600)
    // 被邀请人：userInvitee 与 userBuyer 的 referred_by 都是 userPartner
    expect(res.body.referredCount).toBe(2)
    // paidCount 只统计 first 类型佣金（首购付费人数）
    expect(res.body.paidCount).toBe(1)
  })

  it("读看板时会把已过冷却期的佣金解冻为 available", async () => {
    const id = await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, 1000, {
      status: "cooling",
      availableAt: PAST,
    })
    const notYet = await insertCommission(FIXTURE.userPartner, FIXTURE.userBuyer, 700, {
      status: "cooling",
      availableAt: FUTURE,
    })

    await ApiClient.asUser(FIXTURE.userPartner).get("/api/partner/dashboard")

    expect(await commissionStatus(id)).toBe("available")
    // 未到期的必须保持冷却，不能提前解冻
    expect(await commissionStatus(notYet)).toBe("cooling")
  })
})

describe("佣金明细 /api/partner/commissions", () => {
  it("未登录 → 401；未加入推广计划的注册用户 → 403（门禁是协议同意，不是付费）", async () => {
    expect((await ApiClient.anonymous().get("/api/partner/commissions")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).get("/api/partner/commissions")).status
    ).toBe(403)
  })

  it("只返回自己的佣金，且被邀请人手机号脱敏", async () => {
    await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, 1000, { status: "available" })
    await insertCommission(FIXTURE.userPartner, FIXTURE.userBuyer, 600, { status: "available" })
    // 别人的佣金不能串进来
    await insertCommission(FIXTURE.userBuyer, FIXTURE.userFree, 500, { status: "available" })

    const res = await ApiClient.asUser(FIXTURE.userPartner).get<{
      data: Array<{ referredUserPhone: string | null; commissionAmount: number }>
      page: number
      pageSize: number
    }>("/api/partner/commissions")

    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(2)
    expect(res.body.pageSize).toBe(20)
    for (const row of res.body.data) {
      expect(row.referredUserPhone).toMatch(/^\d{3}\*{4}\d{4}$/)
    }
    // 手机号明文绝不能出现在响应里
    expect(JSON.stringify(res.body)).not.toContain("13800000004")
  })

  it("翻到第二页返回空数组", async () => {
    await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, 1000)
    const res = await ApiClient.asUser(FIXTURE.userPartner).get<{ data: unknown[] }>(
      "/api/partner/commissions?page=2"
    )
    expect(res.body.data).toEqual([])
  })
})

describe("提现 /api/partner/withdraw", () => {
  it("未登录 → 401；未加入推广计划的注册用户 → 403（门禁是协议同意，不是付费）", async () => {
    expect(
      (await ApiClient.anonymous().post("/api/partner/withdraw", { amount: 5000 })).status
    ).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).post("/api/partner/withdraw", { amount: 5000 }))
        .status
    ).toBe(403)
  })

  it("未绑定微信 → 400（转账需要 openid）", async () => {
    await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, MIN_WITHDRAW)
    const res = await ApiClient.asUser(FIXTURE.userPartner).post<{ error?: string }>(
      "/api/partner/withdraw",
      { amount: MIN_WITHDRAW }
    )
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toContain("微信")
  })

  it("低于最低提现额 → 400，且不动佣金", async () => {
    await setWechatOpenid(FIXTURE.userPartner, "openid-partner-e2e")
    const id = await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, MIN_WITHDRAW)

    for (const amount of [0, -100, 4999, Number.NaN, 12.9]) {
      const res = await ApiClient.asUser(FIXTURE.userPartner).post("/api/partner/withdraw", {
        amount,
      })
      expect(res.status).toBe(400)
    }
    expect(await commissionStatus(id)).toBe("available")
  })

  it("没有可提现余额 → 400「可提现余额不足」", async () => {
    await setWechatOpenid(FIXTURE.userPartner, "openid-partner-e2e")
    // 冷却期未到，不算可提现
    await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, MIN_WITHDRAW, {
      status: "cooling",
      availableAt: FUTURE,
    })

    const res = await ApiClient.asUser(FIXTURE.userPartner).post<{ error?: string }>(
      "/api/partner/withdraw",
      { amount: MIN_WITHDRAW }
    )
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toContain("可提现余额不足")
  })

  it("不支持部分提现：请求金额必须等于实际可提总额", async () => {
    await setWechatOpenid(FIXTURE.userPartner, "openid-partner-e2e")
    const a = await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, 3000)
    const b = await insertCommission(FIXTURE.userPartner, FIXTURE.userBuyer, 3000)

    const res = await ApiClient.asUser(FIXTURE.userPartner).post<{ error?: string }>(
      "/api/partner/withdraw",
      { amount: 5000 }
    )
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toContain("全额提现")
    // 部分提现被拒后不能留下任何占用
    expect(await commissionStatus(a)).toBe("available")
    expect(await commissionStatus(b)).toBe("available")
  })

  it("直接提现时会把已到期的 cooling 佣金先解冻（不依赖先打开看板）", async () => {
    await setWechatOpenid(FIXTURE.userPartner, "openid-partner-e2e")
    await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, MIN_WITHDRAW, {
      status: "cooling",
      availableAt: PAST,
    })

    const res = await ApiClient.asUser(FIXTURE.userPartner).post<{ error?: string }>(
      "/api/partner/withdraw",
      { amount: MIN_WITHDRAW }
    )
    // 转账未配置 → 500，但「余额不足」这条错误绝不能再出现
    expect(res.status).toBe(500)
    expect(String(res.body.error)).not.toContain("余额不足")
  })

  it("转账失败：佣金回滚为 available，并落一条 failed 的提现记录", async () => {
    await setWechatOpenid(FIXTURE.userPartner, "openid-partner-e2e")
    const id = await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, MIN_WITHDRAW)

    const res = await ApiClient.asUser(FIXTURE.userPartner).post<{ error?: string }>(
      "/api/partner/withdraw",
      { amount: MIN_WITHDRAW }
    )
    expect(res.status).toBe(500)

    expect(await commissionStatus(id)).toBe("available")

    const req = await one<{ status: string; amount: number; fail_reason: string }>(
      "SELECT status, amount, fail_reason FROM withdrawal_requests WHERE partner_id = ?",
      [FIXTURE.userPartner]
    )
    expect(req?.status).toBe("failed")
    expect(Number(req?.amount)).toBe(MIN_WITHDRAW)
    expect(String(req?.fail_reason)).toContain("微信支付未配置")
  })

  it("回滚只恢复本次占用的佣金：历史已打款批次不得被退回 available", async () => {
    await setWechatOpenid(FIXTURE.userPartner, "openid-partner-e2e")
    // 历史成功提现的佣金
    const historical = await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, 8000, {
      status: "withdrawn",
    })
    // 本次将要占用的佣金
    const current = await insertCommission(FIXTURE.userPartner, FIXTURE.userBuyer, MIN_WITHDRAW)

    const res = await ApiClient.asUser(FIXTURE.userPartner).post<{ error?: string }>(
      "/api/partner/withdraw",
      { amount: MIN_WITHDRAW }
    )
    expect(res.status).toBe(500)

    expect(await commissionStatus(current)).toBe("available")
    // 这一条是回归断言：早先按 (partnerId, status='withdrawn') 无差别回滚的实现
    // 会把它也退回 available，同一笔佣金可以被重复提现。
    expect(await commissionStatus(historical)).toBe("withdrawn")
  })

  it("并发提现只有一个能占用佣金（行锁 + 全额校验）", async () => {
    await setWechatOpenid(FIXTURE.userPartner, "openid-partner-e2e")
    await insertCommission(FIXTURE.userPartner, FIXTURE.userInvitee, MIN_WITHDRAW)

    const api = ApiClient.asUser(FIXTURE.userPartner)
    const results = await Promise.all([
      api.post("/api/partner/withdraw", { amount: MIN_WITHDRAW }),
      api.post("/api/partner/withdraw", { amount: MIN_WITHDRAW }),
      api.post("/api/partner/withdraw", { amount: MIN_WITHDRAW }),
    ])

    // 转账全都失败（未配置）：抢到行锁的那个 500，没抢到的判余额不足 400。
    for (const r of results) expect([400, 500]).toContain(r.status)

    const row = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM partner_commissions WHERE partner_id = ? AND status = 'available'",
      [FIXTURE.userPartner]
    )
    expect(Number(row?.c)).toBe(1)

    // 失败的提现记录条数应等于实际发起并回滚的次数，且都不能是 completed
    const reqs = await q<{ status: string }[]>(
      "SELECT status FROM withdrawal_requests WHERE partner_id = ?",
      [FIXTURE.userPartner]
    )
    for (const r of reqs) expect(r.status).not.toBe("completed")
  })
})

describe("提现记录 /api/partner/withdrawals", () => {
  it("未登录 → 401；未加入推广计划的注册用户 → 403（门禁是协议同意，不是付费）", async () => {
    expect((await ApiClient.anonymous().get("/api/partner/withdrawals")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).get("/api/partner/withdrawals")).status
    ).toBe(403)
  })

  it("只返回自己的提现记录，按创建时间倒序", async () => {
    await q(
      `INSERT INTO withdrawal_requests (id, partner_id, amount, status, partner_trade_no, fail_reason)
       VALUES (UUID(), ?, 5000, 'failed', 'WD-OLD', '旧'), (UUID(), ?, 6000, 'failed', 'WD-NEW', '新')`,
      [FIXTURE.userPartner, FIXTURE.userPartner]
    )
    // 别人的记录不能串进来
    await q(
      `INSERT INTO withdrawal_requests (id, partner_id, amount, status, partner_trade_no)
       VALUES (UUID(), ?, 9999, 'completed', 'WD-OTHER')`,
      [FIXTURE.userBuyer]
    )

    const res = await ApiClient.asUser(FIXTURE.userPartner).get<{
      data: Array<{ amount: number; partnerTradeNo: string }>
    }>("/api/partner/withdrawals")

    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(2)
    expect(JSON.stringify(res.body)).not.toContain("WD-OTHER")
  })
})

/**
 * 待跟进邀请记录 /api/partner/invites（2026-10-01 新增）
 *
 * 这个接口存在的理由：看板只给两个**总数**，总数能让推广员知道成绩，
 * 但**不能让他做任何事** —— 他不知道该跟进谁。所以这里守三件事：
 *
 *   1. `practiced` —— 注册了但一句都没练的人，是最该被提醒的那批
 *   2. `daysLeft` / `expired` —— **唯一的紧迫性来源**：归因窗口 90 天，
 *      过了这个点这个人再付款也不产生佣金
 *   3. `paid` 的口径必须与看板的 `paidCount` **完全一致**，
 *      否则列表说 3 人未付费、统计说付费 2 人，推广员会先怀疑平台克扣
 */
describe("待跟进邀请记录 /api/partner/invites", () => {
  const DAY = 24 * 3600 * 1000
  const BASE = "/api/partner/invites"

  interface InviteRow {
    userId: string
    phone: string | null
    registeredAt: string
    practiced: boolean
    paid: boolean
    daysLeft: number | null
    expired: boolean
  }
  interface InviteBody {
    data: InviteRow[]
    total: number
    attributionWindowDays: number
    summary: {
      total: number
      paidCount: number
      pendingCount: number
      pendingInWindow: number
    }
  }

  it("未登录 → 401；未加入推广计划的注册用户 → 403", async () => {
    expect((await ApiClient.anonymous().get(BASE)).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userFree).get(BASE)).status).toBe(403)
  })

  it("只返回**自己**邀请的人，且手机号脱敏", async () => {
    await insertUser({ referredBy: FIXTURE.userPartner, phone: "13812341234" })
    // 别人的被邀请人不能串进来
    await insertUser({ referredBy: FIXTURE.userBuyer, phone: "13999998888" })

    const res = await ApiClient.asUser(FIXTURE.userPartner).get<InviteBody>(BASE)
    expect(res.status).toBe(200)

    const phones = res.body.data.map((r) => r.phone)
    expect(phones).toContain("138****1234")
    // 脱敏后不应出现完整号码，也不应出现别人的号码
    expect(JSON.stringify(res.body)).not.toContain("13812341234")
    expect(JSON.stringify(res.body)).not.toContain("13999998888")
  })

  it("带齐三件事：是否练过 · 归因窗口剩余天数 · 是否已付费", async () => {
    const before = await ApiClient.asUser(FIXTURE.userPartner).get<InviteBody>(BASE)

    // 注册时间刻意取「10 天半之前」而不是整整 10 天：
    // MySQL 的 DATETIME 没有小数秒，写入时会**四舍五入**（不是截断），
    // 所以"恰好 10 天"会让剩余天数在 80/81 之间跳。取半天可以避开这个边界，
    // 见 db-datetime 相关单测。剩余 79.5 天 → ceil 得到 80。
    const fresh = await insertUser({
      referredBy: FIXTURE.userPartner,
      createdAt: new Date(Date.now() - (10 * DAY + 12 * 3600 * 1000)),
    })
    await insertPractice(fresh, FIXTURE.sentA1Plain)

    // 100 天前注册 → 窗口已过（他再付款也不会产生佣金）
    const stale = await insertUser({
      referredBy: FIXTURE.userPartner,
      createdAt: new Date(Date.now() - 100 * DAY),
    })

    // 已付费（有一笔未扣回的 first 佣金）
    const payer = await insertUser({ referredBy: FIXTURE.userPartner })
    await insertCommission(FIXTURE.userPartner, payer, 1000, {
      status: "available",
      commissionType: "first",
    })

    const after = await ApiClient.asUser(FIXTURE.userPartner).get<InviteBody>(BASE)
    expect(after.status).toBe(200)
    expect(after.body.attributionWindowDays).toBe(90)

    const byId = new Map(after.body.data.map((r) => [r.userId, r]))

    const f = byId.get(fresh)
    expect(f, "新邀请的人应当出现在列表里").toBeTruthy()
    expect(f!.practiced).toBe(true)
    expect(f!.paid).toBe(false)
    expect(f!.expired).toBe(false)
    expect(f!.daysLeft).toBe(80)

    const s = byId.get(stale)
    expect(s).toBeTruthy()
    expect(s!.practiced).toBe(false)
    expect(s!.expired).toBe(true)
    expect(s!.daysLeft).toBeLessThan(0)

    // 已付费的人不再显示倒计时（钱已经记上了，倒计时只会造成困惑）
    const p = byId.get(payer)
    expect(p).toBeTruthy()
    expect(p!.paid).toBe(true)
    expect(p!.daysLeft).toBeNull()

    // summary 必须是增量，而不是拍脑袋的绝对值
    expect(after.body.summary.total).toBe(before.body.summary.total + 3)
    expect(after.body.summary.paidCount).toBe(before.body.summary.paidCount + 1)
    expect(after.body.summary.pendingCount).toBe(after.body.summary.total - after.body.summary.paidCount)
    // 新增的 3 人里只有 fresh 是"未付费且窗口未过"
    expect(after.body.summary.pendingInWindow).toBe(before.body.summary.pendingInWindow + 1)
  })

  it("列表口径与看板一致：**已扣回的 first 佣金不算已付费**", async () => {
    // 这是本次修掉的一个真实缺陷：看板的 paidCount 原先没有排掉 clawed_back，
    // 于是被推荐人退款后仍被算作"已付费"，与邀请列表口径对不上。
    const refunded = await insertUser({ referredBy: FIXTURE.userPartner })
    await insertCommission(FIXTURE.userPartner, refunded, 1000, {
      status: "clawed_back",
      commissionType: "first",
    })

    const list = await ApiClient.asUser(FIXTURE.userPartner).get<InviteBody>(BASE)
    const row = list.body.data.find((r) => r.userId === refunded)
    expect(row, "被扣回的人仍应在列表里（他确实注册过）").toBeTruthy()
    expect(row!.paid).toBe(false)

    const dash = await ApiClient.asUser(FIXTURE.userPartner).get<{
      paidCount: number
      referredCount: number
    }>("/api/partner/dashboard")
    // 看板也必须是 0：两边口径不同源，推广员会先怀疑平台克扣
    expect(dash.body.paidCount).toBe(0)
  })
})
