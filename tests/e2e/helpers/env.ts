/**
 * e2e 环境构造。
 *
 * 三条硬约束，任何一条被破坏都必须让测试直接失败，而不是"看起来通过了"：
 *
 * 1. 绝不能连到生产库。DATABASE_URL 一律改写成本机测试库，并在使用前断言
 *    库名与主机；e2e 会 TRUNCATE 全部业务表。
 * 2. 绝不能真的调用外部服务（微信支付/微信 OAuth/DeepSeek/有道/阿里云短信）。
 *    Next 的 env 加载器只在 process.env 里「不存在」该键时才采用 .env.local
 *    的值（@next/env 的 processEnv 只填 undefined 的键），所以这里把外部服务
 *    的键显式置成空串来屏蔽 .env.local 里的真实凭据。空串同时会被
 *    isWeChatPayConfigured()/isWeChatConfigured() 判为未配置。
 * 3. 必须跑在 NODE_ENV=development。这是刻意的：支付模拟（1 分钱售价、跳过
 *    验签、明文报文兜底）与 dev 会话旁路都以 development 为条件，没有它们就
 *    无法在本地把支付链路跑通。生产行为另由只读 smoke 套件覆盖。
 */

export const TEST_DB_NAME = "typenow_test"

export const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ??
  "mysql://root:typenow_test_pw@127.0.0.1:3399/typenow_test"

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3311)

/**
 * e2e 专用的 CRON_SECRET。
 *
 * 用它而不是随机值，是为了让测试能写出"错误密钥 → 403"这条断言 ——
 * 那正是这个接口最重要的一条安全性质（fail-closed + 常量时间比较）。
 */
export const E2E_CRON_SECRET = "e2e-cron-secret-not-for-production"
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`

/** 断言目标库确实是本机测试库。任何拼装错误的 DATABASE_URL 都在此终止。 */
export function assertTestDatabase(url: string = TEST_DB_URL): void {
  const u = new URL(url)
  const db = u.pathname.replace(/^\//, "")
  if (db !== TEST_DB_NAME) {
    throw new Error(
      `[e2e] 拒绝运行：目标库是 "${db}"，不是测试库 "${TEST_DB_NAME}"。` +
        `e2e 会清空全部业务表，绝不能指向生产库。`
    )
  }
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    throw new Error(
      `[e2e] 拒绝运行：目标主机是 "${u.hostname}"，只允许本机测试库（127.0.0.1/localhost）。`
    )
  }
}

const BLANKED_KEYS = [
  // 微信支付
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_NOTIFY_URL",
  "WECHAT_PAY_NOTIFY_KEY",
  // 微信开放平台 / 公众号
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "WECHAT_OA_APP_ID",
  "WECHAT_OA_APP_SECRET",
  "WECHAT_OA_TOKEN",
  "WECHAT_OA_ENCODING_AES_KEY",
  "WECHAT_FEEDBACK_ADMIN_OPENID",
  // AI / TTS / 短信
  "DEEPSEEK_API_KEY",
  "YOUDAO_APP_KEY",
  "YOUDAO_APP_SECRET",
  "ALIYUN_ACCESS_KEY_ID",
  "ALIYUN_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_SIGN_NAME",
  "ALIYUN_SMS_TEMPLATE_CODE",
  // 主动触达（生命周期消息）：模板/短信凭据一并屏蔽。
  // 这意味着 e2e 里所有发送都会走 not_configured 分支 —— **不会真的骚扰任何人**，
  // 同时能验证"占位 → 发送 → 落 skipped"这条完整链路。
  "ALIYUN_SMS_NOTIFY_SIGN_NAME",
  "ALIYUN_SMS_NOTIFY_TEMPLATE_CODE",
  "WECHAT_TEMPLATE_TRIAL_EXPIRING",
  "WECHAT_TEMPLATE_TRIAL_EXPIRED",
  "WECHAT_TEMPLATE_MONTHLY_EXPIRING",
  "WECHAT_TEMPLATE_YEARLY_EXPIRING",
  "WECHAT_TEMPLATE_YEARLY_EXPIRED",
  "WECHAT_TEMPLATE_REGISTERED_NO_TRIAL",
  // 监控 / 上传（避免构建期或运行期外呼）
  "SENTRY_AUTH_TOKEN",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
]

/**
 * 构造被测服务端的完整环境变量。
 *
 * 内部先拼成普通 Record 再断言成 NodeJS.ProcessEnv：本仓库的 @types/node 把
 * NODE_ENV 声明为必填且由 typeof 推导的只读字面量（"development" 不在其中），
 * 而这里恰恰必须把它覆盖成 development 才能启用支付沙箱与 dev 会话旁路。
 * 断言只影响类型层，运行时就是交给 spawn 的纯字符串字典。
 */
export function buildE2eEnv(): NodeJS.ProcessEnv {
  assertTestDatabase(TEST_DB_URL)

  const env: Record<string, string | undefined> = { ...process.env }

  env.DATABASE_URL = TEST_DB_URL
  env.NODE_ENV = "development"
  env.NEXT_PUBLIC_DB_CONFIGURED = "1"

  // 空串（而非 delete）才是屏蔽手段：键一旦存在，Next 就不会再用 .env.local 的值
  for (const key of BLANKED_KEYS) env[key] = ""

  // 主动触达扫描接口需要这两个才能被测到：
  //   · CRON_SECRET 用一个测试专用值（线上必须是随机长串，且不得复用其他密钥）
  //   · LIFECYCLE_ENABLED 默认是关闭的（fail-closed），e2e 必须显式打开
  env.CRON_SECRET = E2E_CRON_SECRET
  env.LIFECYCLE_ENABLED = "true"

  // 给**部分**场景配置"假模板 ID"。
  //
  // 这不是为了绕过校验，而是让两条路径都能被测到：
  //   · 配了假 ID → usableChannels 认为模板渠道可用 → 走"占位 → 尝试发送 →
  //     因公众号凭据缺失而落 skipped"这条完整链路（幂等性只能在这里验）
  //   · 没配 ID（YEARLY_* 刻意留空）→ 渠道不可用 → **不占位**，
  //     这条路径同样必须验：模板批下来之前占位会永久吃掉那次到期提醒
  // 两条路径都不会产生真实网络调用（WECHAT_OA_* 已被清空）。
  env.WECHAT_TEMPLATE_TRIAL_EXPIRING = "e2e-dummy-template"
  env.WECHAT_TEMPLATE_TRIAL_EXPIRED = "e2e-dummy-template"
  env.WECHAT_TEMPLATE_MONTHLY_EXPIRING = "e2e-dummy-template"
  env.WECHAT_TEMPLATE_REGISTERED_NO_TRIAL = "e2e-dummy-template"

  // 独立构建产物目录。
  //
  // Next 16 用 `<distDir>/dev/lock` 判定"同目录是否已有 dev 实例"，发现就**拒绝启动**。
  // 本地往往有一个正在跑的 `next dev`（例如 DSH Desktop 内嵌的那个，占着 3000），
  // 于是 e2e 永远起不来。指向别的 distDir 后两把锁互不相干，可以并存 ——
  // 顺带也避免了 e2e 的编译产物与本地 dev 的产物互相覆盖。
  // 复用 deploy.sh 同一个环境变量（见 next.config.ts 的 distDir）。
  env.TYPENOW_DIST_DIR = ".next-e2e"

  // 明确锁死测试端口，避免与本地 dev（3000）或线上端口冲突
  env.PORT = String(E2E_PORT)
  env.NEXT_TELEMETRY_DISABLED = "1"

  return env as NodeJS.ProcessEnv
}
