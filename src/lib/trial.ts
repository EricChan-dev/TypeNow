import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { and, eq, isNull, lte, or } from "drizzle-orm"
import { affectedRows } from "@/lib/db/affected-rows"
import { TRIAL_DAYS } from "@/lib/trial-days"

/**
 * 体验会员时长从 3 天提到 5 天：3 天不足以让新用户跨过一个完整的学习周末，
 * 体验还没形成习惯就到期了。对齐句乐部的 5–7 天区间取下沿——我们比句乐部
 * 多一步「先免费练 3 句」的价值前置，所以不需要给到 7 天。
 *
 * 数值本身定义在 lib/trial-days（客户端也要用，不能带上这里的 db 依赖），
 * 这里 re-export 方便服务端调用方只 import 一处。
 */
export { TRIAL_DAYS }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 从给定时刻起算的体验会员到期时间（纯函数，便于单测）。
 *
 * days 可覆盖：受邀注册拿到的是 7 天（见 lib/invite-rules 的 INVITE_REGISTER_DAYS），
 * 比主动领取的 5 天更长 —— 让「被朋友邀请」比「自己去领」更划算，才有动力用邀请链接。
 */
export function trialExpiryFrom(now: number = Date.now(), days: number = TRIAL_DAYS): Date {
  return new Date(now + days * DAY_MS)
}

export type TrialGrantResult = "granted" | "already_claimed" | "db_unavailable"

/**
 * 主动领取体验会员。
 *
 * 条件更新 + affectedRows 是这里的全部安全性所在：并发双击、或前端重试，
 * 只有一个请求能把 `trial_claimed_at` 从 NULL 改成时间戳，其余一律 0 行受影响。
 * 注意**不能**先 SELECT 判断再 UPDATE —— 那中间隔着一次网络往返，
 * 并发请求会同时通过判断（与支付回调里踩过的坑同一个形状）。
 *
 * 第二个条件（pro_expires 为空或已过期）是必须的，不是防御性冗余：
 * `trial_claimed_at` 是新列，**存量用户全是 NULL，包括正在付费的会员**。
 * 若只判 `trial_claimed_at IS NULL`，一次误调用就会把年卡会员的
 * pro_expires 覆盖成「今天 + 5 天」，等于直接把他的付费权益砍掉。
 * 把这条约束放进 WHERE，即使调用方忘了先判断会员身份也降不了级。
 *
 * 返回 "already_claimed" 也涵盖「用户不存在」和「当前已是有效会员」两种情况
 * （都是 0 行受影响）。
 */
export async function claimTrial(userId: string): Promise<TrialGrantResult> {
  if (!db) return "db_unavailable"

  const now = new Date()
  const result = await db
    .update(users)
    .set({ isPro: 1, proExpires: trialExpiryFrom(now.getTime()), trialClaimedAt: now })
    .where(
      and(
        eq(users.id, userId),
        isNull(users.trialClaimedAt),
        // 当前没有有效会员身份才可领取
        or(isNull(users.proExpires), lte(users.proExpires, now)),
      ),
    )

  return affectedRows(result) > 0 ? "granted" : "already_claimed"
}

/**
 * 注册时「受邀自动领取」用的字段片段。
 *
 * 受邀用户（referred_by 非空）注册即视为已领取——句乐部的做法是
 * 「通过他人邀请码或邀请链接进来注册的 → 注册成功后自动领取，最直接」。
 * 因此这条路径要同时写上 trial_claimed_at，否则受邀用户还能再手动领一次。
 *
 * 天数默认用受邀的 7 天（调用方传 INVITE_REGISTER_DAYS）；开发态夹具等
 * 非受邀场景不传，走主动领取的 5 天。
 */
export function trialGrantFields(now: Date = new Date(), days: number = TRIAL_DAYS) {
  return {
    isPro: 1,
    proExpires: trialExpiryFrom(now.getTime(), days),
    trialClaimedAt: now,
  }
}
