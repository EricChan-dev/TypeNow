/**
 * 内容（课程 / 课时 / 句子）的软删除。
 *
 * 背景与选型见 db/migrations/00016_soft_delete.sql：这三个表此前是硬删除，
 * 而库里一个外键都没有，删一门课会留下最多 16,891 条孤儿课时。
 *
 * ── 三条设计约束 ────────────────────────────────────────────────────────────
 *
 * 1. **级联标记，而不是只标记顶层。**
 *    删课程时把它的课时、以及这些课时下的句子全部打上同一个时间戳。
 *    为什么不"只删课程、靠查询往上过滤"：句子会通过很多路径被直接读到
 *    （按 id 查、复习队列 join、练习记录 join），只标记顶层就意味着每条路径
 *    都要自己往上追溯父级是否被删 —— 漏掉任何一条，被删内容就会继续露出来。
 *    每一行都自己带标记，"有没有漏"就退化成"有没有加这个谓词"，可检查。
 *
 * 2. **一个批次共用一个 `deleted_batch`（UUID），恢复按它精确还原。**
 *    批次**不能**用 deleted_at 的时间戳代替：本仓库 drizzle 的 datetime 映射
 *    （src/lib/db/index.ts 的 toDbDateTime）只取到「秒」，同一秒内两次删除会
 *    得到相同的值，恢复时互相串台 —— 这个方案在上线前被测试证伪过
 *    （"先单独删一句、20ms 后删整门课、再恢复课程"把那句误复活了）。
 *    显式 UUID 不依赖时间精度，deleted_at 只作为"什么时候删的"展示。
 *
 * 3. **恢复也要级联。** 恢复课程时把同批次的课时与句子一起还回来，
 *    否则会出现"课程回来了但里面是空的"。
 *
 * ── 读路径 ──────────────────────────────────────────────────────────────────
 *
 * 所有读这三张表的地方都必须带上对应的 `aliveXxx` 谓词。它是模块级常量
 * （drizzle 的 SQL 对象是不可变描述符，可以安全地在并发查询间复用），
 * 这样"哪些查询漏了过滤"可以直接 grep `alive` 来核对。
 *
 * 少数地方**故意不过滤**，并且都在代码里写明了理由：
 *   - 练习记录、复习进度等历史统计：用户当初确实练过，内容下架不该改写历史；
 *   - 后台的"含已删除"视图：需要能看到并恢复它们。
 */

import { randomUUID } from "crypto"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { courses, lessons, sentences } from "@/lib/db/schema"
import { invalidateCachedCount, STATS_KEYS } from "@/lib/stats-cache"

/** 「未软删除」谓词。读这三张表时一律要带上。 */
export const aliveCourse = isNull(courses.deletedAt)
export const aliveLesson = isNull(lessons.deletedAt)
export const aliveSentence = isNull(sentences.deletedAt)

/** 「已软删除」谓词（后台的"仅看已删除"视图用）。 */
export const deletedCourse = sql`${courses.deletedAt} IS NOT NULL`
export const deletedLesson = sql`${lessons.deletedAt} IS NOT NULL`
export const deletedSentence = sql`${sentences.deletedAt} IS NOT NULL`

/** 删除的影响面，用于删除前的二次确认。 */
export interface DeleteImpact {
  lessons: number
  sentences: number
}

/**
 * 算出"删这门课会连带影响多少内容"。删除前展示给使用者看 ——
 * 没有这个数字，"删除"按钮和"删掉 16,891 条课时"在界面上长得一模一样。
 */
export async function courseDeleteImpact(courseId: string): Promise<DeleteImpact> {
  if (!db) return { lessons: 0, sentences: 0 }
  const database = db

  const lessonRows = await database
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), aliveLesson))
  if (lessonRows.length === 0) return { lessons: 0, sentences: 0 }

  const [row] = await database
    .select({ n: sql<number>`COUNT(*)` })
    .from(sentences)
    .where(and(inArray(sentences.lessonId, lessonRows.map((l) => l.id)), aliveSentence))

  return { lessons: lessonRows.length, sentences: Number(row?.n ?? 0) }
}

