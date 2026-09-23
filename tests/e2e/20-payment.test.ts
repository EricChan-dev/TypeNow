/**
 * 链路二之一：支付与订阅
 *
 * 覆盖 下单 → 回调 → 激活订阅 → 订阅查询/取消 的完整闭环。
 *
 * 环境前提（见 helpers/env.ts）：服务端 NODE_ENV=development，微信支付凭据被置空。
 * 于是 wechat-pay.ts 的三处「开发兜底」生效，这正是我们要覆盖的分支：
 *   - createNativeOrder 返回假 code_url（1 分钱测试价）
 *   - queryOrder 恒返回 NOTPAY
 *   - verifyNotifySignature 直接放行，decryptNotifyResource 走明文兜底
 * 生产侧的拒绝逻辑（未配置一律失败、明文报文必须拒绝）另由只读 smoke 覆盖。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import {
  insertCommission,
  insertPaidOrder,
  insertPendingOrder,
  insertUser,
} from "./helpers/factories"

const MONTHLY_DAYS = 30
const YEARLY_DAYS = 365

/** 组一个 v3 支付成功回调体。dev 下 ciphertext 直接就是明文 JSON。 */
function successNotify(outTradeNo: string, transactionId = "WX-TX-0001") {
  return {
    id: "notify-id",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    resource: {
      algorithm: "AEAD_AES_256_GCM",
      original_type: "transaction",
      ciphertext: JSON.stringify({
        out_trade_no: outTradeNo,
        transaction_id: transactionId,
        trade_state: "SUCCESS",
      }),
      nonce: "nonce",
      associated_data: "",
    },
  }
}

/** 支付回调里的佣金是 fire-and-forget 写的，断言前需要等它落库。 */
async function waitForCommission(
  partnerId: string,
  referredUserId: string,
  timeoutMs = 5000
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = await one(
      "SELECT * FROM partner_commissions WHERE partner_id = ? AND referred_user_id = ?",
      [partnerId, referredUserId]
    )
    if (row) return row
    await new Promise((r) => setTimeout(r, 100))
  }
  return undefined
}

beforeEach(async () => {
  await seedFixtures()
})

describe("下单 /api/payment/create-order", () => {
  it("未登录 → 401", async () => {
    const res = await ApiClient.anonymous().post("/api/payment/create-order", { plan: "monthly" })
    expect(res.status).toBe(401)
  })

  it("非法 plan → 400，且不落单", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).post("/api/payment/create-order", {
      plan: "lifetime",
    })
    expect(res.status).toBe(400)
    const row = await one<{ c: number }>("SELECT COUNT(*) AS c FROM payment_orders")
    expect(Number(row?.c)).toBe(0)
  })

  it("月付：开发价 1 分、返回二维码、落一条 pending 订单", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    const res = await api.post<{
      code_url: string
      out_trade_no: string
      amount: number
      plan: string
    }>("/api/payment/create-order", { plan: "monthly" })

    expect(res.status).toBe(200)
    expect(res.body.plan).toBe("monthly")
    expect(res.body.amount).toBe(1)
    expect(res.body.code_url).toContain("weixin://")
    expect(res.body.code_url).toContain(res.body.out_trade_no)

    const order = await one<{ user_id: string; status: string; amount: number; plan: string }>(
      "SELECT user_id, status, amount, plan FROM payment_orders WHERE out_trade_no = ?",
      [res.body.out_trade_no]
    )
    expect(order?.user_id).toBe(FIXTURE.userFree)
    expect(order?.status).toBe("pending")
    expect(Number(order?.amount)).toBe(1)
    expect(order?.plan).toBe("monthly")
  })

  it("订单有效期是下单后 2 小时（口径必须与 created_at 一致）", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    const res = await api.post<{ out_trade_no: string }>("/api/payment/create-order", {
      plan: "yearly",
    })
    const row = await one<{ diff: number }>(
      "SELECT TIMESTAMPDIFF(MINUTE, created_at, expires_at) AS diff FROM payment_orders WHERE out_trade_no = ?",
      [res.body.out_trade_no]
    )
    expect(Number(row?.diff)).toBe(120)
  })
})

