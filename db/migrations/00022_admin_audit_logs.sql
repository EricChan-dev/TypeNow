-- 00022_admin_audit_logs.sql
-- 后台操作审计日志
--
-- 背景：后台**完全没有**留痕。谁给谁开了会员、谁删了课程、谁把某人提成了管理员，
-- 事后一律查不到 —— 只有业务表的最终状态，没有"谁改的、什么时候、改成了什么"。
-- 软删除解决的是"删错能不能找回"，回答不了"是谁干的"。
--
-- 设计要点（都是被"审计日志必须在几个月后仍然可读"倒逼出来的）：
--
-- 1. **快照字段 `admin_label` / `target_label`**，而不是只存 id。
--    审计的价值在于事后回看，而那时的用户可能已被改名或删除。只存 id 的话，
--    一条"admin X 删除了 user Y"在 Y 被清理之后就是一行无法解读的 UUID。
--    所以这里有意做**冗余快照**：日志是自我描述的，不依赖任何 JOIN。
--
-- 2. **不建外键**。审计行必须比它记录的对象活得久 —— 被删掉的对象正是最需要
--    审计的那一类。生产库目前 fk_count = 0，这与既有约束一致。
--
-- 3. `detail` 用 JSON：不同对象的"变更内容"形状完全不同（改角色 vs 重排顺序
--    vs 批量导入）。固定列要么过宽要么丢失信息。**只写白名单字段**，
--    写入前统一脱敏（token / 密钥 / 密码一类的键直接丢弃，见 lib/admin-audit.ts）。
--
-- 4. `action` / `target_type` 用 VARCHAR 而非 ENUM。枚举需要 DDL 才能扩展，
--    而这里新增动作类型是常事；ENUM 会让"加一个动作"变成一次迁移。
--
-- 索引：
--   idx_audit_created              —— 默认列表（时间倒序）
--   idx_audit_admin_created        —— 按操作者筛选 + 时间倒序
--   idx_audit_target               —— "这个对象被谁动过"（详情页最想问的问题）
--   idx_audit_action_created       —— 按动作筛选 + 时间倒序
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
-- 纯新建表，不改既有数据，Online DDL，可在业务时段安全执行。
--
-- collation 必须显式写 utf8mb4_unicode_ci：MySQL 8 默认的 utf8mb4_0900_ai_ci
-- 与库里 29 张表不一致，一旦与其他表 JOIN 比较 varchar 就会抛
-- "Illegal mix of collations"（00021 已经踩过一次，见 db/README.md）。

CREATE TABLE admin_audit_logs (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  -- 操作者。dev 旁路下没有真实用户，为 NULL（admin_label 会记 'dev-admin'）
  admin_id     VARCHAR(36)  DEFAULT NULL,
  -- 操作者快照：例如 "张三(166****2010)"。用户改名/删除后这行仍然可读
  admin_label  VARCHAR(191) DEFAULT NULL,
  -- 动作：create / update / delete / restore / reorder / split / upload / analyze / import
  action       VARCHAR(50)  NOT NULL,
  -- 对象类型：user / course / lesson / sentence / material
  target_type  VARCHAR(50)  NOT NULL,
  target_id    VARCHAR(64)  DEFAULT NULL,
  -- 对象快照：例如句子的中文前 80 字、课程名。同上，不依赖 JOIN
  target_label VARCHAR(191) DEFAULT NULL,
  -- 变更摘要（白名单字段 + 已脱敏）。演示：{"level":{"from":1,"to":5}}
  detail       JSON         DEFAULT NULL,
  ip           VARCHAR(64)  DEFAULT NULL,
  user_agent   VARCHAR(255) DEFAULT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_admin_created (admin_id, created_at),
  KEY idx_audit_target (target_type, target_id, created_at),
  KEY idx_audit_action_created (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 校验：
--   SHOW CREATE TABLE admin_audit_logs\G   -- 确认 COLLATE=utf8mb4_unicode_ci
--   SELECT COUNT(*) FROM admin_audit_logs; -- 新表应为 0
