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
  decimal,
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
    wechatAccessToken: text("wechat_access_token"),
    wechatRefreshToken: text("wechat_refresh_token"),
    wechatTokenExpiresAt: datetime("wechat_token_expires_at"),
    level: int("level").notNull().default(1),
    totalScore: int("total_score").notNull().default(0),
    isPro: tinyint("is_pro").notNull().default(0),
    proExpires: datetime("pro_expires"),
    role: mysqlEnum("role", ["user", "admin"]).notNull().default("user"),
    inviteCode: varchar("invite_code", { length: 12 }).unique(),
    referredBy: varchar("referred_by", { length: 36 }),
    referralLockedUntil: datetime("referral_locked_until"),
    isPartner: tinyint("is_partner").notNull().default(0),
    partnerAgreedAt: datetime("partner_agreed_at"),
    diamonds: int("diamonds").notNull().default(0),
    checkInGoal: int("check_in_goal").notNull().default(50),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_users_wechat_openid").on(t.wechatOpenid),
    uniqueIndex("idx_users_wechat_unionid").on(t.wechatUnionid),
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
    ip: varchar("ip", { length: 50 }).notNull().default(""),
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
    intervalDays: int("interval_days").notNull().default(1),
    easeFactor: decimal("ease_factor", { precision: 4, scale: 2 }).notNull().default("2.50"),
    nextReviewAt: datetime("next_review_at"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_review_queue_user_id").on(t.userId),
    uniqueIndex("uk_review_user_sentence").on(t.userId, t.sentenceId),
  ]
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
    plan: mysqlEnum("plan", ["monthly", "yearly", "partner"]).notNull(),
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
    plan: mysqlEnum("plan", ["monthly", "yearly", "partner"]).notNull(),
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

// ─── Partner Commissions ──────────────────────────────────────────────────────
export const partnerCommissions = mysqlTable(
  "partner_commissions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    partnerId: varchar("partner_id", { length: 36 }).notNull(),
    orderId: varchar("order_id", { length: 36 }).notNull(),
    referredUserId: varchar("referred_user_id", { length: 36 }).notNull(),
    grossAmount: int("gross_amount").notNull(),
    commissionAmount: int("commission_amount").notNull(),
    rate: decimal("rate", { precision: 4, scale: 2 }).notNull(),
    commissionType: mysqlEnum("commission_type", ["first", "renewal"]).notNull(),
    status: mysqlEnum("status", ["cooling", "available", "withdrawn", "clawed_back"])
      .notNull()
      .default("cooling"),
    availableAt: datetime("available_at").notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_pc_partner_id").on(t.partnerId),
    index("idx_pc_referred_user").on(t.referredUserId),
    index("idx_pc_status").on(t.status),
    uniqueIndex("idx_pc_order_id").on(t.orderId),
  ]
)

// ─── Withdrawal Requests ──────────────────────────────────────────────────────
export const withdrawalRequests = mysqlTable(
  "withdrawal_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    partnerId: varchar("partner_id", { length: 36 }).notNull(),
    amount: int("amount").notNull(),
    wechatOpenid: varchar("wechat_openid", { length: 100 }),
    partnerTradeNo: varchar("partner_trade_no", { length: 64 }).unique(),
    wxTransferId: varchar("wx_transfer_id", { length: 64 }),
    status: mysqlEnum("status", ["pending", "processing", "completed", "failed"])
      .notNull()
      .default("pending"),
    failReason: text("fail_reason"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: datetime("completed_at"),
  },
  (t) => [
    index("idx_wr_partner_id").on(t.partnerId),
    index("idx_wr_status").on(t.status),
  ]
)

// ─── Partner Risk Flags ───────────────────────────────────────────────────────
export const partnerRiskFlags = mysqlTable(
  "partner_risk_flags",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    flagType: mysqlEnum("flag_type", ["duplicate_ip", "abnormal_frequency", "manual"]).notNull(),
    detail: text("detail"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_prf_user_id").on(t.userId)]
)

// ─── Diamond Logs ─────────────────────────────────────────────────────────────
export const diamondLogs = mysqlTable(
  "diamond_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    amount: int("amount").notNull(),
    durationSeconds: int("duration_seconds"),
    type: mysqlEnum("type", ["sentence", "lesson_complete", "course_complete"]).notNull(),
    refId: varchar("ref_id", { length: 36 }),
    streak: int("streak").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_diamond_logs_user_id").on(t.userId),
    index("idx_diamond_logs_user_created").on(t.userId, t.createdAt),
  ]
)

// ─── Check-ins (daily sign-in streaks) ───────────────────────────────────────
export const checkIns = mysqlTable(
  "check_ins",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    date: varchar("date", { length: 10 }).notNull(), // "YYYY-MM-DD"
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_check_ins_user_id").on(t.userId),
    uniqueIndex("idx_check_ins_user_date").on(t.userId, t.date),
  ]
)

// ─── User Course Progress ─────────────────────────────────────────────────────
export const userCourseProgress = mysqlTable(
  "user_course_progress",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    courseId: varchar("course_id", { length: 36 }).notNull(),
    lastStudiedAt: datetime("last_studied_at").notNull(),
    sentenceCount: int("sentence_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("uk_user_course").on(t.userId, t.courseId),
    index("idx_ucp_user").on(t.userId),
  ]
)

// ─── Word Dictionary Cache (shared across all users) ─────────────────────────
export const wordDictionaryCache = mysqlTable(
  "word_dictionary_cache",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    word: varchar("word", { length: 128 }).notNull(),
    phonetic: varchar("phonetic", { length: 64 }),
    phoneticUk: varchar("phonetic_uk", { length: 64 }),
    translations: json("translations").$type<string[]>().notNull(),
    pos: json("pos").$type<{ pos: string; meaning: string }[]>(),
    synonyms: json("synonyms").$type<string[]>(),
    examples: json("examples").$type<{ en: string; zh: string }[]>(),
    webTranslations: json("web_translations").$type<{ key: string; value: string[] }[]>(),
    raw: json("raw"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uniq_word").on(t.word)]
)

// ─── Wordbook Items (per-user collection) ────────────────────────────────────
export const wordbookItems = mysqlTable(
  "wordbook_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    word: varchar("word", { length: 128 }).notNull(),
    sourceSentenceId: varchar("source_sentence_id", { length: 36 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uniq_user_word").on(t.userId, t.word),
    index("idx_wordbook_user").on(t.userId),
  ]
)

// ─── User Notes (independent of sentences) ───────────────────────────────────
export const userNotes = mysqlTable(
  "user_notes",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    title: varchar("title", { length: 200 }).notNull().default(""),
    content: text("content").notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_user_notes_user").on(t.userId, t.updatedAt)]
)

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type CheckIn = typeof checkIns.$inferSelect
export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Course = typeof courses.$inferSelect
export type Lesson = typeof lessons.$inferSelect
export type Sentence = typeof sentences.$inferSelect
export type PracticeRecord = typeof practiceRecords.$inferSelect
export type PaymentOrder = typeof paymentOrders.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect
export type PartnerCommission = typeof partnerCommissions.$inferSelect
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect
export type PartnerRiskFlag = typeof partnerRiskFlags.$inferSelect
export type UserCourseProgress = typeof userCourseProgress.$inferSelect
export type DiamondLog = typeof diamondLogs.$inferSelect
export type WordDictionaryCache = typeof wordDictionaryCache.$inferSelect
export type WordbookItem = typeof wordbookItems.$inferSelect
export type UserNote = typeof userNotes.$inferSelect
