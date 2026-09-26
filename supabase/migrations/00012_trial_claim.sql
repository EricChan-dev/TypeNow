-- 00012_trial_claim.sql
-- 体验会员（注册试用）改为「按手机号一次性、可主动领取」
--
-- 背景：原先三个注册入口都无条件送 3 天会员（is_pro=1 + pro_expires=now+3d），
-- 用户既没有「领取」这个动作、也不知道自己有这么一份权益，到期后毫无感知地流失。
-- 改为对齐句乐部：注册不再自动送，未受邀用户点付费内容时弹窗领取 5 天；
-- 受邀用户（referred_by 非空）注册即自动领取。
--
-- 为什么不需要新建「手机号键」的独立表：
--   users.phone 与 users.wechat_openid 都是 UNIQUE，且注册是 find-or-create
--   （已存在的手机号复用同一账号，见 api/auth/verify-code），因此
--   一个手机号至多对应一个账号 —— 「每账号一次」天然等于「每手机号一次」，
--   把标记放在 users 行上就够了，无需跨表维护一致性。
--
--   已知缺口：本项目没有自助注销（SettingsClient 写的是「如需注销账号，请联系客服」），
--   所以「账号已注销仍不可再领」这条只在客服人工删号后才可能被绕过，需人工介入，
--   风险可接受。**若将来上线自助注销，必须改为按手机号/unionid 独立键的表**，
--   否则删号重注册即可反复领取。
--
-- 为什么用「可空 + 条件更新」而不是布尔列：
--   领取要走 `WHERE id = ? AND trial_claimed_at IS NULL` 的条件更新，靠 affectedRows
--   判断是否真正占用成功，从而让并发/重复请求只放行一次（与支付回调同一套幂等思路）。
--   用时间戳列还能顺带回答「什么时候领的」，布尔列答不了。
--
-- 是否需要手动执行：需要。
-- 依据：仓库里没有任何自动迁移执行器 —— package.json 无 migrate 脚本，
-- drizzle.config.ts 只配置了 generate/push 的输出目录，.github/ 下没有 workflows，
-- deploy.sh 也不含 SQL 步骤。故本文件需部署时手动应用。

ALTER TABLE users
  ADD COLUMN trial_claimed_at DATETIME DEFAULT NULL;

-- 存量用户一律回填为「已领取」，时间取注册时间。
--
-- 为什么必须回填：新列对存量用户全是 NULL，而「体验会员按手机号一次」的语义是
-- 每人只能领一次。旧模型下**每个**注册用户都已经拿过 3 天试用，所以留 NULL 会让
-- 上线后所有老用户都能再领一次 5 天 —— 存量用户量级下这是一次没有计划的普发。
--
-- 回填后只有本次上线之后注册的新用户具备领取资格，与「每人一次」一致。
-- （若日后想对老用户做定向召回，应另开一次带条件的活动，而不是把领取资格默认打开。）
UPDATE users
   SET trial_claimed_at = created_at
 WHERE trial_claimed_at IS NULL;
