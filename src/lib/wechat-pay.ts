import { randomUUID, createSign, createVerify, createDecipheriv } from "crypto"
import { readFileSync } from "fs"

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
    // ── 微信支付公钥模式（详见 verifyWechatPaySignature 上方注释）──
    // 公钥ID（PUB_KEY_ID_ 开头），商户平台「账户中心 → API 安全 → 微信支付公钥」可见
    publicKeyId: process.env.WECHAT_PAY_PUBLIC_KEY_ID || "",
    // 公钥本身：PEM 内容（.env 里换行写成 \n）或 base64 编码的 PEM
    publicKey: process.env.WECHAT_PAY_PUBLIC_KEY || "",
    // 或者放一个文件，给路径（推荐：文件放到仓库外，git pull 碰不到）
    publicKeyPath: process.env.WECHAT_PAY_PUBLIC_KEY_PATH || "",
  }
}

export function isWeChatPayConfigured(): boolean {
  const cfg = getConfig()
  return Boolean(cfg.mchId && cfg.apiV3Key && cfg.serialNo && cfg.privateKey)
}

/**
 * 是否为开发环境。
 *
 * 支付相关的"模拟"兜底（假二维码、跳过验签、明文报文）都必须以此为条件，
 * 不能以"是否配置了微信支付"为条件：生产环境一旦漏配密钥，前者会静默降级
 * 成一个任何人可用的支付后门，后者只是报错。
 */
function isDevMode(): boolean {
  return process.env.NODE_ENV === "development"
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

/**
 * 微信支付 v3 的公共请求头。
 *
 * 必须显式覆盖 Accept-Language：Node 的 fetch（undici）默认会带
 * `accept-language: *`，而微信支付的参数校验只接受 zh-CN / en-US，
 * 会对 `/v3/certificates` 直接返回
 *   406 {"code":"PARAM_ERROR","message":"传入了不支持的Accept-Language"}
 * 拿不到平台证书 → 回调验签必然失败 → 每笔真实回调都被 401 顶回去。
 *
 * 线上证据（2026-09-23，typenow-error.log）：该证书请求累计 11 次 406。
 */
function wechatPayBaseHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Language": "zh-CN",
  }
}

