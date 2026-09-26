/**
 * 非会员试学：每课免费放行前几句。
 *
 * 对齐句乐部「每个课程包都可以免费试学前几节课」的做法。在此之前非会员请求
 * /api/courses/sentences 会被直接 403，用户还没体验到核心价值就先撞墙。
 *
 * 抽成纯函数是为了给「非会员最多只能拿到 limit 句」这条**内容泄露边界**加单测：
 * 它既是转化设计，也是防拖库的防线，不应该只靠 route 里一行 slice 口头保证。
 */

/** 非会员每课可免费试学的句数。 */
export const FREE_TRIAL_SENTENCES = 3

export interface TrialInfo {
  /** 免费句数上限 */
  limit: number
  /** 是否还有被挡住的句子（前端据此在练完后展示付费引导） */
  truncated: boolean
}

export interface TrialSlice<T> {
  visible: T[]
  /** 会员为 null，表示不受试学限制 */
  trial: TrialInfo | null
}

/**
 * 按会员身份切出可见句子。
 *
 * @param all   过滤后（已完成「可用句」筛选与兜底）的全部句子
 * @param isPro 是否为有效会员
 * @param limit 免费句数上限，默认 {@link FREE_TRIAL_SENTENCES}
 */
export function sliceForTrial<T>(
  all: readonly T[],
  isPro: boolean,
  limit: number = FREE_TRIAL_SENTENCES,
): TrialSlice<T> {
  // 会员不受限，且不返回 trial，避免前端误判为试学态
  if (isPro) return { visible: all.slice(), trial: null }

  const safeLimit = Math.max(0, Math.trunc(limit))
  return {
    visible: all.slice(0, safeLimit),
    trial: { limit: safeLimit, truncated: all.length > safeLimit },
  }
}
