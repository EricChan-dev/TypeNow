// 学习计划第一期共享逻辑：词 token 规整、音标双形态归一、SM-2 lite 调度。
// 调度口径与 db/migrations/00034_study_plans.sql 文件头一致；时间用 JS Date 计算，
// 与 src/app/api/review/complete/route.ts:62 的既有约定相同。
import { wrapPhonetic } from "@/lib/dict-display"

/** sentences.words[].phonetic 的历史两形态（schema.ts words 列注释：{uk,us} 对象 | 字符串 | null） */
export type LegacyPhonetic = string | { uk?: string; us?: string } | null | undefined

/**
 * 词 token 口径：字母开头，允许词内 ' 与 -，允许词组空格（课程里实测有
 * "central reservation" 这类词组，见查单词页同款数据）。上限 64 与
 * wordbook_items.word 的校验一致（表列宽 128 是给未来导流留的余量）。
 * 返回 null 表示不是可学习的词（数字、乱码、空）。
 */
export function normalizeWordToken(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ")
  if (!t || t.length > 64) return null
  const token = /^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*)*$/
  return token.test(t) ? t : null
}

/** 把 {uk,us} 对象 / 字符串 / null 三种形态归一成一对已包斜杠的音标（可能为空串）。 */
export function phoneticPair(raw: LegacyPhonetic): { us: string; uk: string } {
  if (raw && typeof raw === "object") {
    return { uk: wrapPhonetic(raw.uk ?? ""), us: wrapPhonetic(raw.us ?? "") }
  }
  return { us: wrapPhonetic(raw ?? ""), uk: "" }
}

export interface SrsState {
  intervalDays: number
  easeFactor: number
  consecutiveOk: number
  status: "learning" | "mastered"
}

/** interval ≥ 21 天视为已掌握（ mastered ）；答错即回 learning 并立刻到期。 */
export const MASTERED_INTERVAL_DAYS = 21
const MAX_INTERVAL_DAYS = 180

/**
 * SM-2 lite（与 review_queue 同族，见 00034 文件头）：
 *   答对：interval 0→1，否则 min(round(interval×ease), 180)；ease +0.05 封顶 3.00
 *   答错：interval 归 0（nextReviewDate(0) = 现在，立刻到期）；ease −0.20 保底 1.30
 */
export function applySrsAnswer(
  prev: SrsState,
  correct: boolean
): SrsState & { nextReviewAt: Date } {
  if (correct) {
    const intervalDays =
      prev.intervalDays <= 0
        ? 1
        : Math.min(Math.round(prev.intervalDays * prev.easeFactor), MAX_INTERVAL_DAYS)
    const easeFactor = Math.min(prev.easeFactor + 0.05, 3.0)
    const status =
      intervalDays >= MASTERED_INTERVAL_DAYS ? ("mastered" as const) : prev.status
    return {
      intervalDays,
      easeFactor,
      consecutiveOk: prev.consecutiveOk + 1,
      status,
      nextReviewAt: nextReviewDate(intervalDays),
    }
  }
  return {
    intervalDays: 0,
    easeFactor: Math.max(prev.easeFactor - 0.2, 1.3),
    consecutiveOk: 0,
    status: "learning" as const,
    nextReviewAt: nextReviewDate(0),
  }
}

export function nextReviewDate(intervalDays: number): Date {
  return new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000)
}