describe("查询订单 /api/payment/order-status", () => {
  it("未登录 → 401；缺参数 → 400", async () => {
    expect((await ApiClient.anonymous().get("/api/payment/order-status")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).get("/api/payment/order-status")).status
    ).toBe(400)
  })

  it("别人的订单 → 404（不能通过 out_trade_no 探测他人订单）", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userBuyer, "monthly", 1)
    const res = await ApiClient.asUser(FIXTURE.userFree).get(
      `/api/payment/order-status?out_trade_no=${outTradeNo}`
    )
    expect(res.status).toBe(404)
  })

  it("未支付订单：微信侧仍 NOTPAY，订单保持 pending", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 1)
    const res = await ApiClient.asUser(FIXTURE.userFree).get<{ status: string }>(
      `/api/payment/order-status?out_trade_no=${outTradeNo}`
    )
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("pending")

    const row = await one<{ status: string; paid_at: Date | null }>(
      "SELECT status, paid_at FROM payment_orders WHERE out_trade_no = ?",
      [outTradeNo]
    )
    expect(row?.status).toBe("pending")
    expect(row?.paid_at).toBeNull()
  })

  it("已支付订单直接返回 paid", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 1)
    await q("UPDATE payment_orders SET status = 'paid', paid_at = NOW() WHERE out_trade_no = ?", [
      outTradeNo,
    ])
    const res = await ApiClient.asUser(FIXTURE.userFree).get<{ status: string }>(
      `/api/payment/order-status?out_trade_no=${outTradeNo}`
    )
    expect(res.body.status).toBe("paid")
  })
})

