import { db } from "@/lib/db"
import { subscriptions, users } from "@/lib/db/schema"
import { eq, and, lte } from "drizzle-orm"

function getPlanDurationDays(plan: "monthly" | "yearly"): number {
  return plan === "monthly" ? 30 : 365
}

export async function activateSubscription(
  userId: string,
  plan: "monthly" | "yearly",
  paymentOrderId?: string
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
