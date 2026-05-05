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
