-- 00025_task_logs_daily_index.sql
-- 把「每天只能领一次」的唯一约束**限定在分享任务上**
--
-- ── 要修的缺陷 ──────────────────────────────────────────────────────────────
--
-- task_logs 有 uk_task_user_type_date (user_id, task_type, date)。它的本意是
-- 「分享任务每天只能领一次」—— tasks/share 正是靠 `INSERT IGNORE` 的
-- affectedRows 判断「今日是否已领」。
--
-- 但这个键**对所有 task_type 生效**，而邀请奖励是按「被邀请人」计数的，
-- 于是同一邀请人在同一天拉到第二个付费用户时：
--
--   (邀请人, invite_purchase, 今天)  ← 第二笔
--   与第一笔 (邀请人, invite_purchase, 今天) 冲突
--     → INSERT 抛 ER_DUP_ENTRY
--     → lib/auth/invite.ts 把它当成「已发过」直接 return
--     → 邀请人少拿 30 天、被邀请人少拿 20 天，且没有任何日志
--
-- 注册档同理：同一天邀请第二个好友时那行记账写不进去，
-- 表现为「已邀请 N 人」少算（这一档不涉及天数，只影响统计）。
--
-- 线上现状（2026-09-28 核对）：task_logs 共 5 行，**全部是 share_invite**，
-- invite_register / invite_purchase 一行都没有 —— 也就是说这个缺陷**还没有
-- 实际伤到任何人**，属于要提前堵掉的雷，不是事后补救。
--
-- ── 为什么不是「把 ref_id 加进这个键」 ──────────────────────────────────────
--
-- 最直觉的修法是改成 (user_id, task_type, date, ref_id)，但它会**破坏分享的
-- 每日去重**：share_invite 的 ref_id 是 NULL（见 src/lib/db/schema.ts 的说明），
-- 而 MySQL 唯一索引认为多个 NULL 互不相等 —— 于是 (用户, share_invite, 今天, NULL)
-- 可以插任意多行，分享就能反复领 10 钻石。存量 5 行的 ref_id 恰好全为 NULL，
-- 这不是理论问题。
--
-- ── 采用的解法：虚拟生成列 ─────────────────────────────────────────────────
--
-- 用一个虚拟生成列把「日期」**只在 share_invite 上**暴露出来，再对它建唯一索引：
--
--   share_day = IF(task_type = 'share_invite', date, NULL)
--
--   · share_invite     → share_day = 当天日期 → (user_id, share_day) 唯一，
--                        分享的「每天一次」完整保留，tasks/share 的
--                        INSERT IGNORE 语义不变
--   · invite_register  → share_day = NULL → 不受该索引约束，同一天可以邀请多个
--   · invite_purchase  → share_day = NULL → 同一天可以有多笔付费奖励
--
-- invite_* 两类的幂等仍然由既有的 uk_task_ref_type (task_type, ref_id) 保证：
-- 同一个被邀请人每种类型各一条，所以「仅首购有效、续费不触发」照旧成立。
--
-- ── 安全性 ──────────────────────────────────────────────────────────────────
--
-- 纯放宽 + 纯加索引：
--   · VIRTUAL 生成列不占数据页，也不需要回填（按行实时计算）；
--   · 新增的唯一索引不会失败 —— 删旧索引前已确认现有数据在
--     (user_id, share_day) 上无重复（5 行分享各属不同 (用户, 日期)）；
--   · 删掉的 uk_task_user_type_date 的语义已被 uk_task_share_day 完整覆盖，
--     且全仓只有 tasks/share 依赖它（其余使用点都按 task_type 计数、与日期无关）。
--
-- 执行顺序不构成上线阻塞：本迁移是**放宽**，旧代码在新结构下同样正确，
-- 新代码在旧结构下也仍然会跑（只是依旧有被吞奖励的缺陷）。
-- 推荐先执行本 DDL 再部署配套代码。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
--
-- collation 刻意**不显式指定**，让它继承表的默认排序规则。
--
-- 这一点与 00021 / 00023 / 00024 不同，是有意的：那几处必须显式写
-- utf8mb4_unicode_ci，是因为新列会**跨表参与 JOIN 比较**，而 MySQL 8 服务器默认的
-- utf8mb4_0900_ai_ci 一旦与 unicode_ci 的列相比就会抛 Illegal mix of collations。
--
-- share_day 只在**本表内**参与唯一索引，从不与其它表比较，所以正确的意图是
-- 「跟随本表」：生产库的 task_logs 已由 00021 统一为 utf8mb4_unicode_ci，
-- 省略 COLLATE 时 ADD COLUMN 会继承表级排序规则，结果就是 unicode_ci。
-- 反过来，显式写死 unicode_ci 会让「drizzle-kit push 建的测试库」与生产出现
-- 无意义的结构差异（测试库的表是容器默认的 0900_ai_ci）—— 实测确认过。

ALTER TABLE task_logs
  ADD COLUMN share_day VARCHAR(10)
    GENERATED ALWAYS AS (IF(`task_type` = 'share_invite', `date`, NULL)) VIRTUAL
    COMMENT '仅 share_invite 有值：把「每天一次」约束限定在分享任务上（见 00025 注释）';

ALTER TABLE task_logs
  ADD UNIQUE INDEX uk_task_share_day (user_id, share_day);

ALTER TABLE task_logs
  DROP INDEX uk_task_user_type_date;

-- ── 校验 ────────────────────────────────────────────────────────────────────
--
--   SHOW INDEX FROM task_logs;
--     -- 应看到 uk_task_share_day (user_id, share_day)，且 uk_task_user_type_date 已消失
--
--   SELECT task_type, COUNT(*) n, SUM(share_day IS NOT NULL) has_day
--   FROM task_logs GROUP BY task_type;
--     -- share_invite 应全部 has_day = 1；invite_register / invite_purchase 应全部 0
--
--   -- 放宽是否生效（应能成功插入两笔同日不同 ref_id 的 invite_purchase）
--   -- 用测试账号验证，不要在线上直接试；见 src/__tests__ 与 e2e 的用例。
--
-- ── 回滚 ────────────────────────────────────────────────────────────────────
--
-- MySQL 的 DDL 自动提交、无法回滚，所以逆向语句必须提前准备好：
--
--   ALTER TABLE task_logs
--     ADD UNIQUE INDEX uk_task_user_type_date (user_id, task_type, date);
--   ALTER TABLE task_logs
--     DROP INDEX uk_task_share_day;
--   ALTER TABLE task_logs
--     DROP COLUMN share_day;
--
-- ⚠️ 回滚前必须先确认**没有**同日同类型的多行数据，否则第一条会因重复而失败
--    （这正是本迁移要放开的那些行）：
--
--   SELECT user_id, task_type, date, COUNT(*) n FROM task_logs
--   WHERE task_type <> 'share_invite'
--   GROUP BY user_id, task_type, date HAVING n > 1;
--
--   若查出行来，说明系统已经真的发放过多笔同日邀请奖励 —— 此时应保留新结构，
--   不要再回滚（回滚等于把这些已发出的奖励重新变成"不可能存在"的状态）。