describe("支付回调 /api/payment/notify", () => {
  const notify = (body: unknown) =>
    ApiClient.anonymous().request<{ code: string }>("POST", "/api/payment/notify", { json: body })

  it("缺少 resource → 400，且订单不动", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 1)
    const res = await notify({ event_type: "TRANSACTION.SUCCESS" })
    expect(res.status).toBe(400)
    const row = await one<{ status: string }>(
      "SELECT status FROM payment_orders WHERE out_trade_no = ?",
      [outTradeNo]
    )
    expect(row?.status).toBe("pending")
  })

  it("未知订单 → 404", async () => {
    const res = await notify(successNotify("TYPENOW-NOT-EXIST"))
    expect(res.status).toBe(404)
  })

  it("非 SUCCESS 的状态 → 直接应答成功但不开通", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 1)
    const body = successNotify(outTradeNo)
    body.resource.ciphertext = JSON.stringify({
      out_trade_no: outTradeNo,
      transaction_id: "TX",
      trade_state: "NOTPAY",
    })
    const res = await notify(body)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe("SUCCESS")

    const row = await one<{ status: string }>(
      "SELECT status FROM payment_orders WHERE out_trade_no = ?",
      [outTradeNo]
    )
    expect(row?.status).toBe("pending")
    const sub = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(Number(sub?.c)).toBe(0)
  })

  it("月付成功：订单转 paid、开通 30 天会员、写入 transaction_id", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 2900)
    const res = await notify(successNotify(outTradeNo, "WX-TX-MONTHLY"))
    expect(res.status).toBe(200)
    expect(res.body.code).toBe("SUCCESS")

    const order = await one<{ status: string; transaction_id: string }>(
      "SELECT status, transaction_id FROM payment_orders WHERE out_trade_no = ?",
      [outTradeNo]
    )
    expect(order?.status).toBe("paid")
    expect(order?.transaction_id).toBe("WX-TX-MONTHLY")

    const sub = await one<{ plan: string; status: string; diff: number }>(
      `SELECT plan, status, TIMESTAMPDIFF(DAY, starts_at, expires_at) AS diff
       FROM subscriptions WHERE user_id = ?`,
      [FIXTURE.userFree]
    )
    expect(sub?.plan).toBe("monthly")
    expect(sub?.status).toBe("active")
    expect(Number(sub?.diff)).toBe(MONTHLY_DAYS)

    const user = await one<{ is_pro: number; pro_expires: Date }>(
      "SELECT is_pro, pro_expires FROM users WHERE id = ?",
      [FIXTURE.userFree]
    )
    expect(user?.is_pro).toBe(1)
    expect(new Date(user!.pro_expires).getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000)

    // 会员权益查询接口同步可见
    const status = await ApiClient.asUser(FIXTURE.userFree).get<{ hasActive: boolean; plan: string }>(
      "/api/subscription/status"
    )
    expect(status.body.hasActive).toBe(true)
    expect(status.body.plan).toBe("monthly")
  })

  it("年付成功：开通 365 天", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "yearly", 19900)
    await notify(successNotify(outTradeNo))
    const sub = await one<{ diff: number }>(
      "SELECT TIMESTAMPDIFF(DAY, starts_at, expires_at) AS diff FROM subscriptions WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(Number(sub?.diff)).toBe(YEARLY_DAYS)
  })

  it("重复回调只开通一次（幂等）", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 2900)
    const body = successNotify(outTradeNo)

    expect((await notify(body)).status).toBe(200)
    const first = await one<{ pro_expires: Date }>(
      "SELECT pro_expires FROM users WHERE id = ?",
      [FIXTURE.userFree]
    )

    expect((await notify(body)).status).toBe(200)
    expect((await notify(successNotify(outTradeNo, "WX-TX-REPLAY"))).status).toBe(200)

    const count = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(Number(count?.c)).toBe(1)

    const after = await one<{ pro_expires: Date }>(
      "SELECT pro_expires FROM users WHERE id = ?",
      [FIXTURE.userFree]
    )
    expect(new Date(after!.pro_expires).getTime()).toBe(new Date(first!.pro_expires).getTime())

    // 重复回调不得覆盖首次的 transaction_id
    const order = await one<{ transaction_id: string }>(
      "SELECT transaction_id FROM payment_orders WHERE out_trade_no = ?",
      [outTradeNo]
    )
    expect(order?.transaction_id).toBe("WX-TX-0001")
  })

  it("并发回调只开通一次（原子占用订单）", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 2900)
    const body = successNotify(outTradeNo)

    const results = await Promise.all(Array.from({ length: 6 }, () => notify(body)))
    for (const r of results) expect(r.status).toBe(200)

    const count = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(Number(count?.c)).toBe(1)
  })

  it("已有有效订阅时续费顺延，而不是覆盖到期日", async () => {
    const { outTradeNo: first } = await insertPendingOrder(FIXTURE.userFree, "monthly", 2900)
    await notify(successNotify(first))
    const { outTradeNo: second } = await insertPendingOrder(FIXTURE.userFree, "monthly", 2900)
    await notify(successNotify(second, "WX-TX-2"))

    const days = await one<{ max_exp: number; min_start: number }>(
      `SELECT TIMESTAMPDIFF(DAY, MIN(starts_at), MAX(expires_at)) AS max_exp,
              TIMESTAMPDIFF(DAY, MIN(starts_at), MIN(expires_at)) AS min_start
       FROM subscriptions WHERE user_id = ?`,
      [FIXTURE.userFree]
    )
    // 两次月付叠加：首单 30 天 + 第二单从首单到期日再 +30 天 = 共 60 天
    expect(Number(days?.max_exp)).toBe(60)
    expect(Number(days?.min_start)).toBe(30)
  })

  it("合伙人方案：开通合伙人身份、分配邀请码、写协议时间", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userBuyer, "partner", 39900)
    const before = await one<{ invite_code: string | null }>(
      "SELECT invite_code FROM users WHERE id = ?",
      [FIXTURE.userBuyer]
    )
    expect(before?.invite_code).toBe("BUYER001")

    await notify(successNotify(outTradeNo, "WX-TX-PARTNER"))

    const user = await one<{ is_partner: number; invite_code: string; partner_agreed_at: Date }>(
      "SELECT is_partner, invite_code, partner_agreed_at FROM users WHERE id = ?",
      [FIXTURE.userBuyer]
    )
    expect(user?.is_partner).toBe(1)
    // 已有邀请码必须保留，否则已发出去的邀请链接会失效
    expect(user?.invite_code).toBe("BUYER001")
    expect(user?.partner_agreed_at).not.toBeNull()

    // 合伙人有效期约 99 年
    const diff = await one<{ d: number }>(
      "SELECT TIMESTAMPDIFF(DAY, starts_at, expires_at) AS d FROM subscriptions WHERE user_id = ?",
      [FIXTURE.userBuyer]
    )
    // getPlanDurationDays("partner") = 365 * 99，不额外减 1
    expect(Number(diff?.d)).toBe(365 * 99)
  })

  // triggerCommission 是 fire-and-forget（activateSubscription 里 void 调用），
  // 所以这里用轮询等它落库，验证「被邀请人首单 → 邀请人拿到 50% 佣金」这条
  // 最核心的分销口径在生产代码里真的跑通了，而不只是 lib 层的单元测试。
  it("被邀请人首单支付成功后，邀请人拿到 50% 首单佣金（fire-and-forget 落库）", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userBuyer, "yearly", 19900)
    await notify(successNotify(outTradeNo, "WX-TX-COMMISSION"))

    const commission = await waitForCommission(FIXTURE.userPartner, FIXTURE.userBuyer)
    expect(commission).toBeDefined()
    expect(commission?.commission_type).toBe("first")
    expect(commission?.rate).toBe("0.50")
    expect(Number(commission?.commission_amount)).toBe(9950)
    expect(Number(commission?.gross_amount)).toBe(19900)
    // 新佣金先进入冷却期，不能立刻提现
    expect(commission?.status).toBe("cooling")
  })
})

