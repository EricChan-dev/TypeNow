/**
 * 练习判分规则 —— 纯规则，零 AI 成本。
 *
 * 依据 docs/pages/04-practice.md：
 *   Perfect     全部正确        → 10 分
 *   Good        1-2 处小错误    →  6 分
 *   Keep trying 超过 2 次错误   →  2 分
 *
 * 这里是 practice_records.score 的唯一来源；首页周统计与
 * 学习档案的 bestScore / avgScore 直接聚合该字段。
 */

export type PracticeGrade = "perfect" | "good" | "keep_trying"

export interface PracticeScore {
  score: number
  grade: PracticeGrade
}

/** 把一句练习中的错误次数折算为分数与评价档位。 */
export function scoreForMistakes(mistakes: number): PracticeScore {
  const n = Number.isFinite(mistakes) ? Math.max(0, Math.trunc(mistakes)) : 0
  if (n === 0) return { score: 10, grade: "perfect" }
  if (n <= 2) return { score: 6, grade: "good" }
  return { score: 2, grade: "keep_trying" }
}
