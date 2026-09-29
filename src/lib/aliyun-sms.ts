import Dysmsapi20170525, {
  SendSmsRequest,
} from "@alicloud/dysmsapi20170525"
import { $OpenApiUtil } from "@alicloud/openapi-core"

let client: Dysmsapi20170525 | null = null

function getClient(): Dysmsapi20170525 {
  if (client) return client

  const config = new $OpenApiUtil.Config({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID!,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET!,
  })
  config.endpoint = "dysmsapi.aliyuncs.com"
  client = new Dysmsapi20170525(config)
  return client
}

export async function sendVerificationCode(
  phone: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const smsClient = getClient()

  const request = new SendSmsRequest({
    phoneNumbers: `+86${phone}`,
    signName: process.env.ALIYUN_SMS_SIGN_NAME!,
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE!,
    templateParam: JSON.stringify({ code }),
  })

  const response = await smsClient.sendSms(request)

  if (response.body?.code !== "OK") {
    return {
      success: false,
      error: response.body?.message || "短信发送失败",
    }
  }

  return { success: true }
}

// ─── 通知类短信（主动触达用）─────────────────────────────────────────────────

export type SmsSendOutcome =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "failed"; error: string }

/**
 * 发送通知类短信（会员到期提醒等）。
 *
 * ── 与验证码短信的三处差别 ──────────────────────────────────────────────────
 *
 * ① **签名与模板不同**：验证码走 `ALIYUN_SMS_TEMPLATE_CODE`，通知类必须用**另一个
 *    已审核通过**的模板（`ALIYUN_SMS_NOTIFY_TEMPLATE_CODE`）。阿里云不允许混用，
 *    而且通知类模板需要单独申请、单独审核（§11.6 第 3 条，1–2 天）。
 *
 * ② **必须有退订方式**：《通信短信息服务管理规定》要求商业性短信息提供退订方式。
 *    ⚠️ **退订提示不能由代码拼接** —— 短信模板的参数是<b>固定</b>的，代码多塞一段文字
 *    会直接发送失败。正确做法是**在申请模板时就把「回T退订」写进模板正文**。
 *    这里只负责填参数，并把这个前提写进注释，免得后来的人试图在代码里加。
 *
 * ③ **时段限制**：通知类短信通常只允许 8:00–20:00 发送（由服务商限制）。
 *    这也是扫描任务定在 10:00 与 19:00 的原因之一（§11.5 ②）。
 *
 * 未配置模板时返回 `not_configured` 而不是 `failed`：模板还没批下来是**预期内**
 * 状态，不该每天被当成失败重试，否则日志噪声会淹没真正的故障。
 */
export async function sendNotificationSms(
  phone: string,
  templateCode: string,
  params: Record<string, string>
): Promise<SmsSendOutcome> {
  if (!templateCode) {
    return { ok: false, reason: "not_configured", error: "通知短信模板未配置" }
  }
  if (!phone) {
    // 没绑手机号的用户走不了短信渠道。这是预期内情况（微信注册可以不绑手机），
    // 调用方应当降级到模板消息，而不是记一次失败。
    return { ok: false, reason: "not_configured", error: "用户没有手机号" }
  }

  try {
    const smsClient = getClient()

    const request = new SendSmsRequest({
      phoneNumbers: `+86${phone}`,
      // 通知类短信有独立签名时用独立的，没配就回落到验证码那套签名
      signName: process.env.ALIYUN_SMS_NOTIFY_SIGN_NAME || process.env.ALIYUN_SMS_SIGN_NAME!,
      templateCode,
      templateParam: JSON.stringify(params),
    })

    const response = await smsClient.sendSms(request)

    if (response.body?.code !== "OK") {
      return {
        ok: false,
        reason: "failed",
        error: `${response.body?.code}: ${response.body?.message || "短信发送失败"}`,
      }
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      reason: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
