-- 00036: 图形滑块验证码（发短信防刷）
--
-- 背景：发送短信验证码此前只靠频次限流（IP/手机号维度）防刷。盗刷方换个 IP
-- 池仍可让平台持续为陌生人买短信。本次在 send-sms 前加一道服务端出题的
-- 图形滑块对齐验证：背景/拼图由 /api/auth/captcha 用 pngjs 生成，缺口 x 坐标
-- （答案）只存本表；客户端回传 {id, x}，服务端按容差判定。
--
-- 语义对齐 verification_codes：
--   * 一次性 —— used 置 1 后不可复用（UPDATE ... WHERE used=0 原子认领）；
--   * 有过期 —— expires_at（默认 5 分钟），过期行由发信路由顺手清理；
--   * 验一次就作废 —— 无论对错，认领即作废，防止对同一题枚举 x。
--
-- 容量估计：每题一行，仅 5 分钟生命周期，量级 = 发短信次数 × 失败重试，很小。
--
-- 幂等重放：本文件全部是 CREATE TABLE IF NOT EXISTS，可安全重复执行。
--
-- 回滚：
--   DROP TABLE IF EXISTS captcha_challenges;

CREATE TABLE IF NOT EXISTS `captcha_challenges` (
  `id` VARCHAR(36) NOT NULL DEFAULT (UUID()),
  -- 拼图缺口的正确 x（像素，背景坐标系）；判定容差 ±5px 在 lib/slider-captcha
  `answer_x` INT NOT NULL,
  -- 申请方 IP，便于排查盗刷来源
  `ip` VARCHAR(50) NOT NULL DEFAULT '',
  `expires_at` DATETIME NOT NULL,
  `used` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_captcha_challenges_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
