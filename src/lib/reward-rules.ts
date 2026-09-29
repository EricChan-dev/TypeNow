/**
 * 课时 / 课程完成奖励的判定规则（**纯函数**，不依赖 db，便于单测）。
 *
 * 为什么要做服务端校验：
 *   这两个奖励此前是「请求体说什么就信什么」——`refId` 由客户端自选，而去重键
 *   又包含 `refId`（user + type + refId + 上海日历日）。于是 curl 一串随机字符串
 *   就能无限次领 30 / 100 颗钻石，钻石再兑换 /api/chat 的 DeepSeek 调用，
 *   等于用平台的真金白银补贴刷子。
 *
 * 校验口径必须与内容下发口径**同源**，否则会出现「用户明明练完了却领不到」：
 *   非会员在 /api/courses/sentences 只能拿到每课前 FREE_TRIAL_SENTENCES 句
 *   （lib/free-trial），所以「练完一节课」对非会员意味着练完那 3 句，
 *   对会员才意味着练完整节课。这里用同一个常量推导，两边不会漂移。
 */

import { FREE_TRIAL_SENTENCES } from "@/lib/free-trial"
import { COIN_COURSE_COMPLETE, COIN_LESSON_COMPLETE } from "@/lib/coins"

/**
 * 完成奖励的额度。**单位是金币**（免费货币），不再是钻石 ——
 * 2026-09-29 双货币拆分后，练习 / 课时 / 课程奖励一律发金币
 * （钻石改为只由会员每日赠送，用于 AI 与语音评测的超额消耗）。
 *
 * 数值定义在 lib/coins.ts（唯一事实源），这里只做语义别名 ——
 * 同一笔奖励在两个地方各写一个数，迟早会漂移。
 */
export const LESSON_COMPLETE_REWARD = COIN_LESSON_COMPLETE
export const COURSE_COMPLETE_REWARD = COIN_COURSE_COMPLETE

/**
 * 「练完一节课」需要练过的句数。
 *
 * @param servedCount 这节课**实际会下发**的句数（已按可用句口径 + 兜底口径算好，
 *                    与 /api/courses/sentences 的两步取数一致）
 * @param isPro       是否有效会员
 */
export function requiredPracticeCount(servedCount: number, isPro: boolean): number {
  if (!Number.isFinite(servedCount) || servedCount <= 0) return 0
  if (isPro) return servedCount
  // 非会员最多只能被下发前 3 句，因此最多也只能练到 3 句 —— 门槛不能高过下发量。
  return Math.min(servedCount, FREE_TRIAL_SENTENCES)
}

/** 这节课是否已练完（practicedCount 是本人对该课句子去重后的练习句数）。 */
export function isLessonCompleted(
  practicedCount: number,
  servedCount: number,
  isPro: boolean,
): boolean {
  const required = requiredPracticeCount(servedCount, isPro)
  // 没有任何可练内容的课时不能判为「已完成」，否则会变成零成本领奖口。
  if (required <= 0) return false
  return practicedCount >= required
}

export interface LessonCompletionStat {
  /** 本课会下发的句数（0 表示整课不可练，例如题干/答案全脏） */
  served: number
  /** 本人已去重练过的句数 */
  practiced: number
}

/**
 * 课程完成 = 课程里**每一节可练的课时**都达到各自的完成门槛。
 *
 * - `served === 0` 的课时（整课内容不可练）**不**计入门槛：它们物理上练不完，
 *   计入会让奖励永远领不到 —— 与 courses/sentences 的兜底口径一致。
 * - 但至少要存在一节可练课时，否则空课程也不能算完成。
 */
export function isCourseCompleted(stats: LessonCompletionStat[], isPro: boolean): boolean {
  const practiceable = stats.filter((s) => s.served > 0)
  if (practiceable.length === 0) return false
  return practiceable.every((s) => isLessonCompleted(s.practiced, s.served, isPro))
}
