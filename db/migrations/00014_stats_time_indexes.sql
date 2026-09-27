-- 00014_stats_time_indexes.sql
-- 后台时间范围统计所需的索引
--
-- 背景：仪表盘与数据分析要支持「近一周 / 近一月 / 近一季 / 不限」。
-- 这些筛选全都是在 created_at（或 paid_at）上做范围过滤，而生产库实测这些列上
-- **一个索引都没有**（practice_records / users / payment_orders / subscriptions
-- 只有主键与 user_id 之类的索引）。数据量大了以后每个范围查询都会变成全表扫描。
--
-- 为什么现在加最合适：这几张表目前都极小（practice_records 31 行、users 24 行、
-- payment_orders 7 行、subscriptions 3 行），建索引是瞬时的；等数据长起来再补
-- 就要在业务高峰做 DDL 了。
--
-- analytics_events 已有 idx_ae_type_time (event_type, created_at)。
-- 那个索引对「按类型 + 时间」有效，但**全局**时间筛选（不带 event_type）
-- 用不上它（最左列是 event_type），所以这里再补一个单独的 created_at 索引。
-- 两者不重复：一个是给「某事件的趋势」，一个是给「所有事件的趋势」。
--
-- 是否需要手动执行：需要。仓库没有迁移执行器（见 db/README.md）。
-- 这几条都是纯加索引、不改数据，可在业务时段安全执行。

-- 练习记录：时间范围统计「新增练习数 / 活跃用户数」 + 每日趋势
CREATE INDEX idx_practice_records_created_at ON practice_records (created_at);

-- 埋点：全局时间范围（不带 event_type 时用不上已有的复合索引）
CREATE INDEX idx_ae_created_at ON analytics_events (created_at);

-- 注册用户：时间范围内新增用户 + 注册趋势
CREATE INDEX idx_users_created_at ON users (created_at);

-- 付费：时间范围内的订单与收入。status 已有单列索引，
-- 复合 (status, paid_at) 让「已支付订单按支付时间过滤」一次索引扫描完成。
CREATE INDEX idx_payment_orders_status_paid_at ON payment_orders (status, paid_at);

-- 订阅：时间范围内的新增订阅
CREATE INDEX idx_subscriptions_created_at ON subscriptions (created_at);