async function wechatPayRequest(
  method: string,
  urlPath: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cfg = getConfig()
  const bodyStr = body ? JSON.stringify(body) : ""
  const headers: Record<string, string> = {
    ...wechatPayBaseHeaders(),
    "Content-Type": "application/json",
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

  if (!isWeChatPayConfigured()) {
    // 仅开发环境返回假二维码。生产环境必须拒绝下单：否则用户拿到一个
    // 永远无法支付的二维码，同时在库里留下一条真实的 pending 订单。
    if (isDevMode()) {
      return {
        code_url: `weixin://wxpay/bizpayurl?pr=mock_${params.outTradeNo}`,
        out_trade_no: params.outTradeNo,
      }
    }
    throw new Error("微信支付未配置，暂时无法下单")
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

  if (!isWeChatPayConfigured()) {
    if (isDevMode()) {
      return {
        out_trade_no: outTradeNo,
        trade_state: "NOTPAY",
        trade_state_desc: "开发模式 - 未支付",
      }
    }
    throw new Error("微信支付未配置，无法查询订单")
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

export interface CertEntry {
  serialNo: string
  publicKey: string
  expiresAt: number
}

let certCache: CertEntry[] | null = null
let certCacheExpiresAt = 0

/** 拉取并缓存微信支付平台证书（导出以便单测断言请求头）。 */
export async function getWechatPayCerts(): Promise<CertEntry[]> {
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
    headers: { ...wechatPayBaseHeaders(), Authorization },
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
    const publicKey = decryptAesGcm(ciphertext, nonce, associated_data, cfg.apiV3Key)
    return {
      serialNo: cert.serial_no,
      publicKey,
      expiresAt: new Date(cert.expire_time).getTime(),
    }
  })

  certCacheExpiresAt = Date.now() + 6 * 60 * 60 * 1000 // 6 hours
  return certCache
}

/** 仅供测试：清空平台证书缓存，避免用例之间互相污染。 */
export function resetWechatPayCertCache(): void {
  certCache = null
  certCacheExpiresAt = 0
}

/**
 * 解密微信支付 v3 的 AES-256-GCM 报文（平台证书与回调 resource 通用）。
 *
 * 微信支付 APIv3 规范：
 *   key             = APIv3 密钥原样的 32 字节 UTF-8 内容（不是它的哈希）
 *   nonce           = UTF-8 字符串字节（不是 base64）
 *   associated_data = UTF-8 字符串字节（不是 base64）
 *   ciphertext      = base64，末尾 16 字节为 GCM auth tag
 *
 * 旧实现把 key 做了 SHA-256、又把 nonce / AAD 当 base64 解码，因此一旦真的
 * 配置了微信支付，验签通过后的解密必然抛错（回调全部 500）。
 */
export function decryptAesGcm(
  ciphertext: string,
  nonce: string,
  associatedData: string,
  apiV3Key: string,
): string {
  const key = Buffer.from(apiV3Key, "utf-8")
  if (key.length !== 32) {
    throw new Error("WECHAT_PAY_API_V3_KEY 必须为 32 字节")
  }
  const authTagLength = 16
  const ciphertextBytes = Buffer.from(ciphertext, "base64")
  if (ciphertextBytes.length <= authTagLength) {
    throw new Error("微信支付密文长度非法")
  }
  const tag = ciphertextBytes.subarray(ciphertextBytes.length - authTagLength)
  const actualCipher = ciphertextBytes.subarray(0, ciphertextBytes.length - authTagLength)
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "utf-8"))
  decipher.setAuthTag(tag)
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf-8"))
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
    const decrypted = decryptAesGcm(ciphertext, nonce, associatedData, cfg.apiV3Key)
    return JSON.parse(decrypted) as Record<string, unknown>
  }
  // 只有开发环境允许把明文 body 当作报文解析（便于本地模拟回调）。
  // 生产环境必须抛错：否则任何人提交明文 body 即可伪造一笔"已支付"。
  if (isDevMode()) {
    try {
      return JSON.parse(ciphertext) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  throw new Error("微信支付未配置，无法解密回调报文")
}

// ─── 微信支付公钥模式 ──────────────────────────────────────────────────────────

/**
 * 微信支付「公钥模式」的应答头 Wechatpay-Serial 以它开头。
 *
 * 两种模式互斥、由商户平台侧决定，代码必须同时支持：
 *   - 平台证书模式（老）：serial 是十六进制平台证书序列号，需要
 *     GET /v3/certificates 下载平台证书（再用 APIv3 密钥解密）。
 *   - 公钥模式（新）：serial 是 PUB_KEY_ID_ 开头的公钥ID，**平台证书接口对这个
 *     商户直接 404**：
 *       {"code":"RESOURCE_NOT_EXISTS","message":"无可用的平台证书"}
 *     所以绝不能再去下载证书，必须用商户平台下载的微信支付公钥验签。
 *
 * 这就是线上「每笔回调都被 401 顶回去、履约只能靠前端 3 秒轮询」的根因。
 */
export const WECHATPAY_PUBLIC_KEY_ID_PREFIX = "PUB_KEY_ID_"

/** 报文时间戳允许的时钟偏移（秒）。微信官方建议 5 分钟。 */
export const WECHATPAY_TIMESTAMP_TOLERANCE_SECONDS = 300

function normalizePem(raw: string): string {
  // .env 里换行只能写成 \n（dotenv 只在双引号值里展开）；这里再兜一层，
  // 免得拿到 "-----BEGIN PUBLIC KEY-----\nMIIB..." 这种整行字符串。
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
}

let publicKeyCache: { source: string; pem: string } | null = null

/** 仅供测试：清空公钥缓存，避免用例之间互相污染。 */
export function resetWechatPayPublicKeyCache(): void {
  publicKeyCache = null
}

/**
 * 读取微信支付公钥。
 * 优先 WECHAT_PAY_PUBLIC_KEY（PEM / base64），否则读 WECHAT_PAY_PUBLIC_KEY_PATH。
 * 未配置返回 null，由调用方决定是拒绝还是继续——不在这里抛，方便上层给出可定位的日志。
 */
export function loadWechatPayPublicKey(): string | null {
  const cfg = getConfig()
  const source = cfg.publicKey || cfg.publicKeyPath
  if (!source) return null
  if (publicKeyCache && publicKeyCache.source === source) return publicKeyCache.pem

  let pem: string
  if (cfg.publicKey) {
    pem = normalizePem(cfg.publicKey)
  } else {
    // 生产把公钥放在仓库外的文件里：发布是 git pull --ff-only，仓库内文件虽然被
    // .gitignore 挡住，但放外面更不容易被误提交/误删。
    pem = normalizePem(readFileSync(cfg.publicKeyPath, "utf-8"))
  }
  if (!pem.includes("-----BEGIN")) {
    pem = Buffer.from(pem, "base64").toString("utf-8")
  }
  if (!pem.includes("-----BEGIN")) {
    throw new Error("微信支付公钥内容非法：既不是 PEM，也不是 base64 编码的 PEM")
  }
  publicKeyCache = { source, pem }
  return pem
}

function verifyWithPublicKeyMaterial(
  publicKey: string,
  message: string,
  signature: string,
): boolean {
  try {
    const verifier = createVerify("RSA-SHA256")
    verifier.update(message)
    return verifier.verify(publicKey, signature, "base64")
  } catch (err) {
    console.error("[WeChat Pay] 验签异常:", err)
    return false
  }
}

/**
 * 校验一条微信支付签名的公共实现——**应答与回调的报文格式完全一致**：
 *   message = timestamp + "\n" + nonce + "\n" + body + "\n"
 *
 * 两者共用同一份实现是有意的：公钥是否可用、报文格式是否正确，用任意一个真实
 * 请求就能验证（例如 GET /v3/pay/transactions/out-trade-no/...），不必等到真的
 * 有用户付款才能确认回调能不能验签。
 */
export async function verifyWechatPaySignature(params: {
  timestamp: string
  nonce: string
  body: string
  signature: string
  serialNo: string
}): Promise<boolean> {
  const { timestamp, nonce, body, signature, serialNo } = params

  if (!timestamp || !nonce || !signature || !serialNo) {
    console.error(
      `[WeChat Pay] 验签缺少必要字段：timestamp=${Boolean(timestamp)} nonce=${Boolean(nonce)} signature=${Boolean(signature)} serial=${Boolean(serialNo)}`
    )
    return false
  }

  // 时钟窗口：重放一份很久以前抓到的合法报文是唯一能绕过"验签"的攻击面。
  // 微信每次请求都会重新签名，5 分钟足够覆盖网络与重试。
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    console.error(`[WeChat Pay] 报文时间戳非法：${timestamp}`)
    return false
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts)
  if (skew > WECHATPAY_TIMESTAMP_TOLERANCE_SECONDS) {
    console.error(
      `[WeChat Pay] 报文时间戳超出 ${WECHATPAY_TIMESTAMP_TOLERANCE_SECONDS}s 窗口（相差 ${skew}s），拒绝`
    )
    return false
  }

  const message = `${timestamp}\n${nonce}\n${body}\n`

  if (serialNo.startsWith(WECHATPAY_PUBLIC_KEY_ID_PREFIX)) {
    // ── 公钥模式 ──
    const cfg = getConfig()
    let pem: string | null
    try {
      pem = loadWechatPayPublicKey()
    } catch (err) {
      console.error("[WeChat Pay] 读取微信支付公钥失败:", err)
      return false
    }
    if (!pem) {
      console.error(
        `[WeChat Pay] 报文来自公钥模式（serial=${serialNo}），但未配置微信支付公钥。` +
          `请设置 WECHAT_PAY_PUBLIC_KEY_ID 与 WECHAT_PAY_PUBLIC_KEY（或 WECHAT_PAY_PUBLIC_KEY_PATH），拒绝`
      )
      return false
    }
    // 公钥模式下微信只有一把公钥，serial 的作用是"该用公钥验签"而不是选钥匙。
    // 配了 ID 就顺手核对；不一致只告警不拒绝——真正的安全边界是下面的密码学
    // 验签，而密钥来自我们自己的环境变量，不匹配也伪造不出签名。
    if (cfg.publicKeyId && cfg.publicKeyId !== serialNo) {
      console.warn(
        `[WeChat Pay] 公钥ID 不一致：报文=${serialNo} 配置=${cfg.publicKeyId}（仍按配置的公钥验签）`
      )
    }
    return verifyWithPublicKeyMaterial(pem, message, signature)
  }

  // ── 平台证书模式 ──
  const certs = await getWechatPayCerts()
  const cert = certs.find((c) => c.serialNo === serialNo)
  if (!cert) {
    console.error(`[WeChat Pay] Certificate not found for serial: ${serialNo}`)
    return false
  }
  return verifyWithPublicKeyMaterial(cert.publicKey, message, signature)
}