/** 算"删这个课时会影响多少句子"。 */
export async function lessonDeleteImpact(lessonId: string): Promise<DeleteImpact> {
  if (!db) return { lessons: 0, sentences: 0 }
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(sentences)
    .where(and(eq(sentences.lessonId, lessonId), aliveSentence))
  return { lessons: 0, sentences: Number(row?.n ?? 0) }
}

/**
 * 软删除一门课程及其全部未删除的课时与句子。
 *
 * 整批共用一个时间戳（`deletedAt`），恢复时按它精确还原。
 * 返回影响面；课程不存在或本来就已删除时返回 null（调用方据此 404）。
 */
export async function softDeleteCourse(courseId: string): Promise<DeleteImpact | null> {
  if (!db) return null
  const database = db

  const [course] = await database
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), aliveCourse))
    .limit(1)
  if (!course) return null

  const lessonRows = await database
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), aliveLesson))
  const lessonIds = lessonRows.map((l) => l.id)

  const deletedAt = new Date()
  // 一次删除操作 = 一个批次：课程/课时/句子写同一个 batch，
  // 恢复时按它精确还原这一批（见文件顶部说明）
  const deletedBatch = randomUUID()
  let sentenceCount = 0

  await database.transaction(async (tx) => {
    if (lessonIds.length > 0) {
      const [cnt] = await tx
        .select({ n: sql<number>`COUNT(*)` })
        .from(sentences)
        .where(and(inArray(sentences.lessonId, lessonIds), aliveSentence))
      sentenceCount = Number(cnt?.n ?? 0)

      await tx
        .update(sentences)
        .set({ deletedAt, deletedBatch })
        .where(and(inArray(sentences.lessonId, lessonIds), aliveSentence))
      await tx.update(lessons).set({ deletedAt, deletedBatch }).where(inArray(lessons.id, lessonIds))
    }
    await tx.update(courses).set({ deletedAt, deletedBatch }).where(eq(courses.id, courseId))
  })

  await invalidateContentCountCaches()
  return { lessons: lessonIds.length, sentences: sentenceCount }
}

/** 软删除一个课时及其全部未删除的句子。 */
export async function softDeleteLesson(lessonId: string): Promise<DeleteImpact | null> {
  if (!db) return null
  const database = db

  const [lesson] = await database
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.id, lessonId), aliveLesson))
    .limit(1)
  if (!lesson) return null

  const deletedAt = new Date()
  // 一次删除操作 = 一个批次：课程/课时/句子写同一个 batch，
  // 恢复时按它精确还原这一批（见文件顶部说明）
  const deletedBatch = randomUUID()
  let sentenceCount = 0

  await database.transaction(async (tx) => {
    const [cnt] = await tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(sentences)
      .where(and(eq(sentences.lessonId, lessonId), aliveSentence))
    sentenceCount = Number(cnt?.n ?? 0)

    await tx
      .update(sentences)
      .set({ deletedAt, deletedBatch })
      .where(and(eq(sentences.lessonId, lessonId), aliveSentence))
    await tx.update(lessons).set({ deletedAt, deletedBatch }).where(eq(lessons.id, lessonId))
  })

  await invalidateContentCountCaches()
  return { lessons: 0, sentences: sentenceCount }
}

/** 软删除一个句子。返回 false 表示不存在或已删除。 */
export async function softDeleteSentence(sentenceId: string): Promise<boolean> {
  if (!db) return false
  const [row] = await db
    .select({ id: sentences.id })
    .from(sentences)
    .where(and(eq(sentences.id, sentenceId), aliveSentence))
    .limit(1)
  if (!row) return false

  await db.update(sentences).set({ deletedAt: new Date(), deletedBatch: randomUUID() }).where(eq(sentences.id, sentenceId))
  await invalidateContentCountCaches()
  return true
}

/**
 * 恢复一门课程**及其同批次的**课时与句子。
 *
 * 只恢复 `deleted_at` 等于该课程当前时间戳的那些行 —— 这样"删课程时连带删掉的"
 * 会一起回来，而"删除课程之前就已经被单独删掉的句子"不会被误复活。
 */
