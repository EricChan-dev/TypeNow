/**
 * 金币：免费货币的规则层（纯函数，无数据库依赖）。
 *
 * ── 双货币的分工 ──────────────────────────────────────────────────────────────
 *
 *   钻石（付费货币）—— 只能由**会员赠送**或未来**充值**获得，用于消耗型能力
 *                     （AI 助手超出每日免费额度之后）。它对应真金白银的外部调用成本。
 *   金币（免费货币）—— 只能靠**学习行为**获得，用于兑换会员天数与道具。
 *                     它不触碰任何按调用计费的服务。
 *
 * 两者用途**严格不交叉**：金币永远不能直接换 AI 调用。
 * 这是句乐部验证过的设计（官方文档：两种货币用途完全不交叉）。
 *
 * ── 为什么必须在意金币的产出速率 ──────────────────────────────────────────────
 *
 * 金币能兑换会员天数（COINS_PER_MEMBER_DAY），所以它**是准现金**：
 * 1000 金币 ≈ 1 天会员 ≈ ¥0.97。产出速率一变，等于静默改了折扣力度。
 *
 * 因此有两道纪律：
 *   1. 所有数值只能在本文件改 —— 文案与发放逻辑都引用这里，不存在两边各写一份；
 *   2. 兑换有每月上限（MAX_MEMBER_DAYS_PER_MONTH），且**必须服务端强制**，
 *      前端拦等于没拦。
 *
 * 本模块**不得引入 db / drizzle**：金币余额要显示在客户端组件上，
 * 拖进服务端依赖会污染浏览器 bundle（与 lib/trial-days、lib/free-trial 同理）。
 */

// ─── 产出 ────────────────────────────────────────────────────────────────────

/** 每日打卡的基础金币奖励。 */
export const COIN_CHECK_IN_BASE = 10
/** 连续打卡每多一天的增量。 */
export const COIN_CHECK_IN_STEP = 2
/** 打卡奖励封顶（连续天数再多也不超过这个值）。 */
export const COIN_CHECK_IN_CAP = 30

/** 练习单句的金币奖励（非完美）。 */
export const COIN_PER_SENTENCE = 1
/** 练习单句的金币奖励（完美）。 */
export const COIN_PER_PERFECT = 2
/** 完成一个课时。 */
export const COIN_LESSON_COMPLETE = 20
/** 完成一门课程。 */
export const COIN_COURSE_COMPLETE = 100
/** 每日分享（与 task_logs 的每日一次去重一致）。 */
export const COIN_SHARE = 5

// ─── 消耗 ────────────────────────────────────────────────────────────────────

/** 兑换 1 天会员所需金币。 */
export const COINS_PER_MEMBER_DAY = 1000
/** 每人每月最多能用金币兑换的会员天数（服务端强制）。 */
export const MAX_MEMBER_DAYS_PER_MONTH = 3
/** 单次兑换发放的天数。 */
export const MEMBER_DAYS_PER_REDEEM = 1

// ─── 打卡目标 ────────────────────────────────────────────────────────────────

/**
 * 打卡目标＝**当日练习句数**（不是货币量）。
 *
 * 口径对齐句乐部：「完成当天的打卡目标就算完成（打卡目标可以自己设，
 * 默认 10 个练习点）」。用学习量而不是货币量做门槛，有两个好处：
 *   1. 不会出现「打卡奖励依赖打卡是否成立」的循环（若门槛判当日获得金币）；
 *   2. 无法用登录、签到之类的零成本动作绕过。
 */
export const CHECK_IN_GOAL_MIN = 1
export const CHECK_IN_GOAL_MAX = 50
/** 打卡目标默认值，对齐句乐部的默认 10 个练习点。 */
export const CHECK_IN_GOAL_DEFAULT = 10

// ─── 纯函数 ──────────────────────────────────────────────────────────────────

/**
 * 一次打卡能拿多少金币。
 *
 * 连续第 1 天 = 10，第 2 天 = 12 …… 线性递增到封顶 30（连续第 11 天起都是 30）。
 * 用「连续天数」而不是「历史总天数」：断了就从 10 重新开始，这正是连胜激励的意义。
 */
export function checkInCoinReward(streakDays: number): number {
  const n = Number.isFinite(streakDays) ? Math.max(1, Math.trunc(streakDays)) : 1
  return Math.min(COIN_CHECK_IN_BASE + COIN_CHECK_IN_STEP * (n - 1), COIN_CHECK_IN_CAP)
}

/** 单句练习能拿多少金币（完美有额外奖励）。 */
export function sentenceCoinReward(perfect: boolean): number {
  return perfect ? COIN_PER_PERFECT : COIN_PER_SENTENCE
}

/** 把打卡目标夹到合法区间；入参非法时回落到默认值。 */
export function clampCheckInGoal(goal: unknown): number {
  const n = typeof goal === "number" ? goal : Number(goal)
  if (!Number.isFinite(n)) return CHECK_IN_GOAL_DEFAULT
  return Math.min(Math.max(Math.trunc(n), CHECK_IN_GOAL_MIN), CHECK_IN_GOAL_MAX)
}

/** 还差多少句才能打卡（已达标返回 0）。用于前端文案与接口响应。 */
export function sentencesToCheckIn(todaySentences: number, goal: number): number {
  const done = Number.isFinite(todaySentences) ? Math.max(0, Math.trunc(todaySentences)) : 0
  return Math.max(0, clampCheckInGoal(goal) - done)
}

/**
 * 当前金币最多还能兑换几天会员（同时受余额与每月上限约束）。
 *
 * 服务端用它做兑换前的准入判断；**不能**把这个判断放在前端，
 * 否则上限形同虚设。
 */
export function affordableMemberDays(coins: number, redeemedThisMonth: number, goal = 1): number {
  void goal
  const balance = Number.isFinite(coins) ? Math.max(0, Math.trunc(coins)) : 0
  const used = Number.isFinite(redeemedThisMonth) ? Math.max(0, Math.trunc(redeemedThisMonth)) : 0
  const byBalance = Math.floor(balance / COINS_PER_MEMBER_DAY)
  const byQuota = Math.max(0, MAX_MEMBER_DAYS_PER_MONTH - used)
  return Math.max(0, Math.min(byBalance, byQuota))
}
