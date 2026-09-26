/**
 * 「邀请有礼」天数制的规则层（纯函数，无数据库依赖）。
 *
 * 参考句乐部的双轨设计：佣金制（星火计划，对应我们的合伙人 partner_commissions）
 * 与天数制（邀请有礼）**并行、互不冲突**。本文件只管天数制。
 *
 * 句乐部的规则（官方帮助文档）：
 *   - 好友注册：好友获得 7 天体验会员（仅限首次注册）
 *   - 好友付费：邀请者和被邀请者**双方**均获得会员时长奖励，年卡更多
 *   - 仅首次购买有效，续费不触发
 *   - 好友需在建立邀请关系后 30 天内完成首次购买
 *   - 奖励无上限
 *
 * 我们照此实现，并额外做了一条句乐部没写明的收紧（见下方 purchaseReward 注释）。
 */

/** 受邀注册时，被邀请人获得的体验会员天数（句乐部为 7 天）。 */
export const INVITE_REGISTER_DAYS = 7

/** 建立邀请关系后，多久内完成首购才发奖励。 */
export const INVITE_ATTRIBUTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** 可触发邀请首购奖励的套餐。partner 套餐另外走现金佣金，不参与天数制。 */
export type InvitePurchasePlan = "monthly" | "yearly"

export interface InvitePurchaseReward {
  /** 邀请人获得的天数 */
  inviterDays: number
  /** 被邀请人获得的天数 */
  inviteeDays: number
}

/**
 * 首购奖励额度。年卡明显高于月卡 —— 句乐部原文「推荐好友购买年会员，双方获得
 * 更多奖励」，靠这个差额把邀请人引导到推广年卡。
 *
 * 注意：句乐部的具体数值只出现在帮助文档的**图片**里，无法读取，
 * 这里的 5/3 与 30/20 沿用我们此前方案中的比例，属于待校准值而非抄来的数字。
 *
 * partner 套餐返回 null：¥399 合伙人本身就是推广身份，另有 50% 现金佣金
 * （见 lib/subscription 的 partner_commissions），若再叠加天数就是双重让利。
 */
export function purchaseReward(plan: string): InvitePurchaseReward | null {
  if (plan === "yearly") return { inviterDays: 30, inviteeDays: 20 }
  if (plan === "monthly") return { inviterDays: 5, inviteeDays: 3 }
  return null
}

/**
 * 是否仍在归因窗口内（默认 30 天，从句乐部「须在建立邀请关系后 30 天内完成首次购买」）。
 *
 * registeredAt 为空时返回 true：schema 里 created_at 是 NOT NULL，真出现 null 说明
 * 是异常数据，此时宁可发奖励也不要静默吞掉用户的权益。窗口按毫秒严格比较。
 */
export function isWithinAttributionWindow(
  registeredAt: Date | null | undefined,
  now: Date = new Date(),
  days: number = INVITE_ATTRIBUTION_DAYS,
): boolean {
  if (!registeredAt) return true
  return now.getTime() - new Date(registeredAt).getTime() <= days * DAY_MS
}

/** 受邀注册时被邀请人的体验会员到期时间。 */
export function inviteTrialExpiryFrom(now: number = Date.now()): Date {
  return new Date(now + INVITE_REGISTER_DAYS * DAY_MS)
}
