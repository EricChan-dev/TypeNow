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
 * ② **不写退订提示**（这条曾写反过，改过来说清楚）：
 *    ① 阿里云《通知短信模板规范》明确要求通知类模板**不得夹带**「拒收请回复R」这类
 *       退订内容，写了会被驳回 —— 退订字样是**营销类**模板的规矩；
 *    ② 更根本的是，我们**没有短信入站回复的处理能力**（阿里云不提供回复回调），
 *       承诺「回T退订」而用户回了 T 却石沉大海，比不写更糟。
 *    退订入口只有两个**已实现**的：设置页开关、公众号内发送「退订」。
 *    （模板参数是固定的，代码也塞不进额外文字，所以这件事只能在申请模板时决定。）
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


// ─── 模板自查（启用前验证用）─────────────────────────────────────────────

export type SmsTemplateInfo =
  | {
      ok: true
      templateCode: string
      name: string
      content: string
      type: string
      status: string
      /** 模板正文里声明的变量名，如 ["tier","date","count"] */
      variables: string[]
    }
  | { ok: false; error: string }

/**
 * 读回一个已申请短信模板的正文与变量名。
 *
 * 为什么需要它：**模板里的变量名必须与代码传的参数名完全一致**，
 * 差一个字母就会在"用户该收到提醒的那一刻"发送失败，而那时已经错过了挽回窗口。
 * 模板审核要等 1~2 天，所以启用前先自查一遍，比事后从失败率里发现划算得多。
 */
export async function getSmsTemplateInfo(templateCode: string): Promise<SmsTemplateInfo> {
  if (!templateCode) return { ok: false, error: "模板 CODE 为空" }
  try {
    const { GetSmsTemplateRequest } = await import("@alicloud/dysmsapi20170525")
    const res = await getClient().getSmsTemplate(new GetSmsTemplateRequest({ templateCode }))
    const body = res.body
    if (!body || body.code !== "OK") {
      return { ok: false, error: `${body?.code}: ${body?.message || "查询失败"}` }
    }
    const content = body.templateContent ?? ""
    // 阿里云模板正文里的变量写作 ${name}
    const variables = [...content.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1])
    return {
      ok: true,
      templateCode: body.templateCode ?? templateCode,
      name: body.templateName ?? "",
      content,
      type: body.templateType ?? "",
      status: String(body.templateStatus ?? ""),
      variables: [...new Set(variables)],
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
