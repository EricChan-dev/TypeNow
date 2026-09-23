/**
 * 测试库直连：用于造夹具与断言副作用。
 *
 * 这里刻意绕开 drizzle，用原生 SQL：断言要检查的是「数据库里实际发生了什么」，
 * 若复用应用同一套 ORM 与类型，会把应用自身的编码错误一起当成事实。
 */
import mysql from "mysql2/promise"
import { TEST_DB_URL, assertTestDatabase } from "./env"

let pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (!pool) {
    assertTestDatabase(TEST_DB_URL)
    pool = mysql.createPool({
      uri: TEST_DB_URL,
      timezone: "+08:00",
      connectionLimit: 8,
      multipleStatements: true,
    })
  }
  return pool
}

export async function q<T = mysql.RowDataPacket[]>(
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const [rows] = await getPool().execute(sql, params as never[])
  return rows as T
}

/** 取单行；断言 helper 里用得多。 */
export async function one<T = mysql.RowDataPacket>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await q<T[]>(sql, params)
  return rows[0]
}

export async function scalar<T = number | string | null>(
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const row = await one<Record<string, T>>(sql, params)
  return row ? (Object.values(row)[0] as T) : (undefined as unknown as T)
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/** 测试库全部业务表。顺序无关（先关外键检查），但显式列出以便夹具重置可审计。 */
const TABLES = [
  "analytics_events",
  "check_ins",
  "courses",
  "diamond_logs",
  "invite_rewards",
  "lessons",
  "material_imports",
  "partner_commissions",
  "partner_risk_flags",
  "payment_orders",
  "post_likes",
  "posts",
  "practice_records",
  "review_queue",
  "sentence_knowledge",
  "sentences",
  "sessions",
  "site_config",
  "strengthen_sessions",
  "subscriptions",
  "task_logs",
  "tts_cache",
  "user_course_progress",
  "user_feedback",
  "user_notes",
  "users",
  "verification_codes",
  "withdrawal_requests",
  "word_dictionary_cache",
  "wordbook_items",
  "writing_entries",
]

export async function truncateAll(): Promise<void> {
  const conn = await getPool().getConnection()
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0")
    for (const t of TABLES) await conn.query(`TRUNCATE TABLE \`${t}\``)
    await conn.query("SET FOREIGN_KEY_CHECKS = 1")
  } finally {
    conn.release()
  }
}

// ─── 固定夹具 ID ────────────────────────────────────────────────────────────
// 全部写死 UUID 形态的常量，测试里可直接引用，失败时可从日志一眼认出。
export const FIXTURE = {
  coursePublished: "11111111-1111-4111-8111-000000000001",
  courseUnpublished: "11111111-1111-4111-8111-000000000002",
  lessonA1: "22222222-2222-4222-8222-000000000001",
  lessonA2: "22222222-2222-4222-8222-000000000002",
  lessonB1: "22222222-2222-4222-8222-000000000003",
  lessonEmpty: "22222222-2222-4222-8222-000000000004",
  sentA1Plain: "33333333-3333-4333-8333-000000000001",
  sentA1Curly: "33333333-3333-4333-8333-000000000002",
  sentA1Dash: "33333333-3333-4333-8333-000000000003",
  sentA2Plain: "33333333-3333-4333-8333-000000000004",
  sentB1Plain: "33333333-3333-4333-8333-000000000005",
  userFree: "44444444-4444-4444-8444-000000000001",
  userPro: "44444444-4444-4444-8444-000000000002",
  userPartner: "44444444-4444-4444-8444-000000000003",
  userInvitee: "44444444-4444-4444-8444-000000000004",
  userBuyer: "44444444-4444-4444-8444-000000000005",
  inviteCodePartner: "PARTNER8",
} as const

function words(sentence: string) {
  return sentence
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ english: w, chinese: null, phonetic: null, pos: "" }))
}

interface SeedSentence {
  id: string
  lessonId: string
  chinese: string
  english: string
  sortOrder: number
}

