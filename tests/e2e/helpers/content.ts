/**
 * 造课程内容的小工具（课程 → 课时 → 句子）。
 *
 * 与 helpers/db.ts 的 seedFixtures 互补：夹具负责「一套固定的、可预测的目录」，
 * 这里负责「用例临时需要一条自己的课程/课时/句子」。全部直接写库，不经应用代码。
 */
import { q } from "./db"

/** 造一条句子。words/words_count 与 seedFixtures 保持同一口径（按空格切分、去标点）。 */
export async function insertSentence(
  opts: {
    chinese?: string
    english?: string
    lessonId?: string
    sortOrder?: number
  } = {}
): Promise<{ sentenceId: string }> {
  const sentenceId = crypto.randomUUID()
  const english = opts.english ?? "This is a generated sentence."
  const words = english
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ english: w, chinese: null, phonetic: null, pos: "" }))
  await q(
    `INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, words, words_count)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [
      sentenceId,
      opts.chinese ?? "这是一条自动生成的句子。",
      english,
      opts.lessonId ?? null,
      opts.sortOrder ?? 0,
      JSON.stringify(words),
      words.length,
    ]
  )
  return { sentenceId }
}

/** 造一条课程。默认已发布，方便直接出现在课程广场。 */
export async function insertCourse(
  opts: { title?: string; isPublished?: number } = {}
): Promise<{ courseId: string }> {
  const courseId = crypto.randomUUID()
  await q(
    `INSERT INTO courses (id, title, description, source, source_name, is_published, learner_count, usage_count)
     VALUES (?, ?, 'e2e 临时课程', 'official', '官方', ?, 0, 0)`,
    [courseId, opts.title ?? "e2e 临时课程", opts.isPublished ?? 1]
  )
  return { courseId }
}

/** 造一条课时。 */
export async function insertLesson(
  courseId: string,
  opts: { title?: string; sortOrder?: number } = {}
): Promise<{ lessonId: string }> {
  const lessonId = crypto.randomUUID()
  await q(
    `INSERT INTO lessons (id, course_id, title, summary, sort_order) VALUES (?, ?, ?, 'e2e', ?)`,
    [lessonId, courseId, opts.title ?? "e2e 临时课时", opts.sortOrder ?? 0]
  )
  return { lessonId }
}
