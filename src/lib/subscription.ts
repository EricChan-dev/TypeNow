import { db } from "@/lib/db"
import { subscriptions, users, partnerCommissions } from "@/lib/db/schema"
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
  let inviteCode: string
  let attempts = 0
  do {
    inviteCode = generateInviteCode()
    attempts++
  } while (attempts < 10)

  await db
    .update(users)
    .set({ isPartner: 1, partnerAgreedAt: new Date(), inviteCode })
    .where(eq(users.id, userId))
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

  // Only trigger commission if buyer registered within the 90-day attribution window
  const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
  if (!buyer.createdAt || Date.now() - new Date(buyer.createdAt).getTime() > ATTRIBUTION_WINDOW_MS) return

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
  } else if (paymentOrderId && orderAmount) {
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
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .limit(1)

  if (!sub) throw new Error("No active subscription found")

  await db
    .update(subscriptions)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(subscriptions.id, sub.id))

  return { success: true }
}