const SEED_SENTENCES: SeedSentence[] = [
  {
    id: FIXTURE.sentA1Plain,
    lessonId: FIXTURE.lessonA1,
    chinese: "我每天学习英语。",
    english: "I study English every day.",
    sortOrder: 0,
  },
  {
    // 弯引号 U+2019：Space 判分走 isTypingMatch（会归一化），Enter 提交若只做
    // toLowerCase 比较就会判错。这条句子专门用来看守这个差异。
    id: FIXTURE.sentA1Curly,
    lessonId: FIXTURE.lessonA1,
    chinese: "我不知道。",
    english: "I don\u2019t know.",
    sortOrder: 1,
  },
  {
    // 破折号 U+2014：同上
    id: FIXTURE.sentA1Dash,
    lessonId: FIXTURE.lessonA1,
    chinese: "这是一本众所周知的畅销书。",
    english: "This is a well\u2014known bestseller.",
    sortOrder: 2,
  },
  {
    id: FIXTURE.sentA2Plain,
    lessonId: FIXTURE.lessonA2,
    chinese: "她是一名老师。",
    english: "She is a teacher.",
    sortOrder: 0,
  },
  {
    id: FIXTURE.sentB1Plain,
    lessonId: FIXTURE.lessonB1,
    chinese: "这是一节未发布课程的句子。",
    english: "This sentence belongs to an unpublished course.",
    sortOrder: 0,
  },
]

export async function seedFixtures(): Promise<void> {
  await truncateAll()

  await q(
    `INSERT INTO courses (id, title, description, source, source_name, is_published, learner_count, usage_count)
     VALUES (?, ?, ?, 'official', '官方', 1, 0, 0), (?, ?, ?, 'official', '官方', 0, 0, 0)`,
    [
      FIXTURE.coursePublished,
      "测试课程·已发布",
      "e2e 夹具课程",
      FIXTURE.courseUnpublished,
      "测试课程·未发布",
      "e2e 夹具课程（不应出现在广场）",
    ]
  )

  await q(
    `INSERT INTO lessons (id, course_id, title, summary, sort_order) VALUES
     (?, ?, '第一课', 'e2e', 0),
     (?, ?, '第二课', 'e2e', 1),
     (?, ?, '未发布课', 'e2e', 0),
     (?, ?, '空课时', 'e2e', 2)`,
    [
      FIXTURE.lessonA1,
      FIXTURE.coursePublished,
      FIXTURE.lessonA2,
      FIXTURE.coursePublished,
      FIXTURE.lessonB1,
      FIXTURE.courseUnpublished,
      FIXTURE.lessonEmpty,
      FIXTURE.coursePublished,
    ]
  )

  for (const s of SEED_SENTENCES) {
    await q(
      `INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, words, words_count)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
      [
        s.id,
        s.chinese,
        s.english,
        s.lessonId,
        s.sortOrder,
        JSON.stringify(words(s.english)),
        words(s.english).length,
      ]
    )
  }

  const future = "2099-01-01 00:00:00"
  await q(
    `INSERT INTO users (id, phone, name, is_pro, pro_expires, is_partner, invite_code, referred_by, diamonds, total_score, level)
     VALUES
     (?, '13800000001', '普通用户', 0, NULL, 0, 'FREEEE01', NULL, 0, 0, 1),
     (?, '13800000002', '会员用户', 1, ?, 0, 'PROUSER1', NULL, 0, 0, 1),
     (?, '13800000003', '合伙人',   1, ?, 1, ?, NULL, 0, 0, 1),
     (?, '13800000004', '被邀请人', 0, NULL, 0, 'INVITEE1', ?, 0, 0, 1),
     (?, '13800000005', '买家',     0, NULL, 0, 'BUYER001', ?, 0, 0, 1)`,
    [
      FIXTURE.userFree,
      FIXTURE.userPro,
      future,
      FIXTURE.userPartner,
      future,
      FIXTURE.inviteCodePartner,
      FIXTURE.userInvitee,
      FIXTURE.userPartner,
      FIXTURE.userBuyer,
      FIXTURE.userPartner,
    ]
  )
}

/** 某些用例需要"干净的用户"，避免夹具互相影响。 */
const USER_ID_TABLES = [
  "practice_records",
  "review_queue",
  "wordbook_items",
  "user_notes",
  "user_course_progress",
  "check_ins",
  "diamond_logs",
  "payment_orders",
  "subscriptions",
  "verification_codes",
  "task_logs",
  "sessions",
  "analytics_events",
  "posts",
  "user_feedback",
  "strengthen_sessions",
  "writing_entries",
]

export async function deleteUserData(userId: string): Promise<void> {
  for (const t of USER_ID_TABLES) {
    await q(`DELETE FROM \`${t}\` WHERE user_id = ?`, [userId])
  }
  // 这两张表的归属列名不同，单独处理，避免 "Unknown column" 把用例挂掉
  await q(`DELETE FROM partner_commissions WHERE partner_id = ? OR referred_user_id = ?`, [
    userId,
    userId,
  ])
  await q(`DELETE FROM withdrawal_requests WHERE partner_id = ?`, [userId])
  await q(`DELETE FROM partner_risk_flags WHERE user_id = ?`, [userId])
}
