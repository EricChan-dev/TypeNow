-- 00032_lifecycle_notifications.sql
-- 主动触达体系（生命周期消息）的基础结构，设计见 docs/business-model.md §11
--
-- 本迁移做三件事：
--   ① 新建 notifications 表（幂等记录 + 频次统计 + 失败重试的依据）
--   ② users.notify_opt_out_at —— 退订位（用户回复「退订」或点退订链接后置位）
--   ③ users.last_expiry_at —— 持久记录「上一次会员到期时刻」
--
-- ── ③ 为什么必须加（这一列是本迁移里最不显然的）────────────────────────────
--
-- `lib/subscription.ts` 的 checkAndExpirePro() 在会员过期时会把
-- `users.pro_expires` **置为 NULL**：
--
--     await db.update(users).set({ isPro: 0, proExpires: null }).where(...)
--
-- 于是「过期」这件事在两个时间点看起来完全不同：
--   · 用户过期后**还没回过站** → pro_expires 仍是过去的那个时间戳（is_pro 还是 1）
--   · 用户过期后**回过站**     → pro_expires 已被清空
--
-- 而 §11.3 的 P0 场景里有一条是「体验会员已到期（到期日 +1 天）挽回」——
-- 这是「首购转化」之外第二重要的触点。**如果只读 pro_expires，这条消息永远查不到人**：
-- 恰恰是最该被挽回的那批（回过站、发现自己练不了了）已经查不出来了。
--
-- 所以新增 last_expiry_at，在清空 pro_expires 的**同一个位置**记下它。
-- 之后「该用户的会员何时到期」= COALESCE(pro_expires, last_expiry_at)：
--   · 当前有效会员 → pro_expires 是未来时间，取它
--   · 已过期       → pro_expires 为 NULL，取 last_expiry_at
-- 一个表达式同时覆盖两种状态，调用方不需要关心用户属于哪一种。
--
-- ── 迁移安全性 ──────────────────────────────────────────────────────────────
--
-- · 新建表：无风险。
-- · 两个新列都是 NULL 默认的可空列：MySQL 8 下 ADD COLUMN 走 INSTANT，
--   sentences 那次 16 分钟的表重建不会重演。
-- · 存量数据回填：last_expiry_at 对「当前已过期且 pro_expires 已被清空」的用户
--   无从得知真实到期时间（信息已经丢了），因此**不回填**——
--   宁可这些历史用户收不到挽回消息，也不要编一个时间出来。
--   从本迁移上线后开始，所有新的过期都会留下记录。

