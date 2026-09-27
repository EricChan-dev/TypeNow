-- 00017_missing_indexes.sql
-- 补两条后台筛选缺失的索引
--
-- 背景：后台的仪表盘与各列表都是按这两列筛的，而它们**一个索引都没有**：
--
--   1. users.trial_claimed_at
--      仪表盘「领取体验会员」按它做时间范围过滤（`trial_claimed_at >= ?`），
--      用户列表的 `?trial=1` 钻取也走它。目前 users 只有 24 行所以无感，
--      但它的增长曲线就是"注册量"，属于必然会长大的表。
--
--   2. subscriptions.status
--      仪表盘「活跃订阅」是 `COUNT(*) WHERE status='active'`，
--      从它钻取到订阅列表也带 `status=active`。同样是小表，同样会长。
--
-- 为什么现在加最合适：两张表目前都极小（users 24 行、subscriptions 3 行），
-- 建索引是瞬时的；等数据长起来再补就要在业务高峰做 DDL 了。
-- 这与 00014 的理由一致（那次补的是 created_at / paid_at 那批）。
--
-- 顺带说明**没有**加的两个：
--   - users.name / users.phone 的模糊搜索（`LIKE '%x%'`）用不上 B-tree 索引，
--     加了也没用；真要提速得换全文索引或改成前缀匹配，属另一次改动。
--   - 软删除的 deleted_at / deleted_batch（见 00016）：`IS NULL` 选择性接近 0。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
-- 纯加索引、不改数据，可在业务时段安全执行。

ALTER TABLE users
  ADD INDEX idx_users_trial_claimed_at (trial_claimed_at);

ALTER TABLE subscriptions
  ADD INDEX idx_subscriptions_status (status);
