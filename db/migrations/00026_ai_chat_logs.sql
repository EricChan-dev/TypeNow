-- 00026: AI 私教对话日志（审计）
--
-- 背景：AI 对话此前完全不落库，只有 diamond_logs 记了"扣了多少钻石"。
-- 出了问题无法回答"谁问的、问了什么、答了什么、耗时多少"。
--
-- 口径与取舍见 src/lib/db/schema.ts 的 aiChatLogs 注释：
--   · 只记一轮问答（客户端每请求都会带最多 20 条历史，按整段存会重复 20 遍）
--   · 问题/回答都截断存储，不把 TEXT 当无限存档用
--
-- 执行时间：2026-09-29 已在生产执行并校验（12 字段 / 4 索引 / InnoDB+utf8mb4_unicode_ci）

CREATE TABLE IF NOT EXISTS `ai_chat_logs` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `question` TEXT NOT NULL,
  `answer` TEXT NULL,
  `model` VARCHAR(64) NULL,
  `history_count` INT NOT NULL DEFAULT 0,
  `diamonds_cost` INT NOT NULL DEFAULT 0,
  `used_free_quota` TINYINT NOT NULL DEFAULT 0,
  `status` ENUM('ok','error') NOT NULL DEFAULT 'ok',
  `error_message` VARCHAR(255) NULL,
  `latency_ms` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_chat_user_created` (`user_id`, `created_at`),
  KEY `idx_ai_chat_created` (`created_at`),
  KEY `idx_ai_chat_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 回滚：
-- DROP TABLE IF EXISTS `ai_chat_logs`;

-- 验证（应返回 1 行、12 个字段、4 个索引含 PRIMARY）：
-- SELECT COUNT(*) AS cols FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='ai_chat_logs';
-- SHOW INDEX FROM `ai_chat_logs`;