/**
 * 校验回调 resource 里的 mchid / appid 是否属于本商户。
 *
 * 防御场景：同一套 APIv3 密钥或公钥对接了多个商户号、或用错了 appid 时，一笔
 * 属于别人的回调会被当成本商户的订单处理（out_trade_no 恰好撞车就会误开会员）。
 * 字段缺失时不拦（兼容历史报文），有值就必须一致。
 */
export function matchesWechatPayMerchant(resource: {
  mchid?: string
  appid?: string
}): { ok: boolean; reason?: string } {
  const cfg = getConfig()
  if (cfg.mchId && resource.mchid && resource.mchid !== cfg.mchId) {
    return { ok: false, reason: `mchid 不匹配（回调 ${resource.mchid} / 本商户 ${cfg.mchId}）` }
  }
  if (cfg.appId && resource.appid && resource.appid !== cfg.appId) {
    return { ok: false, reason: `appid 不匹配（回调 ${resource.appid} / 本应用 ${cfg.appId}）` }
  }
  return { ok: true }
}

export async function verifyNotifySignature(
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
  serialNo: string,
): Promise<boolean> {
  if (!isWeChatPayConfigured()) {
    // 仅开发环境放行。生产环境必须拒绝：否则 /api/payment/notify 无需任何
    // 签名即可被伪造，直接给任意账号开通会员。
    if (isDevMode()) return true
    console.error("[WeChat Pay] 支付参数未配置，拒绝回调通知")
    return false
  }

  try {
    return await verifyWechatPaySignature({ timestamp, nonce, body, signature, serialNo })
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
