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
    /**
     * 体验会员（注册试用）的领取时间。NULL = 尚未领取。
     *
     * 领取走条件更新 `WHERE trial_claimed_at IS NULL` + affectedRows 判定，
     * 保证并发/重复请求只成功一次。
     *
     * 「按手机号一次性」的依据见 db/migrations/00012_trial_claim.sql：
     * phone 与 wechat_openid 都是 UNIQUE，且注册是 find-or-create，
     * 所以「每账号一次」天然等于「每手机号一次」。
     */
    trialClaimedAt: datetime("trial_claimed_at"),
    role: mysqlEnum("role", ["user", "admin"]).notNull().default("user"),
    inviteCode: varchar("invite_code", { length: 12 }).unique(),
    referredBy: varchar("referred_by", { length: 36 }),
    referralLockedUntil: datetime("referral_locked_until"),
    isPartner: tinyint("is_partner").notNull().default(0),
    partnerAgreedAt: datetime("partner_agreed_at"),
    diamonds: int("diamonds").notNull().default(0),
    checkInGoal: int("check_in_goal").notNull().default(50),
    /**
     * 注册渠道（可筛可 GROUP BY 的那根主轴）。取值见 lib/signup-source.ts 的
     * SIGNUP_CHANNELS。存量行为 NULL —— 那时的来源无法从数据库还原。
     */
    signupChannel: varchar("signup_channel", { length: 30 }),
    /**
     * 注册来源明细（JSON）。键集合固定，写入必须走 buildSignupSource 白名单清洗：
     * 微信侧的 scene / qrScene / subscribedAt，首触的 referrer / landing / utm，
     * 以及注册那次请求的 requestReferrer / userAgent / ip。
     *
     * 为什么是 JSON 而不是再加七列：这批字段是「微信给了什么 + 这次请求带了什么」，
     * 天生开放（以后加 UTM、设备、小程序场景号都不必再迁表）。理由与
     * db/migrations/00023 的说明一致。
     */
    signupSource: json("signup_source"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_users_wechat_openid").on(t.wechatOpenid),
    uniqueIndex("idx_users_wechat_unionid").on(t.wechatUnionid),
    index("idx_users_created_at").on(t.createdAt),
    // 后台按"领取体验会员"的时间范围筛（仪表盘指标 + 用户列表的 trial=1 钻取）
    index("idx_users_trial_claimed_at").on(t.trialClaimedAt),
    // 「按来源统计/筛选」用的轴
    index("idx_users_signup_channel").on(t.signupChannel),
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
  /**
   * 软删除标记，见 db/migrations/00016_soft_delete.sql。
   *
   * 为什么是两列：
   *   deletedAt    —— 什么时候删的（展示用）
   *   deletedBatch —— 哪一次删除操作（**恢复时的唯一依据**）
   *
   * 批次**不能**用 deletedAt 的时间戳代替：本仓库 drizzle 的 datetime 映射
   * （src/lib/db/index.ts 的 toDbDateTime）只取到「秒」，同一秒内两次删除会
   * 得到相同的值、恢复时互相串台（这是上线前被测试证伪的方案）。
   * 显式 UUID 批次不依赖时间精度。NULL = 正常。
   */
  deletedAt: datetime("deleted_at", { fsp: 3 }),
  deletedBatch: varchar("deleted_batch", { length: 36 }),
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
    /** 软删除标记，语义见 courses.deletedAt / deletedBatch。NULL = 正常。 */
    deletedAt: datetime("deleted_at", { fsp: 3 }),
    deletedBatch: varchar("deleted_batch", { length: 36 }),
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
      /**
       * 历史遗留两种形态：句乐部导入的是 { uk, us } 对象，AI 解析产出的是字符串。
       * 不要收窄成 string —— 曾因 String(对象) 把 17 万行写成 "[object Object]"。
       */
      phonetic: string | { uk: string; us: string } | null
      pos: string
    }>>(),
    chunks: json("chunks").$type<Array<{
      order: number
      text: string
      chinese: string
    }>>(),
    sortOrder: int("sort_order").notNull().default(0),
    dependencyAnalysis: json("dependency_analysis").$type<{
      root: number
      sentence: string
      edges: Array<{ label: string; source: number; target: number }>
      nodes: Array<{
        id: number
        dep: string
        pos: string
        tag: string
        head: string
        word: string
        lemma: string
        phrase: string
        children: number[]
        left_edge: number
        right_edge: number
        start_idx: number
        end_idx: number
        head_id: number
      }>
    }>(),
    sentenceStructure: json("sentence_structure").$type<Array<{
      start: number
      end: number
      role: string
      text: string
      type: string
      explanation: string
    }>>(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 软删除标记，语义见 courses.deletedAt / deletedBatch。NULL = 正常。 */
    deletedAt: datetime("deleted_at", { fsp: 3 }),
    deletedBatch: varchar("deleted_batch", { length: 36 }),
  },
  (t) => [
    index("idx_sentences_lesson_id").on(t.lessonId),
    // 句子列表的两条索引，见 db/migrations/00015_sentences_indexes.sql。
    // sort_order 是**课内顺序**（全表只有 0..960，不是全局序号），所以正确的
    // 访问路径是"先定位课时，再按课内顺序读"，索引也必须按这个顺序建 ——
    // 全局按 sort_order 排序会把 16,891 个课时的"第 0 句"混在一起。
    index("idx_sentences_lesson_sort").on(t.lessonId, t.sortOrder),
    // 不选课时时按"最近添加"浏览用的顺序（唯一在全局意义上有效的顺序）
    index("idx_sentences_created_at").on(t.createdAt),
  ]
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
  (t) => [index("idx_practice_records_user_id").on(t.userId),
    // 时间范围统计（后台「近一周/一月/一季」）要按 created_at 过滤
    index("idx_practice_records_created_at").on(t.createdAt)]
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
    index("idx_payment_orders_status_paid_at").on(t.status, t.paidAt),
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
    index("idx_subscriptions_created_at").on(t.createdAt),
    // 仪表盘「活跃订阅」= COUNT(*) WHERE status='active'，钻取也按它筛
    index("idx_subscriptions_status").on(t.status),
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
    // 匿名访客的长期身份（见 lib/visitor.ts）。session_id 存在 sessionStorage，
    // 关标签页即失效，数不出"人"；visitor_id 才能算匿名 UV 并把匿名流量与
    // 之后的注册串起来。历史数据与拦截器场景下为 NULL，报表用
    // COALESCE(visitor_id, session_id) 兜底降级。
    //
    // **位置必须在 created_at 之后**：00024 是用 ALTER TABLE ADD COLUMN 加的这一列，
    // MySQL 只能把它追加到末尾。schema.ts 若写成中间位置，`drizzle-kit push`
    // （e2e 测试库由它生成）会认为列序不一致而生成多余的调整 ——
    // 列序在这里没有语义，跟线上一致比"读起来顺眼"重要。
    visitorId: varchar("visitor_id", { length: 64 }),
  },
  (t) => [
    index("idx_ae_type_time").on(t.eventType, t.createdAt),
    index("idx_ae_user").on(t.userId),
    // 全局时间范围（不带 event_type）用不上上面的复合索引，单独补一个
    index("idx_ae_created_at").on(t.createdAt),
    // 独立访客数与"首访时间"都是按 visitor_id 分组，没它只能全表扫
    index("idx_ae_visitor").on(t.visitorId),
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

// ─── Invite Rewards (legacy: 仅生产库残留，当前代码无读写) ──────────────────────
// 这张表由早期 Supabase 迁移带过来，src/ 内已无任何引用。这里补上定义不是要启用它，
// 而是让 schema.ts 与生产库完全一致：否则 `drizzle-kit push` 会把它当成本地多出的表
// 并在 --force 下 DROP 掉。真要清理请单独评估，不要依赖 push 的默认行为。
export const inviteRewards = mysqlTable(
  "invite_rewards",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    inviterId: varchar("inviter_id", { length: 36 }).notNull(),
    inviteeId: varchar("invitee_id", { length: 36 }).notNull(),
    rewardType: mysqlEnum("reward_type", ["register", "activate", "first_purchase"]).notNull(),
    rewardDays: int("reward_days").notNull(),
    purchasePlan: mysqlEnum("purchase_plan", ["monthly", "yearly"]),
    createdAt: datetime("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uk_ir_invitee_type").on(t.inviteeId, t.rewardType),
    index("idx_ir_inviter").on(t.inviterId),
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
    type: mysqlEnum("type", ["sentence", "lesson_complete", "course_complete", "share_invite", "chat"]).notNull(),
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

// ─── Practice Sessions (每课的「继续上次」恢复槽位) ───────────────────────────
export const practiceSessions = mysqlTable(
  "practice_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    courseId: varchar("course_id", { length: 36 }).notNull(),
    lessonId: varchar("lesson_id", { length: 36 }).notNull(),
    // currentIndex 是「下一句要练的下标（0 基）」，刻意不是「已练句数」：
    // user_course_progress.sentence_count 存的是 GREATEST(...) 单调递增的历史累计句数，
    // 两个数含义不同；拿已练句数当恢复下标，一旦题目数变动就会指到越界位置，
    // 前端读不到句子，表现为「点继续练习白屏」。
    currentIndex: int("current_index").notNull().default(0),
    state: varchar("state", { length: 16 }).notNull().default("active"),
    // 只统计本次会话，用于结算页展示；跨会话的累计值走 user_course_progress。
    sentenceCount: int("sentence_count").notNull().default(0),
    mistakeCount: int("mistake_count").notNull().default(0),
    elapsedSeconds: int("elapsed_seconds").notNull().default(0),
    startedAt: datetime("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: datetime("completed_at"),
  },
  (t) => [
    // 每个 (user, lesson) 只保留一个恢复槽位：重练同一课要复用同一行而不是不断累积。
    // 若允许多行，GET 时无法判定「上次」是哪一行，恢复位置会随查询计划漂移。
    uniqueIndex("uk_practice_session").on(t.userId, t.lessonId),
    index("idx_practice_session_user").on(t.userId, t.updatedAt),
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

// ─── Task Logs (daily share dedup + 邀请有礼 次数/天数记录) ───────────────────
export const taskLogs = mysqlTable(
  "task_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    taskType: mysqlEnum("task_type", ["share_invite", "invite_register", "invite_purchase"]).notNull(),
    rewardType: mysqlEnum("reward_type", ["diamond", "trial_days"]).notNull(),
    /**
     * 这条记录里 **userId（邀请人）本人** 获得的天数。
     *
     * 与历史含义保持一致（以前 invite_register 记的就是邀请人拿到的 3 天）。
     * 因此 invite_register 恒为 0 —— 按句乐部的天数制，注册档只给**被邀请人**
     * 7 天，邀请人的天数来自首购档。被邀请人拿到多少天体现在他自己的
     * users.pro_expires 上，不记在邀请人的任务流水里。
     */
    rewardAmount: int("reward_amount").notNull(),
    date: varchar("date", { length: 10 }).notNull(),
    refId: varchar("ref_id", { length: 36 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /**
     * 「当天」的影子列，**仅 share_invite 有值**（虚拟生成列，见
     * db/migrations/00025_task_logs_daily_index.sql）。
     *
     * 存在的理由是修一个会静默吞掉奖励的约束：原本的
     * `uk_task_user_type_date (user_id, task_type, date)` 对**所有** task_type
     * 生效，于是同一邀请人同一天拉到第二个付费用户时，invite_purchase 那行会撞
     * 唯一键，而 lib/auth/invite.ts 把它当成「已发过」直接 return ——
     * 邀请人少 30 天、被邀请人少 20 天，且没有任何日志。
     *
     * 不能简单把 ref_id 加进那个键：share_invite 的 ref_id 是 NULL，而 MySQL
     * 认为多个 NULL 互不相等，分享的每日去重会**整个失效**。所以改成只把日期
     * 在分享任务上暴露出来，再对它建唯一索引：
     *   share_invite → share_day = date → 每天一次照旧
     *   invite_*     → share_day = NULL → 不再互相冲突
     */
    shareDay: varchar("share_day", { length: 10 }).generatedAlwaysAs(
      sql`IF(\`task_type\` = 'share_invite', \`date\`, NULL)`,
      { mode: "virtual" },
    ),
  },
  (t) => [
    /**
     * 「每天只能领一次」只作用于**分享任务**。
     *
     * 等价于原 `uk_task_user_type_date (user_id, task_type, date)` 在
     * task_type = 'share_invite' 上的那一部分，而不再误伤邀请奖励。
     * tasks/share 靠 `INSERT IGNORE` 的 affectedRows 判断今日是否已领，
     * 依赖的就是这个索引。
     */
    uniqueIndex("uk_task_share_day").on(t.userId, t.shareDay),
    /**
     * 幂等键 = (类型, 被邀请人)。
     *
     * 原来是 `uk_invite_ref` 单独作用于 ref_id，那会让同一个被邀请人**只能有一条**
     * 记录 —— 「注册」写过之后，「首购」就再也插不进去（撞唯一键），而首购奖励
     * 正是「仅首购有效」要靠它兜住的那一条。
     * 改成复合键后：① 同一被邀请人每种类型各一条，注册不会被重复计；
     * ② 首购天然只会成功一次，续费再触发也插不进去 —— 这就是「仅首购」的实现。
     * ③ share_invite 的 ref_id 为 NULL，MySQL 唯一索引允许多个 NULL，不受影响
     *    （分享的每日去重由 uk_task_share_day 负责）。
     */
    uniqueIndex("uk_task_ref_type").on(t.taskType, t.refId),
  ]
)

// ─── Posts (dynamic feed) ──────────────────────────────────────────────────────
export const posts = mysqlTable(
  "posts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    content: text("content").notNull(),
    likeCount: int("like_count").notNull().default(0),
    commentCount: int("comment_count").notNull().default(0),
    status: mysqlEnum("status", ["published", "deleted"]).notNull().default("published"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_posts_user").on(t.userId),
    index("idx_posts_created").on(t.createdAt),
  ]
)

// ─── Post Likes ────────────────────────────────────────────────────────────────
export const postLikes = mysqlTable(
  "post_likes",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    postId: varchar("post_id", { length: 36 }).notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uk_post_like").on(t.postId, t.userId)]
)

// ─── Acquired Courses ─────────────────────────────────────────────────────────
/**
 * 用户「获取」过的课程。
 *
 * 这份状态**必须**在服务端：它原先只存在浏览器 localStorage，
 * 于是清一次浏览器数据就丢，而"我的课程"列表还按"已练习过"把课留在列表里 ——
 * 结果是列表里有、点进去却显示「获取课程」（用户实际报过这个问题）。
 */
export const userAcquiredCourses = mysqlTable(
  "user_acquired_courses",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    courseId: varchar("course_id", { length: 36 }).notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    // 同一用户对同一门课只能有一条：接口走 upsert，唯一键兜底防重复
    uniqueIndex("uk_user_course_acquired").on(t.userId, t.courseId),
    index("idx_user_acquired_user").on(t.userId),
  ]
)

// ─── User Feedback ────────────────────────────────────────────────────────────
export const userFeedback = mysqlTable(
  "user_feedback",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    category: mysqlEnum("category", ["bug", "feature", "suggestion", "other"]).notNull().default("other"),
    content: text("content").notNull(),
    /**
     * 来源：门户端 / 学习中心 / 未知。两者共用同一个 FeedbackModal，
     * 由前端按当前路由上报，服务端用白名单校验（只用于展示与分组）。
     * 存量数据是 'unknown' —— 当时没有记录，不去猜。
     */
    source: varchar("source", { length: 20 }).notNull().default("unknown"),
    /**
     * 处理状态。**没有这一列的话后台列表就只能按时间铺开**，
     * 处理过与没处理过的混在一起，没人看得下去（见 00018 迁移说明）。
     */
    status: mysqlEnum("status", ["open", "in_progress", "resolved", "ignored"])
      .notNull()
      .default("open"),
    /** 处理人（后台用户 id）与处理时间 */
    handledBy: varchar("handled_by", { length: 36 }),
    handledAt: datetime("handled_at"),
    /** 处理备注，例如"已修复，下版生效" */
    adminNote: text("admin_note"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_feedback_created").on(t.createdAt),
    // 按状态筛（含仪表盘「待处理反馈」计数）
    index("idx_feedback_status").on(t.status),
    // 按状态筛之后按时间倒序翻页
    index("idx_feedback_status_created").on(t.status, t.createdAt),
  ]
)

// ─── Admin Audit Log ──────────────────────────────────────────────────────────
/**
 * 后台操作审计日志（完整理由见 db/migrations/00022_admin_audit_logs.sql）。
 *
 * 三条约束，改这张表之前先读一遍：
 * 1. `adminLabel` / `targetLabel` 是**快照**，不是冗余 —— 审计要在几个月后仍可读，
 *    而那时的用户可能已改名或删除，只留 id 等于留了一行无法解读的 UUID。
 * 2. **不建外键**：日志必须比它记录的对象活得久，被删掉的对象正是最需要审计的。
 * 3. `detail` 只写白名单字段，写入前统一脱敏（见 lib/admin-audit.ts）。
 */
export const adminAuditLogs = mysqlTable(
  "admin_audit_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    /** 操作者 id；dev 旁路下没有真实用户，为 NULL */
    adminId: varchar("admin_id", { length: 36 }),
    /** 操作者快照，例如 "张三(166****2010)" */
    adminLabel: varchar("admin_label", { length: 191 }),
    action: varchar("action", { length: 50 }).notNull(),
    targetType: varchar("target_type", { length: 50 }).notNull(),
    targetId: varchar("target_id", { length: 64 }),
    /** 对象快照，例如句子中文前 80 字 / 课程名 */
    targetLabel: varchar("target_label", { length: 191 }),
    /** 变更摘要（白名单 + 脱敏），例如 {"level":{"from":1,"to":5}} */
    detail: json("detail"),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_audit_created").on(t.createdAt),
    index("idx_audit_admin_created").on(t.adminId, t.createdAt),
    index("idx_audit_target").on(t.targetType, t.targetId, t.createdAt),
    index("idx_audit_action_created").on(t.action, t.createdAt),
  ]
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
export type InviteReward = typeof inviteRewards.$inferSelect
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect
export type PartnerRiskFlag = typeof partnerRiskFlags.$inferSelect
export type UserCourseProgress = typeof userCourseProgress.$inferSelect
export type PracticeSession = typeof practiceSessions.$inferSelect
export type DiamondLog = typeof diamondLogs.$inferSelect
export type WordDictionaryCache = typeof wordDictionaryCache.$inferSelect
export type WordbookItem = typeof wordbookItems.$inferSelect
export type UserNote = typeof userNotes.$inferSelect
export type TaskLog = typeof taskLogs.$inferSelect
export type Post = typeof posts.$inferSelect
export type PostLike = typeof postLikes.$inferSelect
export type UserFeedbackRow = typeof userFeedback.$inferSelect
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect
