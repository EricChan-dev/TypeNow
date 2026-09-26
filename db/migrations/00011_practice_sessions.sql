-- 00011_practice_sessions.sql
-- 练习会话持久化：「继续上次练习」的恢复槽位
--
-- 为什么需要新表：
--   user_course_progress 只有 course 级的 last_studied_at + sentence_count，
--   既定位不到 lesson，也存不了「下一句下标」。sentence_count 是 GREATEST(...)
--   单调累计值（跨会话不清零），拿它当恢复下标会随题目数变动而越界。
--   因此新增 lesson 级的恢复槽位，与历史累计彻底分开。
--
-- 为什么 (user_id, lesson_id) 必须唯一：
--   一个用户对一课只需要一个「上次练到哪」。重练同一课时应就地重置该行，
--   而不是每次进入都 INSERT 一行；否则 GET 无法判定哪一行才是最新，
--   恢复位置会随查询计划漂移（表现为有时恢复到旧进度）。

CREATE TABLE IF NOT EXISTS practice_sessions (
  id              VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
  user_id         VARCHAR(36)  NOT NULL,
  course_id       VARCHAR(36)  NOT NULL,
  lesson_id       VARCHAR(36)  NOT NULL,
  -- current_index 的语义是「下一句要练的下标（0 基）」，不是「已练句数」；
  -- 它属于本会话，与 user_course_progress.sentence_count 不是一个数。
  current_index   INT          NOT NULL DEFAULT 0,
  state           VARCHAR(16)  NOT NULL DEFAULT 'active',  -- active / completed / abandoned
  sentence_count  INT          NOT NULL DEFAULT 0,         -- 本次会话已练句数
  mistake_count   INT          NOT NULL DEFAULT 0,
  elapsed_seconds INT          NOT NULL DEFAULT 0,
  started_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME     DEFAULT NULL,
  UNIQUE KEY uk_practice_session     (user_id, lesson_id),
  INDEX      idx_practice_session_user (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 是否需要手动执行：需要。
-- 依据：仓库里没有任何自动迁移执行器 —— package.json 无 migrate 脚本，
-- drizzle.config.ts 只配置了 generate/push 的输出目录（src/lib/db/migrations 尚不存在），
-- .github/ 下没有 workflows，deploy.sh 也不含 SQL 步骤。
-- 注意：e2e 测试库由 `drizzle-kit push` 从 src/lib/db/schema.ts 生成，不读本目录，
-- 所以 schema.ts 与本文件必须同步修改（见 db/README.md）。
