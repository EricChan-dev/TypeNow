-- 00033_pronunciation_scores.sql
-- 跟读评分持久化，设计见 docs/superpowers/specs/2026-09-30-pronunciation-scoring-redesign-design.md
--
-- ── 为什么是独立表而不是 practice_records 上加列 ─────────────────────────────
--
-- practice_records 是「每次作答一行」（同一句可以有多行），而跟读评分要的是
-- 「一句一行取最新」。挂上去会变成「取最新一行，而它可能没有跟读分」——
-- 查询别扭且容易写错。独立表 + UNIQUE(user_id, sentence_id) 才是它的形状。
--
-- ── 为什么 words 与 comment 也要存 ──────────────────────────────────────────
--
--   · words  —— 历史分点开「查看详情」时要渲染逐词分，没有它就只有一个总分
--   · comment —— 评语是评分那一刻生成的。不存的话，重开详情会重新生成一句
--                不一样的话，用户会以为评分变了
--
-- ── 为什么只留一行 ──────────────────────────────────────────────────────────
--
-- 产品决定：只保留最新一次（重录覆盖）。代价是日后做「进步曲线」没有历史
-- 数据可回溯 —— 这是明知的取舍，不是疏漏。
--
-- ── 为什么 id 必须有 DEFAULT (UUID()) ───────────────────────────────────────
--
-- 这一列是本文件里唯一不显然的东西，漏了会**静默丢数据**：
--
--   · src/lib/db/schema.ts 里声明了 `.default(sql`(UUID())`)`，而 e2e 测试库
--     由 `drizzle-kit push` 从 schema.ts 生成，所以**测试库有默认值**；
--     生产库来自本文件，若这里不写，生产上就没有默认值。
--   · 写入方（Task 3 的 pronunciation-store）的 INSERT **不带 id**，指望的就是
--     这个库级默认值 —— drizzle 的 `default()` 只参与建表 DDL，运行期不会在
--     客户端补一个 UUID。
--   · 于是生产上 INSERT 会报 `ERROR 1364 Field 'id' doesn't have a default value`
--     （MySQL 8 默认 STRICT_TRANS_TABLES；非严格模式下会写成空串，全部行主键
--     冲突，更糟）。而 store 的约定是「写库失败不影响返回分数」，只记日志并
--     返回 false —— 表现就是**每次评分都正常显示、但永远存不进去**，
--     并且 e2e 全绿，完全测不出来。
--
-- 同类漂移见 db/README.md「drizzle-kit push 不会应用表级 COLLATE」一节：
-- 测试库与生产库的结构由两条路径分别生成，只有人工保持一致。
--
-- 回滚：
--   DROP TABLE IF EXISTS pronunciation_scores;

CREATE TABLE IF NOT EXISTS `pronunciation_scores` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `user_id`     VARCHAR(36)  NOT NULL,
  `sentence_id` VARCHAR(36)  NOT NULL,
  `score`       INT          NOT NULL,
  `accuracy`    INT          NOT NULL,
  `fluency`     INT          NOT NULL,
  `integrity`   INT          NOT NULL,
  `speed`       DECIMAL(6,2) NULL,
  `words`       JSON         NULL,
  `comment`     VARCHAR(500) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pronunciation_user_sentence` (`user_id`, `sentence_id`),
  KEY `idx_pronunciation_user_updated` (`user_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
