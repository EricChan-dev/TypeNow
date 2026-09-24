import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { generateKeyPairSync, createSign } from "crypto"
import {
  createNativeOrder,
  getWechatPayCerts,
  isWeChatPayConfigured,
  resetWechatPayCertCache,
  resetWechatPayPublicKeyCache,
} from "@/lib/wechat-pay"

/**
 * 微信支付 v3 的请求头契约。
 *
 * 回归背景：Node 的 fetch（undici）默认会给每个请求带上
 *   accept-language: *
 * 而微信支付的参数校验只接受 zh-CN / en-US：
 *   GET /v3/certificates → 406 {"code":"PARAM_ERROR","message":"传入了不支持的Accept-Language"}
 * 平台证书拿不到，回调验签就永远失败，每笔真实支付回调都被 401 顶回去
 * （线上 typenow-error.log 里累计 11 次）。所以这两个请求头必须显式覆盖。
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
})

/**
 * 「微信侧」的密钥对：应答签名由微信的私钥产生，我们用配置的公钥验签。
 * 应答现在也必须验签（见 verifyWechatPayResponse），所以假响应必须带签名头。
 */
const wechatPay = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
})

const PUBLIC_KEY_ID = "PUB_KEY_ID_0111122210052026053000182085000202"

/** 按微信的格式给一段响应体签名 */
function signResponse(body: string): Headers {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = "stub-nonce"
  const signer = createSign("RSA-SHA256")
  signer.update(`${timestamp}\n${nonce}\n${body}\n`)
  return new Headers({
    "Wechatpay-Timestamp": timestamp,
    "Wechatpay-Nonce": nonce,
    "Wechatpay-Signature": signer.sign(wechatPay.privateKey, "base64"),
    "Wechatpay-Serial": PUBLIC_KEY_ID,
  })
}

const SAVED = { ...process.env }

interface Captured {
  url: string
  headers: Record<string, string>
  method: string
}

let captured: Captured[] = []

function stubFetch(responder: (c: Captured) => { status: number; body: unknown }): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const c: Captured = { url, headers, method: init.method ?? "GET" }
    captured.push(c)
    const { status, body } = responder(c)
    const text = JSON.stringify(body)
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: signResponse(text),
      json: async () => body,
      text: async () => text,
    } as unknown as Response
  })
}

beforeEach(() => {
  captured = []
  resetWechatPayCertCache()
  resetWechatPayPublicKeyCache()
  process.env.WECHAT_PAY_PUBLIC_KEY_ID = PUBLIC_KEY_ID
  process.env.WECHAT_PAY_PUBLIC_KEY = wechatPay.publicKey
  delete process.env.WECHAT_PAY_PUBLIC_KEY_PATH
  process.env.WECHAT_PAY_MCH_ID = "1112221005"
  process.env.WECHAT_PAY_APP_ID = "wxd663bd3d07ae0eb5"
  process.env.WECHAT_PAY_API_V3_KEY = "0123456789abcdef0123456789abcdef"
  process.env.WECHAT_PAY_SERIAL_NO = "ABCDEF0123456789"
  process.env.WECHAT_PAY_PRIVATE_KEY = privateKey
  process.env.WECHAT_PAY_NOTIFY_URL = "https://typenow.cn/api/payment/notify"
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...SAVED }
})

describe("微信支付请求头", () => {
  it("前置条件：测试里的配置足以通过 isWeChatPayConfigured", () => {
    expect(isWeChatPayConfigured()).toBe(true)
  })

  it("下单请求带 Accept-Language: zh-CN（不能被 undici 的 * 覆盖）", async () => {
    stubFetch(() => ({ status: 200, body: { code_url: "weixin://wxpay/bizpayurl?pr=abc" } }))

    const res = await createNativeOrder({
      plan: "yearly",
      outTradeNo: "TYPENOW-HEADER-0001",
      description: "年付会员",
      amount: 19900,
    })
    expect(res.code_url).toBe("weixin://wxpay/bizpayurl?pr=abc")

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/native")
    expect(captured[0].headers["Accept-Language"]).toBe("zh-CN")
    expect(captured[0].headers.Accept).toBe("application/json")
    expect(captured[0].headers.Authorization).toContain('WECHATPAY2-SHA256-RSA2048 mchid="1112221005"')
  })

  it("平台证书请求带 Accept-Language: zh-CN", async () => {
    stubFetch(() => ({ status: 200, body: { data: [] } }))

    await getWechatPayCerts()

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe("https://api.mch.weixin.qq.com/v3/certificates")
    expect(captured[0].headers["Accept-Language"]).toBe("zh-CN")
    expect(captured[0].headers.Accept).toBe("application/json")
    // 头名不能退化成小写以外的其他形式，也不能缺失 Authorization
    expect(captured[0].headers.Authorization).toMatch(/^WECHATPAY2-SHA256-RSA2048 /)
  })

  it("证书接口 406 时抛出可定位的错误，而不是静默返回空证书", async () => {
    stubFetch(() => ({
      status: 406,
      body: { code: "PARAM_ERROR", message: "传入了不支持的Accept-Language" },
    }))

    await expect(getWechatPayCerts()).rejects.toThrow(
      /Failed to fetch WeChat platform certificates: 406/
    )
  })
})
