-- 00027_coins.sql
-- 引入**金币**（免费货币）与金币流水，并把打卡门槛的语义从「当日钻石数」改为「当日练习句数」
--
-- ── 为什么要引入第二种货币 ──────────────────────────────────────────────────
--
-- 现在只有钻石一种货币，而它同时承担了两个互相冲突的角色：
--   · 免费货币 —— 练习就能赚（api/diamonds/earn）
--   · 付费货币 —— AI 助手按 5 钻/次消耗，那是真金白银的 DeepSeek 调用
--
-- 于是「刷题」可以无限兑换「AI 调用」：练 1 句最多得 25 钻 = 5 次对话 ≈ ¥0.035，
-- 重度免费用户一天可刷出约 ¥0.66 的 API 成本（≈ ¥20/月），而他不付一分钱。
--
-- 拆开之后：
--   钻石 —— 只由会员每日赠送或未来充值获得，只用于消耗型能力（严格限量）
--   金币 —— 只靠学习行为获得，只用于站内的会员天数与道具（可敞开发，零现金成本）
--
-- 两种货币用途严格不交叉，这是句乐部验证过的设计。数值见 src/lib/coins.ts。
--
-- ── 打卡门槛：这是一处**语义变更**，不改它打卡会彻底坏掉 ────────────────────
--
-- check_in_goal 此前被实现为「当日获得的钻石数 ≥ 50」，判定读的是 diamond_logs。
-- 而本次把练习奖励改为发金币之后，diamond_logs 不再新增 → 当日钻石恒为 0
-- → 门槛永远不满足 → **打卡永久失败，且只是静默返回 403，不报错**。
--
-- 新语义：check_in_goal = 「当日练习句数」，数据源换成 practice_records。
-- 口径对齐句乐部官方文档（julebu.co/docs/guide-tasks-coins 原文）：
--   「每日打卡：完成当天的打卡目标就算完成（打卡目标可以自己设，默认 10 个练习点）」
--
-- 为什么复用本列而不是新增一列：字段名本来就是「打卡目标」，语义被写歪了而已；
-- 而且句乐部验证过的「用户可自设打卡目标」这个功能，新增列会让它无处安放。
--
-- ── 存量数据 ────────────────────────────────────────────────────────────────
--
-- 实测生产库（2026-09-29）：users 共 26 行，check_in_goal **全部为 50**（旧语义）。
-- 不写 UPDATE 的话，这 26 个用户会保留 50 —— 在新语义下意味着「当天要练 50 句」，
-- 门槛被无意提高 5 倍，等于把打卡功能对他们关掉了。
--
-- ── collation ───────────────────────────────────────────────────────────────
--
-- coin_logs 是**新建表**，必须显式写 COLLATE（00021 的硬要求）：
-- 不写就会拿到 MySQL 8 的服务器/库默认值，一旦与 users 的 utf8mb4_unicode_ci 不同，
-- 任何跨表 JOIN 都会抛 `Illegal mix of collations` —— 表现为"某个页面莫名 500"，
-- 极难排查（00021 就是这么发现的）。本库当前默认恰好是 unicode_ci，
-- 但显式声明才不依赖这个巧合。
--
-- ── 幂等性 ──────────────────────────────────────────────────────────────────
--
-- ADD COLUMN / CREATE TABLE / MODIFY COLUMN 重复执行都会报错（MySQL 不支持 IF NOT EXISTS
-- 用于 ADD COLUMN），属预期 —— 本文件只需执行一次。
-- 单独重跑 UPDATE 是安全的（它收敛到同一个结果）。
--
-- ── 校验 ────────────────────────────────────────────────────────────────────
--
--   SHOW COLUMNS FROM users LIKE 'coins';                 -- int, NOT NULL, default 0
--   SHOW COLUMNS FROM users LIKE 'check_in_goal';         -- int, NOT NULL, default 10
--   SELECT COUNT(*) FROM users WHERE check_in_goal = 50;  -- 应为 0
--   SHOW CREATE TABLE coin_logs;                          -- 应含 utf8mb4_unicode_ci
--
-- ── 回滚 ────────────────────────────────────────────────────────────────────
--
--   -- ⚠️ 先确认没有依赖：coins 余额与 coin_logs 流水一旦产生就无法还原成"未发生"。
--   DROP TABLE coin_logs;
--   ALTER TABLE users DROP COLUMN coins;
--   ALTER TABLE users MODIFY COLUMN check_in_goal INT NOT NULL DEFAULT 50;
--   UPDATE users SET check_in_goal = 50;   -- 注意：这会同时丢掉用户自设的目标
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。

ALTER TABLE users ADD COLUMN coins INT NOT NULL DEFAULT 0
  COMMENT '金币余额（免费货币），只用于兑换会员天数与道具；产出见 lib/coins.ts';

ALTER TABLE users MODIFY COLUMN check_in_goal INT NOT NULL DEFAULT 10
  COMMENT '每日打卡目标＝当日练习句数（2026-09-29 前是"当日钻石数"，语义已变更）';

-- 存量用户全是旧语义的 50。不改的话新语义下门槛变成"当天练 50 句"，等于关掉打卡。
UPDATE users SET check_in_goal = 10 WHERE check_in_goal = 50;

CREATE TABLE coin_logs (
  id         VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id    VARCHAR(36) NOT NULL,
  amount     INT NOT NULL COMMENT '正=获得，负=消耗',
  type       ENUM('check_in','sentence','lesson_complete','course_complete',
                  'share_invite','redeem_membership','redeem_item') NOT NULL,
  ref_id     VARCHAR(36) NULL,
  duration_seconds INT NULL
    COMMENT '本次练习耗时（秒），仅 sentence 有意义。练习时长只在领奖请求里上报，practice_records 没有这一列；此前记在 diamond_logs，拆分后跟着搬到本表',
  streak     INT NOT NULL DEFAULT 0 COMMENT '打卡时的连续天数快照，仅 check_in 有意义',
  date       VARCHAR(10) NOT NULL COMMENT '上海日历日 YYYY-MM-DD，用于每日统计与每月兑换上限',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coin_logs_user_id (user_id),
  INDEX idx_coin_logs_user_created (user_id, created_at),
  INDEX idx_coin_logs_user_date (user_id, date)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT '金币流水（免费货币）。钻石流水见 diamond_logs，两者用途不交叉。';

-- task_logs.reward_type 增加 'coin'。
--
-- 每日分享任务此前发 10 钻石，是"免费动作换付费货币"的一个口子 ——
-- 双货币拆分后必须改发金币（否则免费用户仍能靠分享攒钻石买 AI 调用，
-- 那正是本次拆分要堵的成本敞口）。
--
-- 追加在末尾（00013 约定）：只改元数据，不重建表。
ALTER TABLE task_logs
  MODIFY COLUMN reward_type ENUM('diamond','trial_days','coin') NOT NULL;
