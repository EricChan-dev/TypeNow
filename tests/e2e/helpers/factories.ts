/**
 * 造数据的小工具。
 *
 * 与 helpers/db.ts 的区别：db.ts 只做「连接 + 断言」两件事，这里放的是
 * 「按业务语义造一行」的组合操作。全部走原生 SQL，不经应用代码，
 * 这样测试断言的才是数据库里真实落下的结果。
 */
import { q, one } from "./db"

/** 让每个用例拿到互不相同的手机号/IP，避免进程内限流桶互相污染。 */
let phoneSeq = 0
export function nextPhone(): string {
  phoneSeq += 1
  return `139${String(10000000 + phoneSeq).slice(0, 8)}`
}

let ipSeq = 0
export function nextIp(): string {
  ipSeq += 1
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`
}

/** 直接写一条验证码记录；expiresInMs 传负数即可造出「已过期」。 */
export async function insertVerificationCode(
  phone: string,
  code: string,
  opts: { expiresInMs?: number; used?: number; ip?: string } = {}
): Promise<void> {
  await q(
    `INSERT INTO verification_codes (id, phone, code, ip, expires_at, used)
     VALUES (UUID(), ?, ?, ?, ?, ?)`,
    [
      phone,
      code,
      opts.ip ?? nextIp(),
      new Date(Date.now() + (opts.expiresInMs ?? 5 * 60 * 1000)),
      opts.used ?? 0,
    ]
  )
}

/** 造一条真实会话行，返回 cookie 值（非 dev 旁路）。 */
export async function insertSession(
  userId: string,
  opts: { expiresInMs?: number } = {}
): Promise<string> {
  const id = crypto.randomUUID()
  await q("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    id,
    userId,
    new Date(Date.now() + (opts.expiresInMs ?? 24 * 3600 * 1000)),
  ])
  return id
}

/** 造一个用户，返回 id。字段用业务默认值，避免用例里到处拼 SQL。 */
export async function insertUser(
  overrides: Partial<{
    id: string
    phone: string | null
    name: string
    isPro: number
    proExpires: Date | null
    isPartner: number
    inviteCode: string | null
    referredBy: string | null
    wechatOpenid: string | null
    createdAt: Date
  }> = {}
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID()
  await q(
    `INSERT INTO users (id, phone, name, is_pro, pro_expires, is_partner, invite_code, referred_by, wechat_openid, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.phone === undefined ? nextPhone() : overrides.phone,
      overrides.name ?? "e2e 用户",
      overrides.isPro ?? 0,
      overrides.proExpires ?? null,
      overrides.isPartner ?? 0,
      overrides.inviteCode === undefined ? null : overrides.inviteCode,
      overrides.referredBy ?? null,
      overrides.wechatOpenid ?? null,
      overrides.createdAt ?? new Date(),
    ]
  )
  return id
}

/** 给已有用户补上微信 openid（提现的前置条件）。 */
export async function setWechatOpenid(userId: string, openid: string): Promise<void> {
  await q("UPDATE users SET wechat_openid = ? WHERE id = ?", [openid, userId])
}

/** 造一条复习队列记录。nextReviewAt 默认已到期（可复习）。 */
export async function insertReviewItem(
  userId: string,
  sentenceId: string,
  opts: {
    status?: "pending" | "done"
    nextReviewAt?: Date
    intervalDays?: number
    easeFactor?: string
    consecutiveOk?: number
    reviewCount?: number
  } = {}
): Promise<string> {
  const id = crypto.randomUUID()
  await q(
    `INSERT INTO review_queue
       (id, user_id, sentence_id, status, next_review_at, interval_days, ease_factor, consecutive_ok, review_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      sentenceId,
      opts.status ?? "pending",
      opts.nextReviewAt ?? new Date(Date.now() - 60_000),
      opts.intervalDays ?? 1,
      opts.easeFactor ?? "2.50",
      opts.consecutiveOk ?? 0,
      opts.reviewCount ?? 0,
    ]
  )
  return id
}

/** 造一条已支付的支付订单，返回 { id, outTradeNo }。 */

export async function insertPaidOrder(
  userId: string,
  plan: "monthly" | "yearly" | "partner",
  amount: number,
  opts: { outTradeNo?: string; createdAt?: Date } = {}
): Promise<{ id: string; outTradeNo: string }> {
  const id = crypto.randomUUID()
  const outTradeNo =
    opts.outTradeNo ?? `TYPENOW-TEST-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6)}`
  await q(
    `INSERT INTO payment_orders (id, user_id, plan, amount, out_trade_no, status, paid_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)`,
    [id, userId, plan, amount, outTradeNo, new Date(), opts.createdAt ?? new Date()]
  )
  return { id, outTradeNo }
}

/** 造一条 pending 订单（用于回调链路）。 */
export async function insertPendingOrder(
  userId: string,
  plan: "monthly" | "yearly" | "partner",
  amount: number
): Promise<{ id: string; outTradeNo: string }> {
  const id = crypto.randomUUID()
  const outTradeNo = `TYPENOW-TEST-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6)}`
  await q(
    `INSERT INTO payment_orders (id, user_id, plan, amount, out_trade_no, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, userId, plan, amount, outTradeNo, new Date(Date.now() + 2 * 3600 * 1000)]
  )
  return { id, outTradeNo }
}

/** 造一条佣金记录。status 默认 available，方便直接测提现。 */
export async function insertCommission(
  partnerId: string,
  referredUserId: string,
  commissionAmount: number,
  opts: {
    id?: string
    orderId?: string
    status?: "cooling" | "available" | "withdrawn" | "clawed_back"
    commissionType?: "first" | "renewal"
    rate?: string
    availableAt?: Date
    grossAmount?: number
  } = {}
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID()
  await q(
    `INSERT INTO partner_commissions
       (id, partner_id, order_id, referred_user_id, gross_amount, commission_amount, rate, commission_type, status, available_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      partnerId,
      opts.orderId ?? crypto.randomUUID(),
      referredUserId,
      opts.grossAmount ?? commissionAmount * 2,
      commissionAmount,
      opts.rate ?? "0.50",
      opts.commissionType ?? "first",
      opts.status ?? "available",
      opts.availableAt ?? new Date(Date.now() - 1000),
    ]
  )
  return id
}

export async function getUser(
  id: string
): Promise<
  | {
      id: string
      phone: string | null
      is_pro: number
      pro_expires: Date | null
      is_partner: number
      invite_code: string | null
      referred_by: string | null
    }
  | undefined
> {
  return one(
    `SELECT id, phone, is_pro, pro_expires, is_partner, invite_code, referred_by FROM users WHERE id = ?`,
    [id]
  )
}