describe("订阅查询与取消", () => {
  it("未登录一律 401", async () => {
    expect((await ApiClient.anonymous().get("/api/subscription/status")).status).toBe(401)
    expect((await ApiClient.anonymous().get("/api/user/subscriptions")).status).toBe(401)
    expect((await ApiClient.anonymous().post("/api/subscription/cancel")).status).toBe(401)
  })

  it("无订阅时 status 返回 hasActive:false，列表为空", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    const status = await api.get<{ hasActive: boolean; plan: null }>("/api/subscription/status")
    expect(status.body.hasActive).toBe(false)
    expect(status.body.plan).toBeNull()

    const list = await api.get<{ data: unknown[] }>("/api/user/subscriptions")
    expect(list.body.data).toEqual([])
  })

  it("订阅列表按创建时间倒序返回", async () => {
    const { outTradeNo: a } = await insertPendingOrder(FIXTURE.userFree, "monthly", 2900)
    const notifyA = await ApiClient.anonymous().request("POST", "/api/payment/notify", {
      json: successNotify(a),
    })
    expect(notifyA.status).toBe(200)
    const { outTradeNo: b } = await insertPendingOrder(FIXTURE.userFree, "yearly", 19900)
    const notifyB = await ApiClient.anonymous().request("POST", "/api/payment/notify", {
      json: successNotify(b, "WX-TX-B"),
    })
    expect(notifyB.status).toBe(200)

    const list = await ApiClient.asUser(FIXTURE.userFree).get<{
      data: Array<{ plan: string; status: string; expiresAt: string }>
    }>("/api/user/subscriptions")
    expect(list.body.data.length).toBe(2)
    expect(list.body.data.map((r) => r.plan)).toEqual(["yearly", "monthly"])
    expect(list.body.data[0].expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("取消订阅：状态转 cancelled 并记录取消时间", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "monthly", 2900)
    const notifyRes = await ApiClient.anonymous().request("POST", "/api/payment/notify", {
      json: successNotify(outTradeNo),
    })
    expect(notifyRes.status).toBe(200)

    const res = await ApiClient.asUser(FIXTURE.userFree).post("/api/subscription/cancel")
    expect(res.status).toBe(200)

    const sub = await one<{ status: string; cancelled_at: Date }>(
      "SELECT status, cancelled_at FROM subscriptions WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(sub?.status).toBe("cancelled")
    expect(sub?.cancelled_at).not.toBeNull()
  })

  it("没有有效订阅时取消 → 500（当前实现直接抛错）", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).post("/api/subscription/cancel")
    // 这里只是把现状钉住：语义上更合理的是 404/400，但至少不能静默成功。
    expect(res.status).toBe(500)
  })

  // 这一条钉住的是「已确认但尚未收敛」的产品口径，不是期望行为：
  // 取消订阅会把该订单产生的佣金追回（clawed_back），却不退款、也不收回会员权益，
  // 而且 /api/subscription/cancel 目前没有前端调用方（src/proxy.ts 只把它列为关键写操作）。
  // 也就是说任何登录用户都能换掉自己一条 active 订阅，顺手抹掉合伙人的佣金而继续用 Pro。
  // 在补上「退款 / 权益回收 / 调用方」之前，先让测试把这个后果显式记录下来。
  it("[现状] 取消订阅会追回合伙人佣金，但不退会员权益", async () => {
    const partnerId = await insertUser({ name: "取消链路合伙人", isPartner: 1 })
    const buyerId = await insertUser({
      name: "取消链路购买者",
      isPro: 1,
      proExpires: new Date(Date.now() + 30 * 86400_000),
      referredBy: partnerId,
    })
    const { id: orderId } = await insertPaidOrder(buyerId, "yearly", 19900)
    await q(
      `INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at, payment_order_id)
       VALUES (UUID(), ?, 'yearly', 'active', ?, ?, ?)`,
      [buyerId, new Date(), new Date(Date.now() + 365 * 86400_000), orderId]
    )
    await insertCommission(partnerId, buyerId, 9950, { orderId, status: "available" })

    const res = await ApiClient.asUser(buyerId).post("/api/subscription/cancel")
    expect(res.status).toBe(200)

    const commission = await one<{ status: string }>(
      "SELECT status FROM partner_commissions WHERE order_id = ?",
      [orderId]
    )
    expect(commission?.status).toBe("clawed_back")

    const buyer = await one<{ is_pro: number; pro_expires: Date | null }>(
      "SELECT is_pro, pro_expires FROM users WHERE id = ?",
      [buyerId]
    )
    // 现状：权益没有被回收，会员仍然可用。
    expect(buyer?.is_pro).toBe(1)
    expect(buyer?.pro_expires).not.toBeNull()
  })
})

