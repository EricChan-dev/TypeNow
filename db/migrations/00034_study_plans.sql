-- 00034_study_plans.sql
-- 学习计划第一期：单词学习计划（智能逐单元学习 + 到期复习）。
-- 设计约定与用户确认的顺序见会话记录（查单词 → 学习计划第一期 → 音标课程）。
--
-- ── 为什么两张表 ────────────────────────────────────────────────────────────
--
--   · study_plans       —— 「用户 × 一份进行中的计划」。第一期一个用户只有一份
--                          计划（UNIQUE(user_id)），想做多计划时先改这条约束再扩列，
--                          不要提前泛化。
--   · study_plan_words  —— 「计划内每个单词一行的 SRS 进度」。和 pronunciation_scores
--                          同一条设计理由：进度是「一个词一行取最新」，而作答流水
--                          （practice_records 形态）是「每次一行」——挂错表会把
--                          「查最新」写成一坨子查询。词只在**首次作答**时入库，
--                          没学过的词不占行，单元的「词总数」随时从 sentences.words
--                          现算（词表跟着课程数据走，不另存一份会漂移的快照）。
--
-- ── 为什么 SRS 列与 review_queue 同形不同表 ─────────────────────────────────
--
-- review_queue 是**句子**复习队列（练习错题驱动，UNIQUE(user_id, sentence_id)），
-- 这里是**单词**学习计划（UNIQUE(plan_id, word)）。调度参数同名同义
-- （interval_days / ease_factor / consecutive_ok），但生命周期完全不同：
-- 句子由判错自动入队，词由学习计划显式管理（删除计划连词一起删）。
-- 合成一张表要加 type 列 + 三处查询全部带过滤，得不偿失。
--
-- ── 调度口径（SM-2 lite，与 review_queue 同族）─────────────────────────────
--
--   · 答对：interval 0 → 1，否则 min(round(interval × ease), 180)；
--           ease = min(ease + 0.05, 3.00)；interval ≥ 21 视为已掌握（status=mastered）
--   · 答错：interval 归 0，next_review_at = NOW()（立刻到期，回到「到期复习」）；
--           ease = max(ease − 0.20, 1.30)；status 回 learning
--   · 未答过的词不入库，所以 interval_days 默认 0（review_queue 默认 1 是因为
--     入队即已答错一次，语义不同，不要对齐）。
--
-- ── 为什么 word 是 VARCHAR(128) 而词组也允许 ────────────────────────────────
--
-- 词源是 sentences.words[].english（JSON 现算），课程里存在 "central reservation"
-- 这类词组（查单词页同款数据已证实）。128 与 wordbook_items.word 同宽，
-- 这两张表的词未来会互相导流（收藏 → 计划），宽度不一致是自找的 1406。
--
-- ── 索引 ────────────────────────────────────────────────────────────────────
--
--   · uk_study_plan_word (plan_id, word)     —— 幂等 upsert 的唯一键
--   · idx_study_plan_words_due (plan_id, next_review_at) —— 「到期复习」拉取
--   · idx_study_plan_words_lesson (plan_id, lesson_id)   —— 单元进度统计
--   没有按 user_id 的索引：plan 与 user 一一对应（UNIQUE(user_id)），
--   所有查询都以 plan_id 起头，加 user 索引纯属维护成本。
--
-- ── 执行后校验 ──────────────────────────────────────────────────────────────
--
-- ① 排序规则（必须与 users 一致，否则 JOIN 炸 1267，见 db/README.md）：
--   SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME IN ('study_plans','study_plan_words');
--   -- 期望两行都是 utf8mb4_unicode_ci
--
-- ② 幂等重放：本文件全部是 CREATE TABLE IF NOT EXISTS，可安全重复执行。
--
-- 回滚：
--   DROP TABLE IF EXISTS study_plan_words;
--   DROP TABLE IF EXISTS study_plans;

CREATE TABLE IF NOT EXISTS `study_plans` (
  `id`         VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `user_id`    VARCHAR(36)  NOT NULL,
  `course_id`  VARCHAR(36)  NOT NULL,
  `status`     ENUM('active','archived') NOT NULL DEFAULT 'active',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- 第一期一个用户一份计划：重复创建走 409，删除是硬删（含词进度），
  -- 所以 UNIQUE 不会被 archived 旧行挡住。
  UNIQUE KEY `uk_study_plan_user` (`user_id`),
  KEY `idx_study_plan_course` (`course_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `study_plan_words` (
  `id`              VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `plan_id`         VARCHAR(36)  NOT NULL,
  `word`            VARCHAR(128) NOT NULL,
  -- 归属单元 = 首次作答时所在的课时；复习模式跨单元作答不改归属。
  `lesson_id`       VARCHAR(36)  NOT NULL,
  `review_count`    INT          NOT NULL DEFAULT 0,
  `consecutive_ok`  INT          NOT NULL DEFAULT 0,
  -- 0 = 未形成间隔（新答对一轮是 1 天）；与 review_queue 的「默认 1」语义不同，见文件头。
  `interval_days`   INT          NOT NULL DEFAULT 0,
  `ease_factor`     DECIMAL(4,2) NOT NULL DEFAULT 2.50,
  -- NULL = 尚未排期（不该出现，答完即排期；留着防御半截写入）
  `next_review_at`  DATETIME     NULL,
  `correct_count`   INT          NOT NULL DEFAULT 0,
  `wrong_count`     INT          NOT NULL DEFAULT 0,
  `last_answered_at` DATETIME    NULL,
  `status`          ENUM('learning','mastered') NOT NULL DEFAULT 'learning',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_study_plan_word` (`plan_id`, `word`),
  KEY `idx_study_plan_words_due` (`plan_id`, `next_review_at`),
  KEY `idx_study_plan_words_lesson` (`plan_id`, `lesson_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
