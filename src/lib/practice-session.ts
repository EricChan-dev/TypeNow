export type PracticeSessionState = "active" | "completed" | "abandoned"

export interface PracticeSessionLike {
  currentIndex: number
  state: PracticeSessionState
}

export interface ResumeDecision {
  /** 应该恢复到第几句 */
  index: number
  /** 是否值得提示用户「上次练到第 N 句，已为你恢复」 */
  restored: boolean
}

/**
 * 把恢复下标钳制到 [0, totalSentences - 1]。
 *
 * current_index 的语义是「下一句要练的下标」，不是「已练句数」，所以
 *   - 合法值天然落在 [0, total - 1]；
 *   - 等于 total 表示最后一句也练完了，这里夹到 total - 1（最后一句）而不是 0，
 *     让恢复停在最后一句补一遍，而不是无声地把用户送回开头；
 *   - 远超 total 说明题目在会话期间被删过（total 缩水），同样夹到最后一句。
 *
 * 非法入参（NaN / Infinity / 负数）一律回退到 fallback。旧代码直接相信 sentence_count
 * 当恢复下标，越界时前端读取不到句子，表现为「点继续练习白屏」，因此这里把
 * 「越界」和「非法」都收敛成一个必然可用的下标。
 */
export function clampResumeIndex(currentIndex: number, totalSentences: number, fallback = 0): number {
  const total = Math.floor(Number(totalSentences))
  if (!Number.isFinite(total) || total <= 0) return 0

  const raw = Math.floor(Number(currentIndex))
  const start = Number.isFinite(raw) && raw >= 0 ? raw : Math.floor(Number(fallback))
  const safeStart = Number.isFinite(start) && start >= 0 ? start : 0

  return Math.min(safeStart, total - 1)
}

/**
 * 决定进入一课时恢复到第几句，以及是否需要提示用户。
 *
 * 只有 active 的会话才谈得上「继续」：completed 是练完了，abandoned 是主动放弃，
 * 两者把用户拉回半途都属于违背用户意图。
 *
 * restored 的判定放在钳制之后，且要求结果 > 0：currentIndex = total = 1 这种
 * 「看似有进度、钳完等于从头」的情形不能提示「已为你恢复」，否则就是骗用户。
 */
export function decideResume(
  session: PracticeSessionLike | null | undefined,
  totalSentences: number
): ResumeDecision {
  if (!session) return { index: 0, restored: false }
  if (session.state !== "active") return { index: 0, restored: false }
  if (!(session.currentIndex > 0)) return { index: 0, restored: false }

  const index = clampResumeIndex(session.currentIndex, totalSentences)
  return { index, restored: index > 0 }
}
