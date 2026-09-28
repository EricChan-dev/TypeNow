import { db } from "@/lib/db"
import { taskLogs, users } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import { purchaseReward, isWithinAttributionWindow } from "@/lib/invite-rules"
import { isDuplicateKeyError } from "@/lib/db/duplicate-key"

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
 *
 * ── 两个已经被修掉的坑（改这里之前请先读）────────────────────────────────────
 *
 * 1. **`catch {}` 把两类错误混为一谈。** 原先无论什么错误都当成「已经发过」，
 *    于是 DB 抖动也会静默吞掉奖励。现在用 isDuplicateKeyError 只把真正的
 *    唯一键冲突当作幂等，其余错误一律记日志。
 *
 * 2. **记账失败曾阻断发放。** 首购档原先「插进 task_logs 失败就 return」，
 *    而插不进去的原因可能只是记账冲突或库抖动 —— 用户真金白银买来的会员天数
 *    就此消失。调用方（payment/notify）刻意会吞掉本函数的异常、不让微信重试
 *    （会员已经开通，重试只会走幂等分支），所以这里不能指望重试兜底：
 *    非幂等原因的记账失败必须**继续发放**。
 *
 *    配套的 DDL 见 db/migrations/00025：原先 uk_task_user_type_date 对
 *    所有 task_type 生效，同一邀请人同一天的第二笔邀请奖励会撞键被吞掉。
 */

/**
 * 把用户的会员到期时间往后推 N 天；当前没有有效会员则从现在起算。
 *
 * 用**一条 SQL** 完成，而不是「先读 pro_expires、在 JS 里算、再写回」：
 * 后者在并发下会丢天数 —— 两个请求读到同一个基准值，各自算出 基准+30 天
 * 再写回，最终只生效一次。`GREATEST(COALESCE(pro_expires, NOW()), NOW())`
 * 把「已过期就现在起算、未过期就顺延」交给数据库，天然原子。
 *
 * 时间基准用数据库的 NOW() 而不是 Node 的 Date.now()：连接会话已统一到 +08:00
 * （见 lib/db/index.ts），与库里的 datetime 表示一致，避免两地时钟/时区差异。
 */
async function extendProDays(userId: string, days: number): Promise<void> {
  if (!db) return
  if (!Number.isFinite(days) || days <= 0) return
  await db
    .update(users)
    .set({
      isPro: 1,
      proExpires: sql`TIMESTAMPADD(DAY, ${days}, GREATEST(COALESCE(${users.proExpires}, NOW()), NOW()))`,
    })
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
  } catch (err) {
    // 唯一键冲突 = 这个被邀请人已经记过，正常忽略。
    // 其余错误要留痕：这一档不涉及天数，失败只表现为「已邀请 N 人」少算，
    // 但正是这种无声少算最难被发现。
    if (!isDuplicateKeyError(err)) {
      console.error("[invite] 受邀注册记账失败（注册本身不受影响，仅统计少算）:", err)
    }
  }
}

/**
 * 首购奖励：被邀请人首次购买会员时，邀请人与被邀请人双方都获得会员天数。
 *
 * 幂等与「仅首购有效」由数据库唯一键 (invite_purchase, ref_id) 兜住 ——
 * 这一行同时充当**幂等锁**：写得进去说明是首购，撞唯一键说明已经发过。
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

  let alreadyGranted = false
  try {
    await db.insert(taskLogs).values({
      userId: inviterId,
      taskType: "invite_purchase",
      rewardType: "trial_days",
      rewardAmount: reward.inviterDays,
      date: toShanghaiDateStr(),
      refId: inviteeId,
    })
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      alreadyGranted = true
    } else {
      // 不是「已发过」，而是我们自己的故障（连接抖动、库不可用…）。
      // 不给用户补发是不可接受的：这是真金白银买来的权益，而调用方刻意会吞掉
      // 这里的异常、不会让微信重试。因此继续发放，只把故障记下来。
      // 代价是极端情况下可能重复发一次（"记账其实成功、但响应丢失"），
      // 这远小于「用户永远拿不到」的伤害。
      console.error("[invite] 首购记账失败，仍继续发放奖励:", err)
    }
  }

  if (alreadyGranted) return

  await extendProDays(inviterId, reward.inviterDays)
  await extendProDays(inviteeId, reward.inviteeDays)
}
