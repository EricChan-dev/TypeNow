import { db } from "@/lib/db"
import { taskLogs, users } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"

export async function awardInviteRegister(inviterId: string, inviteeId: string) {
  if (!db) return
  try {
    await db.insert(taskLogs).values({
      userId: inviterId,
      taskType: "invite_register",
      rewardType: "trial_days",
      rewardAmount: 3,
      date: new Date().toISOString().slice(0, 10),
      refId: inviteeId,
    })
  } catch {
    return
  }

  const threeDays = 3 * 24 * 60 * 60 * 1000
  const now = Date.now()

  const [inviter] = await db
    .select({ isPro: users.isPro, proExpires: users.proExpires })
    .from(users)
    .where(eq(users.id, inviterId))
    .limit(1)

  if (!inviter) return

  let newExpires: Date
  if (inviter.isPro && inviter.proExpires && inviter.proExpires.getTime() > now) {
    newExpires = new Date(inviter.proExpires.getTime() + threeDays)
  } else {
    newExpires = new Date(now + threeDays)
  }

  await db.update(users)
    .set({ isPro: 1, proExpires: newExpires })
    .where(eq(users.id, inviterId))

  await db.update(users)
    .set({ proExpires: sql`DATE_ADD(pro_expires, INTERVAL 3 DAY)` })
    .where(eq(users.id, inviteeId))
}
