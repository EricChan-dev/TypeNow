-- 00035_course_ai_meta.sql
-- 课程详情 AI 元数据（任务④）：课程简介 + 课节语法点/句子复杂度，DeepSeek 生成、DB 缓存。
-- 背景与用户确认的顺序见会话记录（查单词 → 学习计划第一期 → 音标课程 → 课程详情 AI 元数据）。
--
-- ── 为什么两张表 ────────────────────────────────────────────────────────────
--
--   · course_ai_meta      —— 课程级「AI 课程简介」，一课一行（PK=course_id）。
--                           与 courses.description（人工短描述，详情页头已渲染）互补：
--                           简介是 AI 通读课节内容后写的 200-350 字导学文，全站共享，
--                           没有用户维度，所以不挂 user_id。
--   · lesson_ai_insights  —— 课节级「语法点 + 句子复杂度」，一课节一行（PK=lesson_id）。
--                           与 lessons/[id]/insight 的派生数据（核心词汇/短语，从
--                           sentences JSON 现算）分工：派生数据快而浅、每次现算不入库；
--                           AI 分析慢而深（单次 LLM 调用数秒）、必须落库缓存——
--                           否则每次展开课节都烧一次 token，成本和延迟都不可接受。
--
-- ── 为什么 grammar / complexity 可空 ────────────────────────────────────────
--
-- 一次调用同时产出两块，解析时逐块校验：合法的块照存，非法的块留 NULL。
-- 前端对 NULL 渲染「暂未生成」占位（沿用 m20696 决议：不造假数据），
-- 管理侧之后可以单独重生成缺失块，不用整行推翻。
--
-- ── 为什么记 model ──────────────────────────────────────────────────────────
--
-- 生成内容是模型产物，留模型名便于将来审计「哪批内容出自哪个模型」、
-- 换模型后按 model 列定向重生成。
--
-- ── 为什么没有 FK / 冗余索引 ────────────────────────────────────────────────
--
--   沿用 00034 的约定：不建外键（应用层保证归属），查询全部以 PK 起头
--   （详情页按 course_id 取简介、展开课节按 lesson_id 取分析），加二级索引纯属维护成本。
--   排序规则必须与 users 一致（utf8mb4_unicode_ci，否则 JOIN 炸 1267，见 db/README.md）。
--
-- ── 执行后校验 ──────────────────────────────────────────────────────────────
--
-- ① 排序规则：
--   SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME IN ('course_ai_meta','lesson_ai_insights');
--   -- 期望两行都是 utf8mb4_unicode_ci
--
-- ② 幂等重放：本文件全部是 CREATE TABLE IF NOT EXISTS，可安全重复执行。
--
-- 回滚：
--   DROP TABLE IF EXISTS lesson_ai_insights;
--   DROP TABLE IF EXISTS course_ai_meta;

CREATE TABLE IF NOT EXISTS `course_ai_meta` (
  `course_id`  VARCHAR(36)  NOT NULL,
  -- AI 导学简介（中文，200-350 字）；整段文本，前端按段落拆行渲染
  `intro`      MEDIUMTEXT   NOT NULL,
  -- 生成模型（如 deepseek-flash）
  `model`      VARCHAR(64)  NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`course_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lesson_ai_insights` (
  `lesson_id`  VARCHAR(36)  NOT NULL,
  -- 语法点数组 [{point, explanation, example?, exampleZh?}]；NULL = 该块尚未生成或校验未过
  `grammar`    JSON         NULL,
  -- 句子复杂度 {summary, distribution:{easy,medium,hard}, hardestExample?, hardestExampleZh?, hardestReason?}
  `complexity` JSON         NULL,
  `model`      VARCHAR(64)  NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`lesson_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
