import { db } from "@/lib/db"
import { subscriptions, users, partnerCommissions, paymentOrders as paymentOrdersTable } from "@/lib/db/schema"
import { eq, and, lte, desc, ne, count as sqlCount } from "drizzle-orm"
import { randomUUID } from "crypto"

function getPlanDurationDays(plan: "monthly" | "yearly" | "partner"): number {
  if (plan === "monthly") return 30
  if (plan === "yearly") return 365
  return 365 * 99 // partner: effectively permanent (2099)
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

async function grantPartnerAccess(userId: string): Promise<void> {
  if (!db) return

  // Preserve existing inviteCode if user already has one (avoid breaking referral links)
  const [existingUser] = await db
    .select({ inviteCode: users.inviteCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  let inviteCode = existingUser?.inviteCode
  if (!inviteCode) {
    // 生成到不冲突为止。此前是一个 `do { inviteCode = generateInviteCode() } while
    // (attempts < 10)` 的空循环：从不查询数据库，只是重复赋值十次同一个新码。
    // 一旦撞上 users.invite_code 唯一索引，整条开通链路会直接 500。
    for (let attempt = 0; attempt < 12 && !inviteCode; attempt++) {
      const candidate = generateInviteCode()
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.inviteCode, candidate))
        .limit(1)
      if (!taken) inviteCode = candidate
    }
    if (!inviteCode) throw new Error("生成邀请码失败，请稍后重试")
  }

  await db
    .update(users)
    .set({ isPartner: 1, partnerAgreedAt: new Date(), inviteCode })
    .where(eq(users.id, userId))

  // Retroactive: scan referred users' past purchases and award commissions
  const referredUsers = await db
    .select({
      userId: users.id,
      orderId: subscriptions.paymentOrderId,
    })
    .from(users)
    .innerJoin(subscriptions, eq(users.id, subscriptions.userId))
    .where(eq(users.referredBy, userId))

  for (const row of referredUsers) {
    if (!row.orderId) continue
    const [order] = await db
      .select({ amount: paymentOrdersTable.amount })
      .from(paymentOrdersTable)
      .where(and(eq(paymentOrdersTable.id, row.orderId), eq(paymentOrdersTable.status, "paid")))
      .limit(1)
    if (order?.amount) {
      await triggerCommission(row.userId, row.orderId, order.amount).catch((e) =>
        console.error("Retroactive commission failed:", e)
      )
    }
  }
}

async function triggerCommission(
  userId: string,
  orderId: string,
  orderAmount: number
): Promise<void> {
  if (!db) return

  const [buyer] = await db
    .select({ referredBy: users.referredBy, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!buyer?.referredBy) return

  // Only trigger commission if buyer registered within the 90-day attribution window.
  // Use the order timestamp (not Date.now()) so delayed payment notifications don't skip commission.
  let orderTime = Date.now()
  if (orderId) {
    const [order] = await db
      .select({ createdAt: paymentOrdersTable.createdAt })
      .from(paymentOrdersTable)
      .where(eq(paymentOrdersTable.id, orderId))
      .limit(1)
    if (order?.createdAt) orderTime = new Date(order.createdAt).getTime()
  }
  const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
  if (!buyer.createdAt || orderTime - new Date(buyer.createdAt).getTime() > ATTRIBUTION_WINDOW_MS) return

  const [partner] = await db
    .select({ id: users.id, isPartner: users.isPartner })
    .from(users)
    .where(eq(users.id, buyer.referredBy))
    .limit(1)

  if (!partner || !partner.isPartner) return

  // 「首购」只看真正结算过的佣金。被退款扣回的记录（clawed_back）等于从没
  // 结算过：如果把它也算进去，被邀请人退款后重新购买会被判成续费，佣金从 50%
  // 掉到 30%，合伙人替平台承担了退款成本。
  const [{ cnt }] = await db
    .select({ cnt: sqlCount() })
    .from(partnerCommissions)
    .where(
      and(
        eq(partnerCommissions.referredUserId, userId),
        ne(partnerCommissions.status, "clawed_back")
      )
    )

  const isFirst = Number(cnt) === 0
  const rate = isFirst ? 0.5 : 0.3
  const commissionAmount = Math.floor(orderAmount * rate)
  const availableAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)

  await db.insert(partnerCommissions).values({
    id: randomUUID(),
    partnerId: partner.id,
    orderId,
    referredUserId: userId,
    grossAmount: orderAmount,
    commissionAmount,
    rate: String(rate),
    commissionType: isFirst ? "first" : "renewal",
    status: "cooling",
    availableAt,
  })
}

export async function activateSubscription(
  userId: string,
  plan: "monthly" | "yearly" | "partner",
  paymentOrderId?: string,
  orderAmount?: number
) {
  if (!db) throw new Error("Database not configured")

  const days = getPlanDurationDays(plan)

  // Idempotency: if this payment order was already processed, skip duplicate activation
  if (paymentOrderId) {
    const [dup] = await db
      .select({ id: subscriptions.id, expiresAt: subscriptions.expiresAt })
      .from(subscriptions)
      .where(eq(subscriptions.paymentOrderId, paymentOrderId))
      .limit(1)
    if (dup) {
      // 幂等：该订单已经开通过订阅。此前直接 return，若上一次在"写入订阅"之后、
      // "更新用户权益"之前失败，就会永久留下"有订阅但没会员"的状态；这里把
      // 用户权益补齐再返回。
      if (dup.expiresAt && new Date(dup.expiresAt) > new Date()) {
        await db
          .update(users)
          .set({ isPro: 1, proExpires: dup.expiresAt })
          .where(eq(users.id, userId))
      }
      console.warn(`[Subscription] Duplicate activation skipped for paymentOrder: ${paymentOrderId}`)
      return
    }
  }

  const [existing] = await db
    .select({ expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .limit(1)

  const startsAt = new Date()
  const baseDate = existing?.expiresAt ? new Date(existing.expiresAt) : startsAt
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)

  await db.insert(subscriptions).values({
    userId,
    plan,
    status: "active",
    paymentOrderId: paymentOrderId || null,
    startsAt,
    expiresAt,
  })

  await db
    .update(users)
    .set({ isPro: 1, proExpires: expiresAt })
    .where(eq(users.id, userId))

  if (plan === "partner") {
    await grantPartnerAccess(userId)
  }
  // Trigger commission regardless of plan — partner plan also earns referral commission
  if (paymentOrderId && orderAmount) {
    void triggerCommission(userId, paymentOrderId, orderAmount).catch((e) =>
      console.error("Commission trigger failed:", e)
    )
  }

  return { plan, startsAt, expiresAt }
}

/**
 * 顺手把已过期的会员权益回收掉。
 *
 * 返回「本次是否真的回收了」：调用方若在调用前就读过 users 行，那份快照已经
 * 过期，必须据此修正，否则会把 is_pro:true 回给一个刚被降级的用户。
 */
export async function checkAndExpirePro(userId: string): Promise<boolean> {
  if (!db) return false

  const [user] = await db
    .select({ proExpires: users.proExpires })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (user?.proExpires && new Date(user.proExpires) <= new Date()) {
    await db
      .update(subscriptions)
      .set({ status: "expired" })
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active"),
          lte(subscriptions.expiresAt, new Date())
        )
      )

    await db
      .update(users)
      .set({ isPro: 0, proExpires: null })
      .where(eq(users.id, userId))

    return true
  }

  return false
}

export async function getActiveSubscription(userId: string) {
  if (!db) return null

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1)

  return sub ?? null
}

export async function cancelSubscription(userId: string) {
  if (!db) throw new Error("Database not configured")

  const [sub] = await db
    .select({ id: subscriptions.id, paymentOrderId: subscriptions.paymentOrderId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .limit(1)

  if (!sub) throw new Error("No active subscription found")

  await db
    .update(subscriptions)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(subscriptions.id, sub.id))

  // Clawback: mark any commissions from this order as clawed_back
  if (sub.paymentOrderId) {
    await db
      .update(partnerCommissions)
      .set({ status: "clawed_back" })
      .where(eq(partnerCommissions.orderId, sub.paymentOrderId))
      .catch(() => { /* non-critical */ })
  }

  return { success: true }
}
