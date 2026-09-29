-- 00028_member_daily_grant.sql
-- 会员每日赠送钻石：新增 diamond_logs.type = 'member_grant' 与其幂等键 grant_day
--
-- ── 为什么需要它 ────────────────────────────────────────────────────────────
--
-- 双货币拆分后（见 00027），钻石不再由练习产出 —— 那么**会员的钻石从哪来？**
-- 句乐部的做法是「会员每月自动获得 10,000 颗钻石，在会员周期开始日重置」。
--
-- 我们**不**照搬「每月 1 号发一大笔」，原因是本仓库没有任何定时任务
-- （lib/commission-safety.ts 明确说明了这点，它自己也是靠"懒补偿"规避的）。
-- 改为**按需懒发放**：用户每次进站时补发当日份（lib/member-grant.ts），
-- 靠数据库唯一索引保证一天只发一次。这样不需要任何调度器，也不怕漏跑。
--
-- 数值：MEMBER_DAILY_DIAMONDS = 30（见 lib/membership-benefits.ts）。
-- 成本口径：30 钻 ÷ 5 钻/次 = 6 次 AI 对话/天，按单次约 ¥0.007 估算 ≈ ¥1.3/月，
-- 加上会员每日 20 次免费额度，会员每天约 26 次、合计约 ¥5.5/月（占 ¥29 月卡 19%）。
--
-- ── 幂等键为什么必须落在数据库上 ────────────────────────────────────────────
--
-- 「一天只发一次」如果靠代码「先 SELECT 再 INSERT」，并发下（用户开两个标签页进站）
-- 会各自查到"没发过"、然后各插一行 —— 一天发两份。
-- 用唯一索引把它变成数据库约束之后，第二次 INSERT 直接失败，
-- 代码只需看 affectedRows 就知道该不该继续。
--
-- 为什么要 grant_day 这一列、而不是对 (user_id, DATE(created_at), type) 建索引：
--   · created_at 是 DATETIME，且 MySQL 的 DATE() 依赖会话时区，不适合做唯一键；
--   · 生成列方案也可行（00025 用过），但那个方案在 task_logs 上是**必须**的，
--     因为它要在"同一列上区分不同 task_type"；这里条件简单（只有 member_grant 写值），
--     一个普通可空列加唯一索引就够了，可读性更好。
--
-- MySQL 唯一索引允许多个 NULL，所以其余类型的行（grant_day 恒为 NULL）不受约束 ——
-- 这与 task_logs.share_day 是同一套手法（见 00025）。
--
-- ── 枚举值追加在末尾 ────────────────────────────────────────────────────────
--
-- 与 00013 的约定一致：追加末位值只需改元数据，不必重建表；插在中间会导致
-- 已有行的枚举序号含义变化，需要重写全表。现有 5 个值的顺序保持不动。
--
-- ── collation ───────────────────────────────────────────────────────────────
--
-- grant_day 是**已有表上的新列**，因此刻意**不写 COLLATE**，让它继承 diamond_logs
-- 的表级排序规则（实测为 utf8mb4_unicode_ci）。
--
-- 这与 00021「新表必须显式写 COLLATE」并不矛盾，反而是同一条原则的两面：
--   · 新表若不写，会拿到**库/服务器**默认值，可能与既有表不同 → 跨表 JOIN 报错；
--   · 已有表上的新列若不写，会继承**本表**规则，天然与同表其它列一致。
-- 显式写死反而会造成「drizzle-kit push 建的测试库」与生产的无意义结构差异
-- （00025 的注释里记录了这个实测结论）。
--
-- grant_day 只在本表内参与唯一索引，从不与其它表比较，所以继承是本表正确的意图。
--
-- ── 幂等性 ──────────────────────────────────────────────────────────────────
--
-- MODIFY COLUMN / ADD COLUMN / ADD UNIQUE INDEX 重复执行都会报错，属预期，只需执行一次。
--
-- ── 校验 ────────────────────────────────────────────────────────────────────
--
--   SHOW COLUMNS FROM diamond_logs LIKE 'type';       -- 末尾应含 'member_grant'
--   SHOW COLUMNS FROM diamond_logs LIKE 'grant_day';  -- varchar(10), NULL
--   SHOW INDEX FROM diamond_logs;                     -- 应含 uk_diamond_grant_day (user_id, grant_day)
--
--   -- 存量行不受影响（全部为 NULL，不参与唯一性）
--   SELECT type, COUNT(*) n, SUM(grant_day IS NOT NULL) with_day
--   FROM diamond_logs GROUP BY type;
--     -- member_grant 在本次迁移前不存在，所以应为 0 行；其余类型的 with_day 必须全为 0
--
-- ── 回滚 ────────────────────────────────────────────────────────────────────
--
--   ALTER TABLE diamond_logs DROP INDEX uk_diamond_grant_day;
--   ALTER TABLE diamond_logs DROP COLUMN grant_day;
--   ALTER TABLE diamond_logs
--     MODIFY COLUMN type ENUM('sentence','lesson_complete','course_complete','share_invite','chat') NOT NULL;
--
--   ⚠️ 第三条在**已经发过赠钻**之后执行会失败或丢数据：ENUM 收缩时，
--      值为 member_grant 的行无法映射。必须先
--        DELETE FROM diamond_logs WHERE type = 'member_grant';
--      但那等于删掉会员已获得的流水 —— 回滚前请确认这可以接受。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。

ALTER TABLE diamond_logs
  MODIFY COLUMN type ENUM('sentence','lesson_complete','course_complete',
                          'share_invite','chat','member_grant') NOT NULL;

ALTER TABLE diamond_logs
  ADD COLUMN grant_day VARCHAR(10) NULL
    COMMENT '仅 member_grant 有值：会员每日赠钻的幂等键（上海日历日，见 00028 注释）';

ALTER TABLE diamond_logs
  ADD UNIQUE INDEX uk_diamond_grant_day (user_id, grant_day);
