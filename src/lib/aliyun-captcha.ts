import CaptchaClient, {
  VerifyIntelligentCaptchaRequest,
} from "@alicloud/captcha20230305"
import { $OpenApiUtil } from "@alicloud/openapi-core"

/**
 * 阿里云「验证码 2.0」的服务端校验。
 *
 * ── 为什么是它 ──────────────────────────────────────────────────────────────
 * 发短信是**要花钱、且能被用来短信轰炸 / 枚举手机号**的入口。基准实现
 * 用的就是阿里云验证码 2.0 的客户端 V2 架构（`window.AliyunCaptchaConfig` +
 * `initAliyunCaptcha` + `captchaVerifyCallback`），这里沿用同一套：客户端形态
 * （「拖动图片对齐」等）在**控制台建场景时**选择，代码侧不用管，因此能和基准实现
 * 完全对齐而无需自己实现拖拽校验。
 *
 * ── 环境变量 ────────────────────────────────────────────────────────────────
 *   NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID  控制台「场景管理」里的场景 ID
 *   NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX    控制台「概览 → 实例基本信息」里的身份标
 *   ALIYUN_ACCESS_KEY_ID / _SECRET       与短信共用同一对（RAM 需额外授权验证码权限）
 *
 * 两个 NEXT_PUBLIC_ 变量**必须**公开：客户端 initAliyunCaptcha 要用。
 * 两个都没配时整套人机校验自动关闭（见 isCaptchaConfigured），本地开发因此不受影响。
 *
 * ── 三条判定口径 ────────────────────────────────────────────────────────────
 *   1. 接口正常返回且 `verifyResult === false` → **拦**（人机验证没过）；
 *   2. 接口本身异常（超时 / 5xx / 限流）→ **放行**（fail-open）。官方原文：验证码
 *      属于安全增强手段，不应成为业务可用性的单点故障；
 *   3. 参数缺失 / 为空 → **拦**。这一条**不是** fail-open：官方 FAQ Q17 说初始化
 *      调用失败时会自动触发验证回调 —— 若这里放行，攻击者只要掐断验证码 CDN 就能
 *      完全绕过人机校验。所以只有「参数有效但阿里云挂了」才放行，
 *      「压根没拿到参数」必须拦。
 */

/**
 * 与客户端 `AliyunCaptchaConfig.region = "cn"` 必须一致。
 * 官方铁律：客户端 cn 对服务端中国内地地址，客户端 sgp 对新加坡地址。
 * 换 region 要同时改这里和客户端 hook。
 */
const CAPTCHA_ENDPOINT = "captcha.cn-shanghai.aliyuncs.com"

/**
 * `captchaVerifyParam` 的长度上限。纯粹是防滥用（这是个不信任的字符串，会直接进
 * SDK 请求体）。真实 V2 参数是 JSON 明文、含 deviceToken/data 两段 base64，
 * 约 1~2KB；8KB 已足够宽松，超过这个量级只可能是构造出来的垃圾。
 */
const MAX_PARAM_LENGTH = 8192

export type CaptchaVerdict =
  | { result: "pass"; certifyId?: string }
  | { result: "fail"; code?: string; certifyId?: string }
  /** 阿里云侧不可用（或我们没配好）—— 调用方应按**放行**处理。 */
  | { result: "unavailable"; error: string }

/**
 * 人机校验是否已配置。两个 NEXT_PUBLIC 变量缺一不可：
 * 少 prefix 客户端起不来，自然也就永远收不到参数，服务端只会一直拒。
 */
export function isCaptchaConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID &&
      process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX,
  )
}

let client: CaptchaClient | null = null

function getClient(): CaptchaClient | null {
  if (client) return client
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET
  if (!accessKeyId || !accessKeySecret) return null

  const config = new $OpenApiUtil.Config({ accessKeyId, accessKeySecret })
  config.endpoint = CAPTCHA_ENDPOINT
  // 超时要短：这一步在用户点「获取验证码」的关键路径上，
  // 宁可快速 fail-open，也不要把人晾在那里等一个可能永远不会来的响应。
  config.readTimeout = 5000
  config.connectTimeout = 3000
  client = new CaptchaClient(config)
  return client
}

/**
 * 校验客户端回调上来的 `captchaVerifyParam`。
 *
 * 注意入参**不能做任何修改**（官方明确警告）：必须原样透传给 SDK，
 * 这里只做 trim 与长度检查，不做解析 —— V2 是 JSON 明文、V3 是 base64 密文，
 * 去解析它会在换架构时静默失效。
 */
export async function verifyCaptcha(
  captchaVerifyParam: string,
): Promise<CaptchaVerdict> {
  const sceneId = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID
  const captchaClient = getClient()

  if (!captchaClient || !sceneId) {
    // 配置缺失（缺 AK 或缺场景 ID）不是「用户验证失败」，而是我们这边没配好。
    // 按「服务不可用」处理 → 放行，但必须留下**明确**的错误日志，
    // 否则会静默降级成人机校验形同虚设，线上还看不出来。
    const error = !sceneId
      ? "NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID 未配置"
      : "ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 未配置"
    console.error(`[captcha] ${error}，本次跳过人机校验`)
    return { result: "unavailable", error }
  }

  const param = captchaVerifyParam.trim()
  if (!param || param.length > MAX_PARAM_LENGTH) {
    return { result: "fail", code: "INVALID_PARAM" }
  }

  try {
    const request = new VerifyIntelligentCaptchaRequest({
      captchaVerifyParam: param,
      // 官方建议显式传 SceneId：多场景下可防止前端被篡改成别的场景。
      sceneId,
    })

    const response = await captchaClient.verifyIntelligentCaptcha(request)
    const result = response.body?.result

    // SDK 的字段是小写驼峰（resp.body.result.verifyResult），线上字段才是
    // Result.VerifyResult —— 映射写死在 SDK 的 `static names()` 里。
    if (result?.verifyResult === true) {
      return { result: "pass", certifyId: result.certifyId }
    }
    // 走到这里说明接口**正常返回**了「不通过」（如 F001 疑似攻击、F008 重复提交、
    // F015 拼图没对上）。按官方口径：接口正常返回 false 必须拦，不能 fail-open。
    return {
      result: "fail",
      code: result?.verifyCode,
      certifyId: result?.certifyId,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error("[captcha] 校验接口异常，本次放行：", error)
    return { result: "unavailable", error }
  }
}
