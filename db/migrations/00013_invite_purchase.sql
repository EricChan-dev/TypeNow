-- 00013_invite_purchase.sql
-- 「邀请有礼」新增首购档：task_type 增加 invite_purchase，幂等键改为 (task_type, ref_id)
--
-- 背景：邀请奖励原先只有注册一档（invite_register）。按句乐部的天数制补上首购档，
-- 规则为：好友首购时**双方**都得会员天数、仅首次购买有效、建立邀请关系后 30 天内有效。
--
-- 为什么必须改唯一索引（本次迁移的真正原因）：
--   原索引是 `uk_invite_ref (ref_id)`，即 ref_id 全局唯一。而注册档与首购档
--   记的是**同一个被邀请人**，ref_id 相同 —— 注册那行写进去之后，首购那行
--   会直接撞唯一键插不进来，首购奖励永远发不出去。
--   改成 (task_type, ref_id) 之后：
--     ① 同一被邀请人每种类型各一条，「注册」不会被重复计数；
--     ② 首购天然只能成功一次，日后用户续费再触发也插不进去，
--        这正是「仅首购有效、续费不触发」的落点（靠数据库约束，而不是靠代码判断）；
--     ③ share_invite 的 ref_id 为 NULL，MySQL 唯一索引允许多个 NULL，行为不变。
--
-- 为什么新增枚举值放在**末尾**：
--   MySQL 的 ENUM 追加末位值只需改元数据，不必重建表；插在中间会导致已有行的
--   枚举序号含义变化，需要重写全表。现有值顺序 share_invite / invite_register 保持不动。
--
-- 是否存在违反新索引的存量数据：不会。
--   存量 invite_register 行的 ref_id 本来就唯一（旧索引保证），因此 (task_type, ref_id)
--   必然也唯一；share_invite 行 ref_id 均为 NULL，不参与唯一性冲突。
--
-- 幂等性：本文件未使用 IF EXISTS / IF NOT EXISTS 于 DROP INDEX
--   （MySQL 对 DROP INDEX 不支持 IF EXISTS），重复执行会在 DROP 处报错。
--   若需重跑，请先确认索引状态：
--     SHOW INDEX FROM task_logs;
--
-- 是否需要手动执行：需要。
-- 依据：仓库没有任何自动迁移执行器（package.json 无 migrate 脚本、.github 下无
-- workflows、deploy.sh 不含 SQL 步骤）。注意 e2e 用的测试库是由 drizzle-kit push
-- 从 src/lib/db/schema.ts 生成的，不走本文件 —— 所以 schema.ts 与本文件必须同步改，
-- 两处的列类型、索引名与列顺序都要一致。

ALTER TABLE task_logs
  MODIFY COLUMN task_type ENUM('share_invite','invite_register','invite_purchase') NOT NULL;

ALTER TABLE task_logs
  DROP INDEX uk_invite_ref;

CREATE UNIQUE INDEX uk_task_ref_type ON task_logs (task_type, ref_id);
