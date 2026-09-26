import { db } from "@/lib/db"
import { taskLogs, users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import { purchaseReward, isWithinAttributionWindow } from "@/lib/invite-rules"

/**
 * 「邀请有礼」天数制的发放逻辑（与佣金制 partner_commissions 并行，互不冲突）。
 *
 * 两档规则（对齐句乐部）：
 *   注册档：被邀请人得 7 天体验会员，**邀请人不得天数**。
 *           被邀请人的 7 天由注册流程直接写入（见 lib/trial 的 trialGrantFields），
 *           本函数只负责**记账**（供「已邀请 N 人」统计）与幂等。
 *   首购档：双方都得天数，仅首次购买有效，建立关系后 30 天内有效。
 *
 * 为什么注册档邀请人不发天数：否则「拉一批不付费的好友」就能无限刷会员天数。
 * 把邀请人的收益压到首购档，等于让奖励只跟着真实付费走。
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 把用户的会员到期时间往后推 N 天；当前没有有效会员则从现在起算。 */
async function extendProDays(userId: string, days: number): Promise<void> {
  if (!db) return
  const [user] = await db
    .select({ isPro: users.isPro, proExpires: users.proExpires })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) return

  const now = Date.now()
  const base =
    user.isPro && user.proExpires && user.proExpires.getTime() > now
      ? user.proExpires.getTime()
      : now

  await db
    .update(users)
    .set({ isPro: 1, proExpires: new Date(base + days * DAY_MS) })
    .where(eq(users.id, userId))
}

/**
 * 记录一次「受邀注册」。**不发放任何天数**。
 *
 * 只写一条任务流水，作用有两个：
 *   1. `/api/tasks/status` 靠它统计「已邀请 N 人」；
 *   2. 唯一键 (invite_register, ref_id) 保证同一个被邀请人只被计一次。
 *
 * rewardAmount 记 0：这一列的含义是「记录归属人（邀请人）本人拿到的天数」，
 * 而注册档邀请人拿不到天数（被邀请人的 7 天记在他自己的 pro_expires 上）。
 */
export async function awardInviteRegister(inviterId: string, inviteeId: string): Promise<void> {
  if (!db) return
  try {
    await db.insert(taskLogs).values({
      userId: inviterId,
      taskType: "invite_register",
      rewardType: "trial_days",
      rewardAmount: 0,
      date: toShanghaiDateStr(),
      refId: inviteeId,
    })
  } catch {
    // 唯一键冲突 = 这次邀请已经记过，忽略
  }
}

/**
 * 首购奖励：被邀请人首次购买会员时，邀请人与被邀请人双方都获得会员天数。
 *
 * 幂等与「仅首购有效」都由数据库唯一键 (invite_purchase, ref_id) 兜住 ——
 * 插入成功才发天数，插不进去（已发过）就直接返回，因此续费再触发也不会重复发。
 * 不要改成「先查有没有再决定发不发」：那中间隔着网络往返，并发回调会同时通过判断。
 *
 * plan 为 partner 时 purchaseReward 返回 null，直接不发：¥399 合伙人另有现金佣金，
 * 叠加天数就是双重让利。
 */
export async function awardInvitePurchase(inviteeId: string, plan: string): Promise<void> {
  if (!db) return

  const reward = purchaseReward(plan)
  if (!reward) return

  const [invitee] = await db
    .select({ referredBy: users.referredBy, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, inviteeId))
    .limit(1)

  if (!invitee?.referredBy) return
  // 建立邀请关系后 30 天内完成首购才有效
  if (!isWithinAttributionWindow(invitee.createdAt)) return

  const inviterId = invitee.referredBy

  try {
    await db.insert(taskLogs).values({
      userId: inviterId,
      taskType: "invite_purchase",
      rewardType: "trial_days",
      rewardAmount: reward.inviterDays,
      date: toShanghaiDateStr(),
      refId: inviteeId,
    })
  } catch {
    return // 已发过（首购只发一次）
  }

  await extendProDays(inviterId, reward.inviterDays)
  await extendProDays(inviteeId, reward.inviteeDays)
}