export async function restoreCourse(courseId: string): Promise<DeleteImpact | null> {
  if (!db) return null
  const database = db

  const [course] = await database
    .select({ id: courses.id, deletedBatch: courses.deletedBatch })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1)
  if (!course || !course.deletedBatch) return null

  const batch = course.deletedBatch
  let lessonCount = 0
  let sentenceCount = 0

  await database.transaction(async (tx) => {
    const lessonRows = await tx
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), eq(lessons.deletedBatch, batch)))
    const lessonIds = lessonRows.map((l) => l.id)
    lessonCount = lessonIds.length

    if (lessonIds.length > 0) {
      const [cnt] = await tx
        .select({ n: sql<number>`COUNT(*)` })
        .from(sentences)
        .where(and(inArray(sentences.lessonId, lessonIds), eq(sentences.deletedBatch, batch)))
      sentenceCount = Number(cnt?.n ?? 0)

      await tx
        .update(sentences)
        .set({ deletedAt: null, deletedBatch: null })
        .where(and(inArray(sentences.lessonId, lessonIds), eq(sentences.deletedBatch, batch)))
      await tx
        .update(lessons)
        .set({ deletedAt: null, deletedBatch: null })
        .where(and(inArray(lessons.id, lessonIds), eq(lessons.deletedBatch, batch)))
    }
    await tx.update(courses).set({ deletedAt: null, deletedBatch: null }).where(eq(courses.id, courseId))
  })

  await invalidateContentCountCaches()
  return { lessons: lessonCount, sentences: sentenceCount }
}

/** 恢复一个课时及其同批次的句子。 */
export async function restoreLesson(lessonId: string): Promise<DeleteImpact | null> {
  if (!db) return null
  const database = db

  const [lesson] = await database
    .select({ id: lessons.id, deletedBatch: lessons.deletedBatch })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1)
  if (!lesson || !lesson.deletedBatch) return null

  const batch = lesson.deletedBatch
  let sentenceCount = 0

  await database.transaction(async (tx) => {
    const [cnt] = await tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(sentences)
      .where(and(eq(sentences.lessonId, lessonId), eq(sentences.deletedBatch, batch)))
    sentenceCount = Number(cnt?.n ?? 0)

    await tx
      .update(sentences)
      .set({ deletedAt: null, deletedBatch: null })
      .where(and(eq(sentences.lessonId, lessonId), eq(sentences.deletedBatch, batch)))
    await tx.update(lessons).set({ deletedAt: null, deletedBatch: null }).where(eq(lessons.id, lessonId))
  })

  await invalidateContentCountCaches()
  return { lessons: 0, sentences: sentenceCount }
}

/** 恢复一个句子。返回 false 表示不存在或本来就没被删。 */
export async function restoreSentence(sentenceId: string): Promise<boolean> {
  if (!db) return false
  const [row] = await db
    .select({ id: sentences.id, deletedBatch: sentences.deletedBatch })
    .from(sentences)
    .where(eq(sentences.id, sentenceId))
    .limit(1)
  if (!row || !row.deletedBatch) return false

  await db
    .update(sentences)
    .set({ deletedAt: null, deletedBatch: null })
    .where(eq(sentences.id, sentenceId))
  await invalidateContentCountCaches()
  return true
}

/**
 * 删除/恢复会改变仪表盘「内容总量」的三个数（课程 / 课时 / 句子），
 * 所以三个缓存 key 都要失效。
 *
 * 只失效 totalSentences 是不够的 —— 删一门课程同时会减少课程数与课时数，
 * 测试里就抓到了这一点：删完之后仪表盘的「课程」还显示旧值，
 * 使用者会以为删除没生效。
 */
async function invalidateContentCountCaches(): Promise<void> {
  await Promise.all([
    invalidateCachedCount(STATS_KEYS.totalSentences),
    invalidateCachedCount(STATS_KEYS.totalCourses),
    invalidateCachedCount(STATS_KEYS.totalLessons),
  ])
}
