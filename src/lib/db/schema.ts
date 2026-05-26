import {
  mysqlTable,
  varchar,
  text,
  mediumtext,
  int,
  tinyint,
  datetime,
  bigint,
  json,
  mysqlEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

// ─── Users (replaces Supabase auth.users + profiles) ─────────────────────────
export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    phone: varchar("phone", { length: 20 }).unique(),
    email: varchar("email", { length: 255 }).unique(),
    name: varchar("name", { length: 100 }),
    avatar: text("avatar"),
    wechatOpenid: varchar("wechat_openid", { length: 100 }).unique(),
    wechatUnionid: varchar("wechat_unionid", { length: 100 }),
    level: int("level").notNull().default(1),
    totalScore: int("total_score").notNull().default(0),
    isPro: tinyint("is_pro").notNull().default(0),
    proExpires: datetime("pro_expires"),
    role: mysqlEnum("role", ["user", "admin"]).notNull().default("user"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_users_wechat_openid").on(t.wechatOpenid),
  ]
)

// ─── Sessions (replaces Supabase JWT) ────────────────────────────────────────
export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_sessions_user_id").on(t.userId),
    index("idx_sessions_expires").on(t.expiresAt),
  ]
)

// ─── Verification Codes ───────────────────────────────────────────────────────
export const verificationCodes = mysqlTable(
  "verification_codes",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    phone: varchar("phone", { length: 20 }).notNull(),
    code: varchar("code", { length: 10 }).notNull(),
    expiresAt: datetime("expires_at").notNull(),
    used: tinyint("used").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_verification_codes_phone").on(t.phone),
    index("idx_verification_codes_expires").on(t.expiresAt),
  ]
)

// ─── Courses ─────────────────────────────────────────────────────────────────
export const courses = mysqlTable("courses", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  coverUrl: mediumtext("cover_url"),
  source: mysqlEnum("source", ["official", "user"]).notNull().default("official"),
  sourceName: varchar("source_name", { length: 100 }).notNull().default("官方"),
  sourceAvatar: text("source_avatar"),
  categoryKey: varchar("category_key", { length: 100 }),
  subCategoryKey: varchar("sub_category_key", { length: 100 }),
  learnerCount: int("learner_count").notNull().default(0),
  usageCount: int("usage_count").notNull().default(0),
  isPublished: tinyint("is_published").notNull().default(0),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
})

// ─── Lessons ─────────────────────────────────────────────────────────────────
export const lessons = mysqlTable(
  "lessons",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    courseId: varchar("course_id", { length: 36 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    summary: text("summary"),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_lessons_course_id").on(t.courseId)]
)

// ─── Material Imports ─────────────────────────────────────────────────────────
export const materialImports = mysqlTable("material_imports", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  lessonId: varchar("lesson_id", { length: 36 }),
  filename: varchar("filename", { length: 255 }).notNull(),
  fileType: mysqlEnum("file_type", ["pdf", "txt"]).notNull(),
  rawText: text("raw_text"),
  status: mysqlEnum("status", ["pending", "processing", "done", "error"])
    .notNull()
    .default("pending"),
  errorMsg: text("error_msg"),
  sentenceCount: int("sentence_count"),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
})

// ─── Sentences ────────────────────────────────────────────────────────────────
export const sentences = mysqlTable(
  "sentences",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    chinese: text("chinese").notNull(),
    english: text("english").notNull(),
    wordsCount: int("words_count"),
    category: varchar("category", { length: 100 }),
    difficulty: int("difficulty").default(1),
    tags: json("tags").$type<string[]>(),
    lessonId: varchar("lesson_id", { length: 36 }),
    words: json("words").$type<Array<{
      english: string
      chinese: string | null
      phonetic: string | null
      pos: string
    }>>(),
    chunks: json("chunks").$type<Array<{
      order: number
      text: string
      chinese: string
    }>>(),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_sentences_lesson_id").on(t.lessonId)]
)

// ─── Practice Records ─────────────────────────────────────────────────────────
export const practiceRecords = mysqlTable(
  "practice_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    sentenceId: varchar("sentence_id", { length: 36 }).notNull(),
    userInput: text("user_input"),
    score: int("score"),
    mistakes: int("mistakes").notNull().default(0),
    isReview: tinyint("is_review").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_practice_records_user_id").on(t.userId)]
)

// ─── Review Queue ─────────────────────────────────────────────────────────────
export const reviewQueue = mysqlTable(
  "review_queue",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    sentenceId: varchar("sentence_id", { length: 36 }).notNull(),
    userWrong: text("user_wrong"),
    reviewCount: int("review_count").notNull().default(0),
    consecutiveOk: int("consecutive_ok").notNull().default(0),
    nextReviewAt: datetime("next_review_at"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_review_queue_user_id").on(t.userId)]
)

// ─── Strengthen Sessions ──────────────────────────────────────────────────────
export const strengthenSessions = mysqlTable("strengthen_sessions", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  userId: varchar("user_id", { length: 36 }).notNull(),
  type: varchar("type", { length: 20 }),
  analysis: json("analysis"),
  content: json("content"),
  result: json("result"),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
})

// ─── Writing Entries ──────────────────────────────────────────────────────────
export const writingEntries = mysqlTable("writing_entries", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  userId: varchar("user_id", { length: 36 }).notNull(),
  topic: text("topic"),
  originalText: text("original_text"),
  aiReport: json("ai_report"),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
})

