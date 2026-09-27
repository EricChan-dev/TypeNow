-- 00021_unify_collation.sql
-- 统一 4 张表的排序规则（修复后台反馈页 500）
--
-- ── 现场 ────────────────────────────────────────────────────────────────────
--
-- 用户在后台打开「反馈管理」时接口 500：
--   GET /api/admin/feedback?status=unfinished  → 500
-- 服务端不报错（异常没进日志），直接用只读账号跑那条 SQL 才看到：
--   ERROR 1267 (HY000): Illegal mix of collations
--     (utf8mb4_0900_ai_ci, IMPLICIT) and (utf8mb4_unicode_ci, IMPLICIT) for operation '='
--
-- 生产库的表**排序规则本来就不统一**（实测）：
--   utf8mb4_0900_ai_ci（MySQL 8 默认）—— post_likes / practice_sessions / task_logs / user_feedback
--   utf8mb4_unicode_ci                —— 另外 29 张，**含 users**
--
-- 而我新写的反馈接口为了带出"是谁提的"，做了 `user_feedback LEFT JOIN users`——
-- 这条 JOIN 在这两个排序规则之间无法比较，于是报错。别人此前没 JOIN 过这几张表，
-- 所以这个坑一直躺着没被发现。
--
-- ── 为什么 e2e 没抓到 ───────────────────────────────────────────────────────
--
-- e2e 的库是 `drizzle-kit push` 从 schema.ts 生成的，容器里所有表都用同一个
-- （服务器默认）排序规则，**永远是齐的**。所以这类"只在线上出现"的 schema 漂移，
-- 跑一百遍 e2e 也抓不到 —— 只能靠对线上库做结构核对（本次就是这么发现的）。
--
-- ── 为什么这样修，而不是改 SQL ──────────────────────────────────────────────
--
-- 也可以在 JOIN 条件里逐个加 `COLLATE utf8mb4_unicode_ci`，但那是把 schema 的
-- 不一致固化进每一条查询：以后每写一个跨表查询都要记得加，忘一个就 500。
-- 正确做法是让表本身一致 —— 转成多数派（也是 users 用的）utf8mb4_unicode_ci。
--
-- 这 4 张表都极小（实测 user_feedback 8 行、practice_sessions 2 行、
-- post_likes 0 行、task_logs 5 行），CONVERT 是瞬时的，且不改任何数据。
--
-- ⚠️ 今后新增表**必须显式写** `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`。
--    不写就会拿到 MySQL 8 的默认 utf8mb4_0900_ai_ci，于是又有一张表和 users 对不上，
--    而这次的表现是"某个页面莫名 500"，非常难查。见 db/README.md 的说明。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。

ALTER TABLE post_likes        CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE practice_sessions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE task_logs         CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE user_feedback     CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
