/**
 * 完成奖励（lesson_complete / course_complete）的资格校验。
 *
 * 职责边界：`lib/reward-rules.ts` 只放**纯规则**（可单测），这里放**取数**。
 * 之所以单独一个模块，是因为校验口径必须与 /api/courses/sentences 的下发口径
 * **逐条对齐**（可用句 → 整课兜底 → 非会员截断到 FREE_TRIAL_SENTENCES），
 * 口径一旦漂移就会出现「用户练完了却领不到奖励」这种最难解释的客诉。
 *
 * 性能：领取是「每人每 refId 每日一次」的低频操作，多花两三条聚合查询可接受；
 * 课程维度用两条 GROUP BY 覆盖全部课时，不逐课循环查库。
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { courses, lessons, practiceRecords, sentences } from "@/lib/db/schema"
import { aliveCourse, aliveLesson, aliveSentence } from "@/lib/soft-delete"
import { typeableAnswerSql, usableSentenceSql } from "@/lib/sentence-quality"
import {
  isCourseCompleted,
  isLessonCompleted,
  type LessonCompletionStat,
} from "@/lib/reward-rules"

export interface RewardEligibility {
  ok: boolean
  /** 不通过时给用户的中文原因（直接进 403 响应） */
  reason?: string
}

/** 一批课时的「实际会下发句数」。空入参返回空 Map。 */
async function loadServedCounts(lessonIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (lessonIds.length === 0 || !db) return map
  const database = db

  // 第一步口径：题干可用 + 答案可输入（与 courses/sentences:60 一致）
  const usable = await database
    .select({ lessonId: sentences.lessonId, n: sql<number>`COUNT(*)` })
    .from(sentences)
    .where(
      and(
        inArray(sentences.lessonId, lessonIds),
        aliveSentence,
        usableSentenceSql(sentences.chinese, sentences.english),
      ),
    )
    .groupBy(sentences.lessonId)

  // 第二步口径：整课都过不了题干判定时，放宽题干、只保留「答案可输入」
  // （与 courses/sentences:69-71 的兜底一致 —— 答案为空的那条仍然不放）。
  const typeable = await database
    .select({ lessonId: sentences.lessonId, n: sql<number>`COUNT(*)` })
    .from(sentences)
    .where(and(inArray(sentences.lessonId, lessonIds), aliveSentence, typeableAnswerSql(sentences.english)))
    .groupBy(sentences.lessonId)

  const typeableMap = new Map<string, number>()
  for (const row of typeable) {
    if (row.lessonId) typeableMap.set(row.lessonId, Number(row.n))
  }
  for (const row of usable) {
    if (!row.lessonId) continue
    // 口径：可用句 > 0 用可用句；否则退回兜底口径
    map.set(row.lessonId, Number(row.n) > 0 ? Number(row.n) : (typeableMap.get(row.lessonId) ?? 0))
  }
  // 只有兜底口径命中的课时（可用句为 0）也要落进 map
  for (const [lessonId, n] of typeableMap) {
    if (!map.has(lessonId)) map.set(lessonId, n)
  }
  return map
}

/** 本人在一批课时里已**去重**练过的句数。 */
async function loadPracticedCounts(
  userId: string,
  lessonIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (lessonIds.length === 0 || !db) return map
  const rows = await db
    .select({ lessonId: sentences.lessonId, n: sql<number>`COUNT(DISTINCT ${practiceRecords.sentenceId})` })
    .from(practiceRecords)
    .innerJoin(sentences, eq(sentences.id, practiceRecords.sentenceId))
    .where(and(eq(practiceRecords.userId, userId), inArray(sentences.lessonId, lessonIds)))
    .groupBy(sentences.lessonId)
  for (const row of rows) {
    if (row.lessonId) map.set(row.lessonId, Number(row.n))
  }
  return map
}

/** lesson_complete：课时真实存在（已发布课程下、未删除）且本人已练完它的下发句数。 */
export async function isLessonRewardEligible(
  userId: string,
  lessonId: string,
  isPro: boolean,
): Promise<RewardEligibility> {
  if (!db) return { ok: false, reason: "数据库不可用" }
  const database = db

  // 与 courses/sentences:39-46 同一条存在性口径：只认已发布、未删除的课时。
  const [lesson] = await database
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(courses, eq(lessons.courseId, courses.id))
    .where(and(eq(lessons.id, lessonId), eq(courses.isPublished, 1), aliveCourse, aliveLesson))
    .limit(1)
  if (!lesson) return { ok: false, reason: "课时不存在或未发布" }

  const servedMap = await loadServedCounts([lessonId])
  const served = servedMap.get(lessonId) ?? 0
  const practicedMap = await loadPracticedCounts(userId, [lessonId])
  const practiced = practicedMap.get(lessonId) ?? 0

  if (!isLessonCompleted(practiced, served, isPro)) {
    return {
      ok: false,
      reason: isPro ? "尚未练完本课全部句子" : "尚未完成本课的试学句子",
    }
  }
  return { ok: true }
}

/** course_complete：课程真实存在，且课程里每一节可练课时都已练完。 */
export async function isCourseRewardEligible(
  userId: string,
  courseId: string,
  isPro: boolean,
): Promise<RewardEligibility> {
  if (!db) return { ok: false, reason: "数据库不可用" }
  const database = db

  const [course] = await database
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.isPublished, 1), aliveCourse))
    .limit(1)
  if (!course) return { ok: false, reason: "课程不存在或未发布" }

  const lessonRows = await database
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), aliveLesson))
  if (lessonRows.length === 0) return { ok: false, reason: "该课程还没有课时" }

  const ids = lessonRows.map((l) => l.id)
  const [servedMap, practicedMap] = await Promise.all([
    loadServedCounts(ids),
    loadPracticedCounts(userId, ids),
  ])

  const stats: LessonCompletionStat[] = ids.map((id) => ({
    served: servedMap.get(id) ?? 0,
    practiced: practicedMap.get(id) ?? 0,
  }))

  if (!isCourseCompleted(stats, isPro)) {
    return { ok: false, reason: "尚未完成本课程的全部课时" }
  }
  return { ok: true }
}
