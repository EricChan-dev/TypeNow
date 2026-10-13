import { sql, type SQL } from "drizzle-orm"
import { usableSentenceSql } from "@/lib/sentence-quality"

/**
 * 错题本聚合查询的共享 SQL 构件。
 *
 * 参考站（句游英语 /User/MistakeBook）把三类记录混在一张列表里：
 *   · 错题        —— 自动进队列，本库对应 review_queue（原句级，UNIQUE(user_id, sentence_id)）
 *   · 收藏句子    —— 手动收藏，本库对应 sentence_favorites（练习项级，id 可能带 `_c<order>`）
 *   · 收藏单词    —— 手动收藏，本库对应 wordbook_items
 *
 * 三张表结构完全不同，却要在一个分页列表里按统一时间序混排 —— 唯一可行的写法是
 * 把每个来源各写成一个**列名对齐的 SELECT 分支**，用 UNION ALL 拼起来再统一分页。
 * 逐分支各自分页再合并是错的：全局第 2 页会从每个来源各取第 2 页，顺序错乱。
 *
 * 分支里全部用字面量别名（rq/sf/wb/s/l/c）+ 字面量列名，**不要**用 aliveSentence
 * 这类 drizzle 片段：片段渲染成限定名 `sentences`.`deleted_at`，而表一旦取了别名
 * 原表名即失效（ER_BAD_FIELD_ERROR，src/app/api/lessons/[id]/insight/route.ts:52
 * 有实测记录）。usableSentenceSql 例外 —— 它接受列片段参数，传入 sql`s.chinese`
 * 即可正确渲染成别名限定形式。
 */

export type MistakeSource = "mistake" | "sentence" | "word" | "all"

/** 非法值一律回落 all（与参考站 sourceType 缺省行为一致），不抛 400。 */
export function parseMistakeSource(raw: string | null | undefined): MistakeSource {
  if (raw === "mistake" || raw === "sentence" || raw === "word") return raw
  return "all"
}

/**
 * LIKE 关键字里的 `%` / `_` / `\` 必须转义，否则用户搜「100%」会把 `%` 当通配符，
 * 搜出一堆不相干的行。配对使用 escapeLikeLike + ESCAPE 子句（见下方 likeMatch）。
 */
export function escapeLikeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** ESCAPE 子句的转义字符，以绑定参数下发，避免在 SQL 文本里手写反斜杠转义。 */
const LIKE_ESCAPE_CHAR = "\\"

/** 把搜索词变成 `%词%` 模式（含通配符转义），供 LIKE ... ESCAPE 使用。 */
export function likeMatch(raw: string): string {
  return `%${escapeLikeLike(raw)}%`
}

/** 搜索关键词的清洗上限：参考站 searchInp 无长度限制，这里兜住病态输入。 */
export const MAX_SEARCH_LENGTH = 100

/** 三个来源统一的筛选口径（课程 / 课节 / 关键词）。 */
export interface MistakeBookScope {
  userId: string
  courseId?: string | null
  lessonId?: string | null
  q?: string | null
}

/**
 * UNION 各分支的统一列清单。三个分支的 SELECT 列必须**逐列对齐**
 * （列名、顺序、数量），多一列少一列都会让 UNION 按位置错位拼行。
 */
const UNIFIED_COLUMNS = sql`
  kind, item_key, ts, english, chinese, word,
  courseTitle, lessonTitle, courseId, lessonId, userWrong, reviewCount`

/** 错题分支：review_queue ⋈ sentences（内联，软删/脏句剔除）⋈ lessons/courses。 */
export function mistakeBranch(o: MistakeBookScope): SQL {
  const conds: SQL[] = [sql`rq.user_id = ${o.userId}`]
  if (o.courseId) conds.push(sql`c.id = ${o.courseId} AND c.deleted_at IS NULL`)
  if (o.lessonId) conds.push(sql`l.id = ${o.lessonId} AND l.deleted_at IS NULL`)
  if (o.q) {
    const p = likeMatch(o.q)
    conds.push(sql`(s.english LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR} OR s.chinese LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR})`)
  }
  // 脏句条件与 review/list 的口径一致：列表与计数必须同条件，否则「徽标有数点进去是空」。
  const usable = usableSentenceSql(sql`s.chinese`, sql`s.english`)
  return sql`
    SELECT 'mistake' AS kind, rq.sentence_id AS item_key, rq.created_at AS ts,
           s.english AS english, s.chinese AS chinese, NULL AS word,
           c.title AS courseTitle, l.title AS lessonTitle,
           c.id AS courseId, l.id AS lessonId,
           rq.user_wrong AS userWrong, rq.review_count AS reviewCount
    FROM review_queue rq
    INNER JOIN sentences s ON s.id = rq.sentence_id AND s.deleted_at IS NULL
    LEFT JOIN lessons l ON l.id = s.lesson_id
    LEFT JOIN courses c ON c.id = l.course_id
    WHERE ${sql.join(conds, sql` AND `)} AND ${usable}`
}