-- ① 触达记录表
--
-- scenario 用 varchar 而不是 enum：§11.3 的场景矩阵有十几条且会不断增加，
-- 每加一条都要 ALTER 一次 enum 不划算。取值清单的唯一事实源在
-- src/lib/lifecycle-scenarios.ts，由单测保证与这里写入的数据一致。
CREATE TABLE IF NOT EXISTS notifications (
  id          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  user_id     VARCHAR(36)  NOT NULL,
  -- 场景键，见 src/lib/lifecycle-scenarios.ts 的 LIFECYCLE_SCENARIOS
  scenario    VARCHAR(50)  NOT NULL,
  -- 渠道：模板消息 / 客服消息 / 短信（三种能力与限制见 §11.2）
  channel     ENUM('template','customer_service','sms') NOT NULL,
  -- pending：已占位、尚未发送（先占位再发送，防并发重复）
  -- sent：发送成功
  -- failed：发送失败（attempts 记录重试次数，有上限）
  -- skipped：因未配置模板 / 未关注公众号等**预期内**原因跳过，不算失败，不重试
  status      ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  title       VARCHAR(200) NULL,
  body        TEXT NULL,
  -- 失败原因，便于排查（截断到 500，避免冗余堆栈把表撑大）
  error       VARCHAR(500) NULL,
  attempts    INT NOT NULL DEFAULT 0,
  -- ★ 周期标识。见下面的「为什么唯一键必须有它」。
  --   取值随场景语义而定：到期类 = 到期日（"2026-09-30"）；
  --   每日类（连胜提醒）= 当日日期；一次性类（领体验后未练习）= 空串。
  period_key  VARCHAR(50) NOT NULL DEFAULT '',
  sent_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- ★ 幂等的全部安全性所在：同一用户 + 同一场景 + **同一周期**只允许一行。
  -- 发送前先 INSERT IGNORE 占位，靠 affectedRows 判定自己是否抢到了这次发送机会，
  -- 而不是先 SELECT 再 INSERT（那中间隔着一次网络往返，并发会双发 ——
  -- 与 lib/trial.ts 的 trial_claimed_at、uk_task_ref_type 同一个模式）。
  --
  -- ── 修正一：为什么**不把 channel 放进唯一键**（§11 原设计里有它）────────────
  --
  -- §11.5 ③ 给的是 `(user_id, scenario, channel)`。但 channel 是"送达方式"，
  -- 不是"这条消息的身份"：同一个场景在一个周期里只该发**一条**，
  -- 用模板消息还是短信送达是渠道降级的结果，不是两条不同的消息。
  --
  -- 把 channel 放进唯一键会允许同一场景在同一周期内最多发三条
  -- （模板一次、客服一次、短信一次），恰好制造出我们要避免的骚扰。
  -- 去掉之后，占位行代表"这条消息已经发过"，渠道降级只是更新这一行。
  --
  -- ── 修正二：为什么必须带 period_key ────────────────────────────────────────
  --
  -- §11.5 ③ 给的是 `uk_notification (user_id, scenario, channel)`。那个键**漏了
  -- 「哪一次会员周期」这一维**，后果是会复利累积的收入损失：
  --
  --   一个年卡用户在今年收到「到期前 7 天」提醒后**续费**。明年同一个场景
  --   （user_id, scenario, channel）三元组完全一样 → 唯一键直接挡住 INSERT，
  --   他**再也不会收到续费提醒**。而且这是静默的：日志里连一条失败都不会有。
  --
  -- 加上 period_key（到期类取到期日）之后，每次会员周期都有自己的一组记录，
  -- 既保持「同一周期内不重复发」，又不会跨周期误挡。
  UNIQUE KEY uk_notification (user_id, scenario, period_key),
  -- 频次统计：「该用户最近 N 天发了几条」要按 (user_id, created_at) 走索引，
  -- 否则每次扫描都要全表扫 notifications
  KEY idx_notifications_user_created (user_id, created_at),
  -- 失败重试扫描：找 status='failed' 且 attempts 未超上限的行
  KEY idx_notifications_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ② 退订位
--
-- 用时间戳而不是 tinyint 标志位：合规场景下「何时退订的」比「是否退订」更有用
-- （客服问询、投诉举证都需要这个时间点）。非 NULL 即表示已退订。
--
-- ⚠️ 所有发送路径的入口都必须检查它，不允许被任何逻辑绕过（§11.5 ⑤）。
ALTER TABLE users
  ADD COLUMN notify_opt_out_at DATETIME NULL
    COMMENT '退订主动触达的时间；非 NULL = 已退订。所有发送路径入口必须检查，见 lib/notify.ts';

-- ③ 上一次会员到期时刻（见文件头说明）
ALTER TABLE users
  ADD COLUMN last_expiry_at DATETIME NULL
    COMMENT '上一次会员到期时刻。checkAndExpirePro 清空 pro_expires 时同步写入，用于「已到期挽回」场景';

-- ── 执行后校验 ──────────────────────────────────────────────────────────────
--
-- ① 表与排序规则（新表必须显式 utf8mb4_unicode_ci，否则 JOIN users 会
--    Illegal mix of collations —— 见 db/README.md 记的那次事故）：
--
--   SELECT TABLE_COLLATION FROM information_schema.TABLES
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='notifications';
--   -- 期望 utf8mb4_unicode_ci
--
-- ② 幂等键存在且唯一（三列）：
--
--   SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
--     FROM information_schema.STATISTICS
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='notifications'
--      AND INDEX_NAME='uk_notification' GROUP BY INDEX_NAME, NON_UNIQUE;
--   -- 期望 NON_UNIQUE=0、(user_id, scenario, period_key)
--
--   顺带验两件事：
--     -- 同一周期同一场景重复插入应被拒
--     INSERT INTO notifications (user_id,scenario,channel,period_key) VALUES ('p','s','sms','2026-09-30');
--     INSERT INTO notifications (user_id,scenario,channel,period_key) VALUES ('p','s','sms','2026-09-30');  -- 应报 Duplicate
--     -- 换一个周期就能再发（续费后能再收到提醒）
--     INSERT INTO notifications (user_id,scenario,channel,period_key) VALUES ('p','s','sms','2027-09-30');  -- 应成功
--     DELETE FROM notifications WHERE user_id='p';
--
-- ③ 两个新列都建出来了，且 ADMIN 默认 NULL：
--
--   SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='users'
--      AND COLUMN_NAME IN ('notify_opt_out_at','last_expiry_at');
--
-- ④ 幂等键真的起作用（插入两次同一组合，第二次应被拒）：
--
--   INSERT INTO notifications (user_id, scenario, channel) VALUES ('probe','probe','sms');
--   INSERT INTO notifications (user_id, scenario, channel) VALUES ('probe','probe','sms');
--   -- 第二条应报 Duplicate entry
--   DELETE FROM notifications WHERE user_id='probe';
--
-- ⑤ 存量用户未被误改（应当全是 NULL）：
--
--   SELECT COUNT(*) FROM users WHERE notify_opt_out_at IS NOT NULL OR last_expiry_at IS NOT NULL;
--   -- 期望 0
