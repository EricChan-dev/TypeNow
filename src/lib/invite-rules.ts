/**
 * 「邀请有礼」天数制的规则层（纯函数，无数据库依赖）。
 *
 * 参考句乐部的双轨设计：佣金制（星火计划，对应我们的 partner_commissions）
 * 与天数制（邀请有礼）**并行、互不冲突**。本文件只管天数制。
 * （2026-09-29 合规改造后，佣金制已解绑为「所有注册用户均可加入」，与套餐无关。）
 *
 * 句乐部的规则（官方帮助文档）：
 *   - 好友注册：好友获得 7 天体验会员（仅限首次注册）
 *   - 好友付费：邀请者和被邀请者**双方**均获得会员时长奖励，年卡更多
 *   - 仅首次购买有效，续费不触发
 *   - 好友需在建立邀请关系后 30 天内完成首次购买
 *   - 奖励无上限
 *
 * **我们的数值不同（2026-09-29 决策）**：注册档 5 天；首购档月/季卡双方各 3 天、
 * 年卡双方各 7 天。句乐部的绝对天数比我们宽松，这是刻意的 —— 规则结构照抄，
 * 力度自己定；我们还没有它的用户基数，送出去的每一天都是纯成本。
 */

/**
 * 受邀注册时，被邀请人获得的体验会员天数。
 *
 * 2026-09-29 决策：7 → **5**。
 * 仍比主动领取的 `TRIAL_DAYS`（3 天）更长 —— 让「被朋友邀请」比「自己去领」
 * 更划算，才有动力走邀请链接；但差距从 7:5 收窄到 5:3，避免邀请档发得太松。
 */
export const INVITE_REGISTER_DAYS = 5

/** 建立邀请关系后，多久内完成首购才发奖励。 */
export const INVITE_ATTRIBUTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** 可触发邀请首购奖励的套餐。partner（终身会员）不参与天数制，见 purchaseReward。 */
export type InvitePurchasePlan = "monthly" | "quarterly" | "yearly"

export interface InvitePurchaseReward {
  /** 邀请人获得的天数 */
  inviterDays: number
  /** 被邀请人获得的天数 */
  inviteeDays: number
}

/**
 * 首购奖励额度。年卡高于月卡/季卡 —— 句乐部原文「推荐好友购买年会员，双方获得
 * 更多奖励」，靠这个差额把邀请人引导到推广年卡。
 *
 * 2026-09-29 决策：数值大幅收紧（原为 年卡 30/20、月卡 5/3）。
 *   - 月卡 / 季卡：双方各 **3 天**
 *   - 年卡：双方各 **7 天**
 *
 * 收紧的理由：原值一次年卡首购就送出 50 天会员，对一个尚无收入的产品是纯让利；
 * 而且邀请人拉一个新用户即得 30 天，会让「拉人」比「卖课」更划算 —— 激励方向错了。
 *
 * partner（终身会员）返回 null。注意在 2026-09-29 的合规改造后，这条的理由变了：
 * 不再是「它本身就是推广身份、另有现金佣金，叠加就是双重让利」（那个前提已随
 * 推广资格解绑而消失），而是一个纯粹的产品判断 —— 一次 ¥499 的交易不该再叠加
 * 几十天会员。现金佣金现在对**所有注册用户**开放，与本套餐无关。
 */
export function purchaseReward(plan: string): InvitePurchaseReward | null {
  if (plan === "yearly") return { inviterDays: 7, inviteeDays: 7 }
  if (plan === "monthly" || plan === "quarterly") return { inviterDays: 3, inviteeDays: 3 }
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
