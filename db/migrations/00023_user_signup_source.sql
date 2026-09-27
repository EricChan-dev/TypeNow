-- 00023_user_signup_source.sql
-- 注册来源归因
--
-- 背景：2026-09-28 老板问「能分析出来新增的用户是从哪里来的吗，我还没对外推广过」，
-- 结论是**数据答不了** —— 25 个账号里 22 个是「在 /login 扫公众号二维码、关注后
-- 自动建号」，但没记任何来源信息：注册时刻既没有埋点事件（lib/analytics.ts 当时
-- 明确写着「注册以 users 表为权威，不需要再埋点」），也没有存 referrer / UA / IP。
-- 唯一能事后查到的线索是去微信接口捞 subscribe_scene（本项目每查一次要临时写脚本）。
--
-- 讽刺的是微信侧的归因字段**早就在类型里声明了却从未落库**：
-- lib/wechat.ts 的 OAUserInfo 有 subscribe_scene / qr_scene_str / subscribe_time，
-- 建号时一个都没存。
--
-- 两列的分工：
--   signup_channel —— 主轴线，可筛可 GROUP BY。取值见 lib/signup-source.ts 的
--                     SIGNUP_CHANNELS：wechat_oa_qr（公众号扫码，目前的主力）/
--                     wechat_oa_oauth（微信内直接授权）/ wechat_open_qr（开放平台扫码）/
--                     phone / dev。
--   signup_source  —— JSON，放明细。用 JSON 而不是再加七列的理由：这批字段是
--                     「微信给了什么 + 这次 HTTP 请求带了什么」，天生是开放集合
--                     （以后加 UTM、设备、小程序场景号都不用再迁一次表）；
--                     与 analytics_events.properties / admin_audit_logs.detail 同一套路。
--                     写入前统一走 buildSignupSource 白名单清洗（键集合固定、
--                     截断、丢空值），**不接受调用方直接塞任意 JSON**。
--
-- 为什么单独存 first-touch 的 referrer，而不是直接用注册请求的 Referer：
-- 注册发生在 /login，那一刻的 Referer 是 **我们自己**（`https://typenow.cn/login`）
-- 或微信授权页 —— 存下来等于没存。真正有信息量的是「这个人第一次带着外部来源
-- 进来的那一刻」，所以客户端会把它写进 typ_first_touch cookie（见 lib/first-touch.ts），
-- 注册时一并落进这里。
--
-- 存量 25 行全部为 NULL：那时的来源无法从数据库还原（只能用微信接口回填渠道与
-- 微信侧字段，referrer / UA / IP 永久缺失 —— 不要事后编造）。
--
-- 索引：idx_users_signup_channel 为「按来源统计/筛选」服务。表现在很小，
-- 但这类报表查询天生是全表聚合，早点建上比以后再补便宜。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
-- 纯加列 + 加索引，不改既有数据，Online DDL，可在业务时段安全执行。
--
-- collation 必须显式写 utf8mb4_unicode_ci：MySQL 8 默认的 utf8mb4_0900_ai_ci
-- 与库里其它表不一致，一旦 JOIN 比较字符串就会抛
-- "Illegal mix of collations"（00021 已踩过一次，见 db/README.md）。

ALTER TABLE users
  ADD COLUMN signup_channel VARCHAR(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '注册渠道：wechat_oa_qr/wechat_oa_oauth/wechat_open_qr/phone/dev',
  ADD COLUMN signup_source JSON DEFAULT NULL
    COMMENT '注册来源明细（白名单键，见 lib/signup-source.ts）',
  ADD INDEX idx_users_signup_channel (signup_channel);

-- 校验：
--   SHOW COLUMNS FROM users LIKE 'signup%';
--   SELECT signup_channel, COUNT(*) FROM users GROUP BY signup_channel;  -- 新列应全为 NULL
