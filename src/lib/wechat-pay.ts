import { randomUUID, createSign, createVerify } from "crypto"

const WECHAT_PAY_HOST = "https://api.mch.weixin.qq.com"

function getConfig() {
  return {
    appId: process.env.WECHAT_PAY_APP_ID || process.env.WECHAT_APP_ID || "",
    mchId: process.env.WECHAT_PAY_MCH_ID || "",
    apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || "",
    serialNo: process.env.WECHAT_PAY_SERIAL_NO || "",
    privateKey: process.env.WECHAT_PAY_PRIVATE_KEY || "",
    notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || "",
    sandbox: process.env.WECHAT_PAY_SANDBOX === "true",
  }
}

export function isWeChatPayConfigured(): boolean {
  const cfg = getConfig()
  return Boolean(cfg.mchId && cfg.apiV3Key && cfg.serialNo && cfg.privateKey)
}

function decodePrivateKey(encoded: string): string {
  // Support both raw PEM and base64-encoded PEM
  if (encoded.includes("-----BEGIN")) return encoded
  return Buffer.from(encoded, "base64").toString("utf-8")
}

function buildSignature(
  method: string,
  urlPath: string,
  timestamp: number,
  nonce: string,
  body: string
): string {
  const cfg = getConfig()
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
  const privateKey = decodePrivateKey(cfg.privateKey)
  const sign = createSign("RSA-SHA256")
  sign.update(message)
  return sign.sign(privateKey, "base64")
}

function buildAuthHeader(
  method: string,
  urlPath: string,
  body: string
): { Authorization: string; timestamp: string; nonce: string } {
  const cfg = getConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID().replace(/-/g, "").substring(0, 32)
  const signature = buildSignature(method, urlPath, timestamp, nonce, body)
  const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serialNo}"`
  return { Authorization: auth, timestamp: String(timestamp), nonce }
}

export interface CreateOrderParams {
  plan: "monthly" | "yearly" | "partner"
  outTradeNo: string
  description: string
  amount: number
}

export interface CreateOrderResult {
  code_url: string
  out_trade_no: string
}

export interface QueryOrderResult {
  out_trade_no: string
  transaction_id?: string
  trade_state: string
  trade_state_desc: string
}

async function wechatPayRequest(
  method: string,
  urlPath: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cfg = getConfig()
  const bodyStr = body ? JSON.stringify(body) : ""
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...buildAuthHeader(method, urlPath, bodyStr),
  }

  const url = `${cfg.sandbox ? WECHAT_PAY_HOST + "/sandboxnew" : WECHAT_PAY_HOST}${urlPath}`
  const res = await fetch(url, { method, headers, body: bodyStr || undefined })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`WeChat Pay error ${res.status}: ${errText}`)
  }

  return res.json() as Promise<Record<string, unknown>>
}

export async function createNativeOrder(
  params: CreateOrderParams
): Promise<CreateOrderResult> {
  const cfg = getConfig()

  // Dev mode: return mock QR code
  if (!isWeChatPayConfigured()) {
    return {
      code_url: `weixin://wxpay/bizpayurl?pr=mock_${params.outTradeNo}`,
      out_trade_no: params.outTradeNo,
    }
  }

  const urlPath = "/v3/pay/transactions/native"
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours

  const result = await wechatPayRequest("POST", urlPath, {
    appid: cfg.appId,
    mchid: cfg.mchId,
    out_trade_no: params.outTradeNo,
    description: params.description,
    notify_url: cfg.notifyUrl,
    amount: { total: params.amount, currency: "CNY" },
    time_expire: expiresAt.toISOString(),
  })

  return {
    code_url: result.code_url as string,
    out_trade_no: params.outTradeNo,
  }
}