describe("会员到期回收", () => {
  it("到期后 subscription/status 会顺手回收权益", async () => {
    const userId = await insertUser({
      name: "到期用户",
      isPro: 1,
      proExpires: new Date(Date.now() - 60_000),
    })
    await q(
      `INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at)
       VALUES (UUID(), ?, 'monthly', 'active', ?, ?)`,
      [userId, new Date(Date.now() - 31 * 86400_000), new Date(Date.now() - 60_000)]
    )

    const res = await ApiClient.asUser(userId).get<{ hasActive: boolean }>(
      "/api/subscription/status"
    )
    expect(res.body.hasActive).toBe(false)

    const user = await one<{ is_pro: number; pro_expires: Date | null }>(
      "SELECT is_pro, pro_expires FROM users WHERE id = ?",
      [userId]
    )
    expect(user?.is_pro).toBe(0)
    expect(user?.pro_expires).toBeNull()
    const sub = await one<{ status: string }>(
      "SELECT status FROM subscriptions WHERE user_id = ?",
      [userId]
    )
    expect(sub?.status).toBe("expired")
  })
})

describe("支付回调的安全与佣金口径", () => {
  it("回调金额与本地订单不一致 → 400，订单保持 pending", async () => {
    const { outTradeNo } = await insertPendingOrder(FIXTURE.userFree, "yearly", 19900)
    const body = successNotify(outTradeNo, "WX-TX-CHEAP")
    body.resource.ciphertext = JSON.stringify({
      out_trade_no: outTradeNo,
      transaction_id: "WX-TX-CHEAP",
      trade_state: "SUCCESS",
      amount: { total: 1, currency: "CNY" },
    })

    const res = await ApiClient.anonymous().request("POST", "/api/payment/notify", { json: body })
    expect(res.status).toBe(400)

    const order = await one<{ status: string }>(
      "SELECT status FROM payment_orders WHERE out_trade_no = ?",
      [outTradeNo]
    )
    expect(order?.status).toBe("pending")

    const sub = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(Number(sub?.c)).toBe(0)
  })

  it("退款扣回后再次购买，佣金仍按首购 50% 计算", async () => {
    // 上一次购买被退款扣回：合伙人其实一分钱都没拿到
    await insertCommission(FIXTURE.userPartner, FIXTURE.userBuyer, 1450, {
      status: "clawed_back",
      commissionType: "first",
      rate: "0.50",
    })

    const { id: orderId, outTradeNo } = await insertPendingOrder(
      FIXTURE.userBuyer,
      "monthly",
      2900
    )
    const notifyRes = await ApiClient.anonymous().request("POST", "/api/payment/notify", {
      json: successNotify(outTradeNo, "WX-TX-RETRY"),
    })
    expect(notifyRes.status).toBe(200)

    // 佣金是 fire-and-forget 写的
    let row: Record<string, unknown> | undefined
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !row) {
      row = await one(
        "SELECT * FROM partner_commissions WHERE order_id = ?",
        [orderId]
      )
      if (!row) await new Promise((r) => setTimeout(r, 100))
    }

    expect(row).toBeDefined()
    expect(Number(row?.rate)).toBe(0.5)
    expect(row?.commission_type).toBe("first")
    expect(Number(row?.commission_amount)).toBe(1450)
  })
})
