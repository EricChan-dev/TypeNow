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
-- ── 为什么三个维度列可空，而总分不可空 ──────────────────────────────────────
--
-- 维度（accuracy / fluency / integrity）与词级分（words[].score）是**同一套
-- 空值策略**：有道没给这个字段时存 NULL，绝不写 0。
--
-- 理由是错的代价不对称：0 分是一个**看起来完全真实**的值。维度一旦被兜底成 0，
-- 下游评语规则「该维度 < 75 就出短板建议」就会给一个字段缺失的用户生成
-- 「流利度偏低，试着连贯一些、少停顿。」，并且连评语一起落库 ——
-- 历史回看时看到的还是这句误导性评语。用户会以为系统真的听出来他读得差。
--
-- 总分 `score` 不一样，它有一条兜底链 overall → pronunciation → integrity → 0，
-- 且**必定非空**（映射器只在有道的成功响应上工作）。没有这条链的维度列必须可空，
-- 否则就只能像现在这样用 `?? 0` 伪造一个分数。
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
-- ── 为什么没有 (user_id, updated_at) 索引 ───────────────────────────────────
--
-- 曾经有一条 `idx_pronunciation_user_updated (user_id, updated_at)`，已删。
-- 它服务不了任何查询：本次全部访问路径都是**两列等值**（upsert、
-- 「取上一句评语」、`/api/courses/sentences` 的 LEFT JOIN），
-- `uk_pronunciation_user_sentence (user_id, sentence_id)` 的最左前缀已完全覆盖。
-- 唯一会用到它的形状是「按 user_id 取一页、按 updated_at 排序」——
-- 而设计里「进步曲线 / 历史列表」被明确列为**非目标**（一句话只有一行）。
-- 多一条索引就是给每次写入加一份维护成本，换不来任何查询。
--
-- ── 执行后校验 ──────────────────────────────────────────────────────────────
--
-- ① 表排序规则（新表必须显式 utf8mb4_unicode_ci，否则 JOIN users 会
--    Illegal mix of collations —— 见 db/README.md 记的那次事故）：
--
--   SELECT TABLE_COLLATION FROM information_schema.TABLES
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='pronunciation_scores';
--   -- 期望 utf8mb4_unicode_ci
--
-- ② `id` 有默认值、`updated_at` 带 on update、三个维度列可空、总分不可空。
--    这四处都是漏了**不会当场报错**的地方（id 漏了是静默存不进去，
--    维度漏成 NOT NULL 是把「没给分」固化成 0）：
--
--   SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
--     FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='pronunciation_scores'
--      AND COLUMN_NAME IN ('id','score','accuracy','fluency','integrity','updated_at')
--    ORDER BY FIELD(COLUMN_NAME,'id','score','accuracy','fluency','integrity','updated_at');
--   -- 期望：id          COLUMN_DEFAULT='uuid()'，EXTRA='DEFAULT_GENERATED'
--   --       score       IS_NULLABLE='NO'
--   --       accuracy    IS_NULLABLE='YES'
--   --       fluency     IS_NULLABLE='YES'
--   --       integrity   IS_NULLABLE='YES'
--   --       updated_at  EXTRA 含 'on update CURRENT_TIMESTAMP'
--
--   注：MySQL 8.0.13+ 的表达式默认值在 EXTRA 里只标 `DEFAULT_GENERATED`，
--   不会写出 `uuid()`，所以默认值要看 COLUMN_DEFAULT。
--
-- ③ 索引只剩主键与唯一键（多出来的是漏删的冗余索引）：
--
--   SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
--     FROM information_schema.STATISTICS
--    WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='pronunciation_scores'
--    GROUP BY INDEX_NAME, NON_UNIQUE;
--   -- 期望只有两行：PRIMARY 与 uk_pronunciation_user_sentence
--
-- ④ 真跑一次写入，验证「默认值生效」与「维度可空」：
--
--   INSERT INTO pronunciation_scores (user_id, sentence_id, score, accuracy, fluency, integrity)
--     VALUES ('probe','probe',88,90,NULL,95);
--   -- 不报 1364 → id 的库级默认值生效（这是本文件最容易漏的一条）
--   -- 不报 1048 → fluency 确实可空（缺失的维度存 NULL，不是 0）
--
--   -- 覆盖语义：同一 (user_id, sentence_id) 再写一次仍只有一行
--   INSERT INTO pronunciation_scores (user_id, sentence_id, score, accuracy, fluency, integrity)
--     VALUES ('probe','probe',90,92,80,96)
--     ON DUPLICATE KEY UPDATE score=VALUES(score), accuracy=VALUES(accuracy),
--       fluency=VALUES(fluency), integrity=VALUES(integrity);
--   SELECT COUNT(*), MAX(score) FROM pronunciation_scores WHERE user_id='probe';
--   -- 期望 1 行、score=90（重录覆盖，不留旧行）
--
--   DELETE FROM pronunciation_scores WHERE user_id='probe';
--
-- 回滚：
--   DROP TABLE IF EXISTS pronunciation_scores;

CREATE TABLE IF NOT EXISTS `pronunciation_scores` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `user_id`     VARCHAR(36)  NOT NULL,
  `sentence_id` VARCHAR(36)  NOT NULL,
  -- 总分有 overall → pronunciation → integrity → 0 的兜底链，必定有值
  `score`       INT          NOT NULL,
  -- 三个维度**可空**：有道没给这个字段时存 NULL，绝不写 0。
  -- 与 words[].score 同一套策略（见文件头「为什么三个维度列可空」）。
  -- 若这里写成 NOT NULL，写入方就只能用 0 兜底 → 评语规则会给字段缺失的
  -- 用户生成「流利度偏低…」并落库，历史回看时还是这句误导性评语。
  `accuracy`    INT          NULL,
  `fluency`     INT          NULL,
  `integrity`   INT          NULL,
  `speed`       DECIMAL(6,2) NULL,
  `words`       JSON         NULL,
  `comment`     VARCHAR(500) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- ON UPDATE 必须留着：界面上的「3 天前」用的是最近一次评分的时间。
  -- 注意它**不是** `DEFAULT CURRENT_TIMESTAMP` 的等价写法（见 schema.ts 同处注释）。
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pronunciation_user_sentence` (`user_id`, `sentence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
