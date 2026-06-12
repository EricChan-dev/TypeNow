import { db } from "@/lib/db"
import { subscriptions, users, partnerCommissions, paymentOrders as paymentOrdersTable } from "@/lib/db/schema"
import { eq, and, lte, isNotNull, count as sqlCount } from "drizzle-orm"
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
    let attempts = 0
    do {
      inviteCode = generateInviteCode()
      attempts++
    } while (attempts < 10)
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

  const [{ cnt }] = await db
    .select({ cnt: sqlCount() })
    .from(partnerCommissions)
    .where(eq(partnerCommissions.referredUserId, userId))

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
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.paymentOrderId, paymentOrderId))
      .limit(1)
    if (dup) {
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

export async function checkAndExpirePro(userId: string) {
  if (!db) return

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
  }
}

export async function getActiveSubscription(userId: string) {
  if (!db) return null

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(subscriptions.createdAt)
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
