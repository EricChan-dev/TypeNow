-- 00018_feedback_handling.sql
-- 用户反馈的「处理流转」字段
--
-- 背景：user_feedback 从上线起就只有写入路径，**没有任何后台读取入口** ——
-- 反馈只以一条微信客服消息的形式推到 WECHAT_FEEDBACK_ADMIN_OPENID，
-- 那条消息一滚过去就找不回来了。线上实测已经积了 8 条，没人看过。
--
-- 所以这里不是"加个列表页"那么简单：要能回答"哪条还没处理"，
-- 表上就必须有状态。没有状态列的话，列表页只能按时间倒序铺开，
-- 处理过和没处理过的混在一起，用不了几天就又没人看了。
--
--   source      —— 从哪来的（门户端 / 学习中心）。两者共用一个 FeedbackModal，
--                  原先只有一份数据、分不出来源；来源由前端按当前路由上报，
--                  服务端白名单校验（它只用于展示与分组，不参与任何权限判断）
--   status      —— 处理状态，默认 open
--   handled_by  —— 谁处理的（后台用户 id）
--   handled_at  —— 什么时候处理的
--   admin_note  —— 处理备注（例如"已修复，下版生效"）
--
-- 索引：
--   idx_feedback_status            —— 列表按状态筛 + 仪表盘「待处理反馈」计数
--   idx_feedback_status_created    —— 按状态筛之后按时间倒序翻页
--   （原有的 idx_feedback_created 保留：不带状态时的全局时间倒序仍然用它）
--
-- 存量数据一律为 open：那 8 条确实没人处理过。source 统一 unknown（当时没记录，
-- 不猜）。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
-- 加列 + 加索引、不改既有数据，Online DDL，可在业务时段安全执行。

ALTER TABLE user_feedback
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'unknown',
  ADD COLUMN status ENUM('open', 'in_progress', 'resolved', 'ignored') NOT NULL DEFAULT 'open',
  ADD COLUMN handled_by VARCHAR(36) DEFAULT NULL,
  ADD COLUMN handled_at DATETIME DEFAULT NULL,
  ADD COLUMN admin_note TEXT DEFAULT NULL,
  ADD INDEX idx_feedback_status (status),
  ADD INDEX idx_feedback_status_created (status, created_at);