// ─── Payment Orders ───────────────────────────────────────────────────────────
export const paymentOrders = mysqlTable(
  "payment_orders",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    plan: mysqlEnum("plan", ["monthly", "yearly"]).notNull(),
    amount: int("amount").notNull(),
    outTradeNo: varchar("out_trade_no", { length: 64 }).notNull().unique(),
    transactionId: varchar("transaction_id", { length: 64 }),
    codeUrl: text("code_url"),
    status: mysqlEnum("status", ["pending", "paid", "expired", "cancelled"])
      .notNull()
      .default("pending"),
    paidAt: datetime("paid_at"),
    expiresAt: datetime("expires_at"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_payment_orders_user_id").on(t.userId),
    uniqueIndex("idx_payment_orders_out_trade_no").on(t.outTradeNo),
    index("idx_payment_orders_status").on(t.status),
  ]
)

// ─── Subscriptions ────────────────────────────────────────────────────────────
export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    plan: mysqlEnum("plan", ["monthly", "yearly"]).notNull(),
    status: mysqlEnum("status", ["active", "cancelled", "expired"])
      .notNull()
      .default("active"),
    paymentOrderId: varchar("payment_order_id", { length: 36 }),
    startsAt: datetime("starts_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: datetime("expires_at").notNull(),
    cancelledAt: datetime("cancelled_at"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_subscriptions_user_id").on(t.userId),
    index("idx_subscriptions_expires").on(t.expiresAt),
  ]
)

// ─── Site Config ──────────────────────────────────────────────────────────────
export const siteConfig = mysqlTable("site_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: json("value").notNull(),
  updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
})

// ─── Analytics Events ─────────────────────────────────────────────────────────
export const analyticsEvents = mysqlTable(
  "analytics_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    userId: varchar("user_id", { length: 36 }),
    properties: json("properties").default({}),
    pageUrl: text("page_url"),
    sessionId: varchar("session_id", { length: 64 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_ae_type_time").on(t.eventType, t.createdAt),
    index("idx_ae_user").on(t.userId),
  ]
)

// ─── Sentence Knowledge Cache ─────────────────────────────────────────────────
export const sentenceKnowledge = mysqlTable(
  "sentence_knowledge",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    sentenceHash: varchar("sentence_hash", { length: 64 }).notNull().unique(),
    sentenceText: text("sentence_text").notNull(),
    data: json("data").notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("idx_sentence_knowledge_hash").on(t.sentenceHash)]
)

// ─── TTS Cache ────────────────────────────────────────────────────────────────
export const ttsCache = mysqlTable(
  "tts_cache",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    cacheKey: varchar("cache_key", { length: 64 }).notNull().unique(),
    text: text("text").notNull(),
    voiceName: varchar("voice_name", { length: 50 }).notNull(),
    audioData: text("audio_data").notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("idx_tts_cache_key").on(t.cacheKey)]
)

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Course = typeof courses.$inferSelect
export type Lesson = typeof lessons.$inferSelect
export type Sentence = typeof sentences.$inferSelect
export type PracticeRecord = typeof practiceRecords.$inferSelect
export type PaymentOrder = typeof paymentOrders.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect
