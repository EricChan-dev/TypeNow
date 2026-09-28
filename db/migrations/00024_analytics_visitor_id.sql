-- 00024_analytics_visitor_id.sql
-- 匿名访客的长期身份
--
-- 背景：2026-09-28「后台管理的埋点事件和分析是不是缺一个东西，现在分析的都是已注册
-- 的用户？没注册的用户是不是完全没有落库和分析？」—— 落库是有的（api/analytics/track
-- 一直保留匿名写入，user_id 为 NULL），但**分析只能数 PV 和会话数，数不出人**：
-- 匿名事件此前唯一的身份是 session_id，而它存在 sessionStorage 里
-- （lib/analytics.ts 的 `_typ_sid`），关掉标签页就没了，多开一个标签页又是新 UUID。
--
-- 三个具体后果：
--   1. COUNT(DISTINCT session_id) 当"人数"看会系统性高估 —— 同一人每次访问都算新的；
--   2. 匿名访客与之后的注册之间**没有任何字段能串起来**，做不了"匿名 → 注册"的
--      转化归因（users.signup_channel / signup_source 只是渠道级，不回答个人轨迹）；
--   3. /admin/events 的事件详情页对匿名事件退化成"按 session_id 取前后 15 条"
--      （api/admin/events/[id]/route.ts），跨会话的轨迹直接断掉。
--
-- 解法：客户端多写一个一年期的 typ_vid cookie（非 HttpOnly，必须由 JS 在首次浏览
-- 那一刻写），每次上报带上；本列存它。报表侧一律用
-- `COALESCE(visitor_id, session_id)` 兜底 —— 旧数据、隐私模式、广告拦截器造成的
-- 缺失会自然降级成"按会话计"，不会丢事件也不会报错。
--
-- 为什么不是安全边界：cookie 由客户端可控，和 typ_first_touch 一样只用于统计展示，
-- 任何权限/奖励判断都不许读它。写入前统一走 lib/visitor.ts 的 isVisitorId 校验
-- （只接受 crypto.randomUUID 的输出），至少保证格式与长度可控，不让人随手灌垃圾
-- 造出无数个假"访客"。
--
-- 存量数据全部为 NULL：无法事后还原（cookie 当时根本没写）。不要编造。
-- 从加了这一列之后的流量开始，匿名 UV 才是可信的；之前的存量只能按会话近似。
--
-- 索引：idx_ae_visitor 为「独立访客数」与「首访时间（MIN(created_at) GROUP BY
-- visitor_id）」服务 —— 首启漏斗的第一步就是这条查询，没有索引只能全表扫。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
-- 纯加列 + 加索引，不改既有数据，Online DDL，可在业务时段安全执行。
-- 列宽 64 与 analytics_events.session_id 保持一致（实际值 36 字符的 UUID）。
--
-- collation 必须显式写 utf8mb4_unicode_ci：与 00021 / 00023 同理，MySQL 8 服务器
-- 默认的 utf8mb4_0900_ai_ci 一旦参与 JOIN 比较就会抛 "Illegal mix of collations"。

ALTER TABLE analytics_events
  ADD COLUMN visitor_id VARCHAR(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '匿名访客长期身份（typ_vid cookie，见 lib/visitor.ts）',
  ADD INDEX idx_ae_visitor (visitor_id);

-- 校验：
--   SHOW COLUMNS FROM analytics_events LIKE 'visitor%';   -- 新列应全为 NULL
--   SHOW INDEX FROM analytics_events WHERE Key_name = 'idx_ae_visitor';
--   部署后观察：
--   SELECT COUNT(*) total,
--          SUM(visitor_id IS NULL) no_visitor,
--          COUNT(DISTINCT visitor_id) visitors
--   FROM analytics_events WHERE created_at >= CURDATE();