export async function queryOrder(
  outTradeNo: string
): Promise<QueryOrderResult> {
  const cfg = getConfig()

  // Dev mode: simulate success after a brief delay
  if (!isWeChatPayConfigured()) {
    return {
      out_trade_no: outTradeNo,
      trade_state: "NOTPAY",
      trade_state_desc: "开发模式 - 未支付",
    }
  }

  const urlPath = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${cfg.mchId}`
  const result = await wechatPayRequest("GET", urlPath)
  return result as unknown as QueryOrderResult
}

// ─── WeChat Pay platform certificate management ────────────────────────────────

interface PlatformCert {
  serial_no: string
  effective_time: string
  expire_time: string
  encrypt_certificate: {
    algorithm: string
    nonce: string
    associated_data: string
    ciphertext: string
  }
}

interface CertEntry {
  serialNo: string
  publicKey: string
  expiresAt: number
}

let certCache: CertEntry[] | null = null
let certCacheExpiresAt = 0

async function getWechatPayCerts(): Promise<CertEntry[]> {
  // Return cached certs if still valid (cache for 6 hours)
  if (certCache && Date.now() < certCacheExpiresAt) {
    return certCache
  }

  const cfg = getConfig()
  const urlPath = "/v3/certificates"
  const bodyStr = ""
  const { Authorization } = buildAuthHeader("GET", urlPath, bodyStr)

  const url = `${WECHAT_PAY_HOST}${urlPath}`
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization, Accept: "application/json" },
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error("[WeChat Pay] Failed to fetch certificates:", res.status, errText)
    // Fall back to cached certs even if expired
    if (certCache) return certCache
    throw new Error(`Failed to fetch WeChat platform certificates: ${res.status}`)
  }

  const data = await res.json()
  const certs: PlatformCert[] = (data as Record<string, unknown>).data as PlatformCert[] || []

  // Decrypt each certificate using the APIv3 key
  certCache = certs.map((cert) => {
    const { ciphertext, nonce, associated_data } = cert.encrypt_certificate
    const publicKey = decryptCert(ciphertext, nonce, associated_data, cfg.apiV3Key)
    return {
      serialNo: cert.serial_no,
      publicKey,
      expiresAt: new Date(cert.expire_time).getTime(),
    }
  })

  certCacheExpiresAt = Date.now() + 6 * 60 * 60 * 1000 // 6 hours
  return certCache
}

function decryptCert(
  ciphertext: string,
  nonce: string,
  associatedData: string,
  apiV3Key: string,
): string {
  const crypto = require("crypto") as typeof import("crypto")
  const key = crypto.createHash("sha256").update(apiV3Key).digest()
  const authTagLength = 16
  const ciphertextBytes = Buffer.from(ciphertext, "base64")
  const tag = ciphertextBytes.subarray(ciphertextBytes.length - authTagLength)
  const actualCipher = ciphertextBytes.subarray(0, ciphertextBytes.length - authTagLength)
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"))
  decipher.setAuthTag(tag)
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, "base64"))
  return Buffer.concat([decipher.update(actualCipher), decipher.final()]).toString("utf-8")
}

/**
 * Decrypt WeChat Pay v3 callback notification resource.
 * Used for both TRANSACTION.SUCCESS and REFUND.SUCCESS events.
 */
export function decryptNotifyResource(
  ciphertext: string,
  nonce: string,
  associatedData: string,
): Record<string, unknown> {
  const cfg = getConfig()
  if (cfg.apiV3Key) {
    const decrypted = decryptCert(ciphertext, nonce, associatedData, cfg.apiV3Key)
    return JSON.parse(decrypted) as Record<string, unknown>
  }
  // Dev mode / unconfigured: attempt to parse ciphertext directly as JSON
  try {
    return JSON.parse(ciphertext) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function verifyNotifySignature(
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
  serialNo: string,
): Promise<boolean> {
  if (!isWeChatPayConfigured()) {
    return true // Dev mode: accept all
  }

  try {
    const certs = await getWechatPayCerts()
    const cert = certs.find((c) => c.serialNo === serialNo)

    if (!cert) {
      console.error(`[WeChat Pay] Certificate not found for serial: ${serialNo}`)
      return false
    }

    const message = `${timestamp}\n${nonce}\n${body}\n`
    const verifier = createVerify("RSA-SHA256")
    verifier.update(message)

    return verifier.verify(cert.publicKey, signature, "base64")
  } catch (err) {
    console.error("[WeChat Pay] Signature verification error:", err)
    return false
  }
}

export function generateOutTradeNo(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = randomUUID().replace(/-/g, "").substring(0, 6).toUpperCase()
  return `TYPENOW-${ts}-${rand}`
}

export function getPlanAmount(plan: "monthly" | "yearly" | "partner"): number {
  if (plan === "monthly") return 2900
  if (plan === "yearly") return 19900
  return 39900 // partner lifetime
}

export function getPlanDescription(plan: "monthly" | "yearly" | "partner"): string {
  if (plan === "monthly") return "TypeNow 月度会员"
  if (plan === "yearly") return "TypeNow 年度会员"
  return "TypeNow 合伙人终身会员"
}

export interface TransferResult {
  batchId: string
  batchStatus: string
}

export async function wechatTransferBatch(params: {
  appId: string
  outBatchNo: string
  openid: string
  amount: number
  remark: string
}): Promise<TransferResult> {
  const cfg = getConfig()
  if (!isWeChatPayConfigured()) throw new Error("微信支付未配置")

  const body = {
    appid: params.appId,
    out_batch_no: params.outBatchNo,
    batch_name: "合伙人佣金提现",
    batch_remark: params.remark,
    total_amount: params.amount,
    total_num: 1,
    transfer_detail_list: [
      {
        out_detail_no: params.outBatchNo,
        transfer_amount: params.amount,
        transfer_remark: params.remark,
        openid: params.openid,
      },
    ],
  }

  const result = await wechatPayRequest("POST", "/v3/transfer/batches", body)
  return {
    batchId: result.batch_id as string ?? params.outBatchNo,
    batchStatus: result.batch_status as string ?? "ACCEPTED",
  }
}