/**
 * 收藏句子分支：sentence_favorites 是练习项级快照（id 可带 `_c<order>`）。
 *
 * · 展示文本优先用快照 sentence_text（原句被改/删后收藏夹仍能看到当时的内容），
 *   快照为空才回落 join 出来的原句英文。
 * · join 原句用 SUBSTRING_INDEX(sentence_id, '_c', 1) 剥分块后缀。它比
 *   JS 侧的 `/_c\d+$/` 规则宽（slug 形态 id 中段的 `_c` 也会被切），但切错的
 *   结果只是 join 不中、翻译为 NULL，快照仍照常展示 —— 不会错配到别的句子。
 * · 课程/课节过滤用收藏行自带的 course_id/lesson_id 快照列（练习页收藏时写入），
 *   不经过原句 —— 否则句子换课后收藏会「跟丢」课程。
 */
export function favoriteBranch(o: MistakeBookScope): SQL {
  const conds: SQL[] = [sql`sf.user_id = ${o.userId}`]
  if (o.courseId) conds.push(sql`sf.course_id = ${o.courseId}`)
  if (o.lessonId) conds.push(sql`sf.lesson_id = ${o.lessonId}`)
  if (o.q) {
    const p = likeMatch(o.q)
    conds.push(
      sql`(sf.sentence_text LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR} OR s.chinese LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR} OR s.english LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR})`,
    )
  }
  return sql`
    SELECT 'sentence' AS kind, sf.id AS item_key, sf.created_at AS ts,
           COALESCE(NULLIF(sf.sentence_text, ''), s.english) AS english,
           s.chinese AS chinese, NULL AS word,
           c.title AS courseTitle, l.title AS lessonTitle,
           c.id AS courseId, l.id AS lessonId,
           NULL AS userWrong, NULL AS reviewCount
    FROM sentence_favorites sf
    LEFT JOIN sentences s ON s.id = SUBSTRING_INDEX(sf.sentence_id, '_c', 1) AND s.deleted_at IS NULL
    LEFT JOIN lessons l ON l.id = sf.lesson_id
    LEFT JOIN courses c ON c.id = sf.course_id
    WHERE ${sql.join(conds, sql` AND `)}`
}

/**
 * 收藏单词分支：wordbook_items.source_sentence_id 指回原句（36 字符，无分块后缀），
 * 课程/课节口径与错题分支一致（经原句 → lesson → course，且要求课程/课节未删）。
 */
export function wordBranch(o: MistakeBookScope): SQL {
  const conds: SQL[] = [sql`wb.user_id = ${o.userId}`]
  if (o.courseId) conds.push(sql`c.id = ${o.courseId} AND c.deleted_at IS NULL`)
  if (o.lessonId) conds.push(sql`l.id = ${o.lessonId} AND l.deleted_at IS NULL`)
  if (o.q) {
    const p = likeMatch(o.q)
    conds.push(
      sql`(wb.word LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR} OR s.chinese LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR} OR s.english LIKE ${p} ESCAPE ${LIKE_ESCAPE_CHAR})`,
    )
  }
  return sql`
    SELECT 'word' AS kind, wb.word AS item_key, wb.created_at AS ts,
           COALESCE(s.english, '') AS english, COALESCE(s.chinese, '') AS chinese,
           wb.word AS word,
           c.title AS courseTitle, l.title AS lessonTitle,
           c.id AS courseId, l.id AS lessonId,
           NULL AS userWrong, NULL AS reviewCount
    FROM wordbook_items wb
    LEFT JOIN sentences s ON s.id = wb.source_sentence_id AND s.deleted_at IS NULL
    LEFT JOIN lessons l ON l.id = s.lesson_id
    LEFT JOIN courses c ON c.id = l.course_id
    WHERE ${sql.join(conds, sql` AND `)}`
}

/** 单一来源或三来源 UNION 的内层查询（外层再套排序 + 分页 / 计数）。 */
export function mistakeBookInner(source: MistakeSource, o: MistakeBookScope): SQL {
  if (source === "mistake") return mistakeBranch(o)
  if (source === "sentence") return favoriteBranch(o)
  if (source === "word") return wordBranch(o)
  return sql`(${mistakeBranch(o)}) UNION ALL (${favoriteBranch(o)}) UNION ALL (${wordBranch(o)})`
}

/** 统一时间序（ts DESC）+ 分页。 */
export function mistakeBookPage(inner: SQL, pageSize: number, offset: number): SQL {
  return sql`SELECT ${UNIFIED_COLUMNS} FROM (${inner}) AS mb ORDER BY mb.ts DESC LIMIT ${pageSize} OFFSET ${offset}`
}

/** 与列表同条件的总数（分页器要用）。 */
export function mistakeBookCount(inner: SQL): SQL {
  return sql`SELECT COUNT(*) AS total FROM (${inner}) AS mb`
}

/** 统一行形态（db.execute 解包后每一行的类型）。 */
export interface MistakeBookRow {
  kind: "mistake" | "sentence" | "word"
  item_key: string
  ts: string | Date | null
  english: string | null
  chinese: string | null
  word: string | null
  courseTitle: string | null
  lessonTitle: string | null
  courseId: string | null
  lessonId: string | null
  userWrong: string | null
  reviewCount: number | string | null
}
