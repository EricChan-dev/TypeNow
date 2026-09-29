import crypto from "crypto"

export type WechatFlowType = "open" | "oa"

export interface WechatTokenResponse {
  access_token: string
  expires_in: number
  refresh_token: string
  openid: string
  scope: string
  unionid?: string
}

export interface WechatUserInfo {
  openid: string
  nickname: string
  sex: number
  province: string
  city: string
  country: string
  headimgurl: string
  privilege: string[]
  unionid?: string
}

export function isWeChatConfigured(): boolean {
  return !!(
    process.env.WECHAT_APP_ID?.startsWith("wx") &&
    process.env.WECHAT_APP_SECRET &&
    process.env.NEXT_PUBLIC_WECHAT_REDIRECT_URI
  )
}

export function isWeChatOAConfigured(): boolean {
  return !!(
    process.env.WECHAT_OA_APP_ID?.startsWith("wx") &&
    process.env.WECHAT_OA_APP_SECRET
  )
}

export function generateOAuthUrl(
  redirectUri: string,
  options?: { forBind?: boolean; flow?: WechatFlowType }
): { url: string; state: string } {
  const flow = options?.flow ?? "open"
  const isOA = flow === "oa"

  const appId = isOA ? process.env.WECHAT_OA_APP_ID! : process.env.WECHAT_APP_ID!
  const raw = crypto.randomBytes(32).toString("hex")

  let state: string
  if (options?.forBind && isOA) state = `bind_oa_${raw}`
  else if (options?.forBind) state = `bind_${raw}`
  else if (isOA) state = `oa_${raw}`
  else state = raw

  const params = new URLSearchParams({
    appid: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: isOA ? "snsapi_userinfo" : "snsapi_login",
    state,
  })

  const baseUrl = isOA
    ? "https://open.weixin.qq.com/connect/oauth2/authorize"
    : "https://open.weixin.qq.com/connect/qrconnect"

  const url = `${baseUrl}?${params.toString()}#wechat_redirect`

  return { url, state }
}

type WechatErrorResponse = {
  errcode: number
  errmsg: string
}

function isWechatError(
  data: unknown
): data is WechatErrorResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "errcode" in data &&
    (data as WechatErrorResponse).errcode !== 0
  )
}

export async function exchangeCodeForAccessToken(
  code: string,
  flowType?: WechatFlowType
): Promise<WechatTokenResponse> {
  const isOA = flowType === "oa"
  const appId = isOA ? process.env.WECHAT_OA_APP_ID! : process.env.WECHAT_APP_ID!
  const appSecret = isOA ? process.env.WECHAT_OA_APP_SECRET! : process.env.WECHAT_APP_SECRET!

  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    code,
    grant_type: "authorization_code",
  })

  const res = await fetch(
    `https://api.weixin.qq.com/sns/oauth2/access_token?${params.toString()}`
  )

  if (!res.ok) {
    throw new Error("微信服务连接失败")
  }

  const data = await res.json()

  if (isWechatError(data)) {
    const messages: Record<number, string> = {
      40029: "微信授权码无效",
      40163: "微信授权码已被使用",
      42003: "微信授权码已过期",
    }
    const message = messages[data.errcode] || `微信服务错误 (${data.errcode})`
    throw new Error(message)
  }

  return data as WechatTokenResponse
}

export async function getUserInfo(
  accessToken: string,
  openid: string
): Promise<WechatUserInfo> {
  const params = new URLSearchParams({
    access_token: accessToken,
    openid,
    lang: "zh_CN",
  })

  const res = await fetch(
    `https://api.weixin.qq.com/sns/userinfo?${params.toString()}`
  )

  if (!res.ok) {
    throw new Error("微信服务连接失败")
  }

  const data = await res.json()

  if (isWechatError(data)) {
    throw new Error("获取微信用户信息失败")
  }

  const userInfo = data as WechatUserInfo

  // Upgrade avatar URL to HTTPS
  if (userInfo.headimgurl?.startsWith("http://")) {
    userInfo.headimgurl = userInfo.headimgurl.replace("http://", "https://")
  }

  return userInfo
}

export async function refreshWeChatToken(
  refreshToken: string
): Promise<WechatTokenResponse> {
  const appId = process.env.WECHAT_APP_ID!

  const params = new URLSearchParams({
    appid: appId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })

  const res = await fetch(
    `https://api.weixin.qq.com/sns/oauth2/refresh_token?${params.toString()}`
  )

  if (!res.ok) {
    throw new Error("微信服务连接失败")
  }

  const data = await res.json()

  if (isWechatError(data)) {
    const messages: Record<number, string> = {
      40030: "refresh_token无效",
      42003: "refresh_token已过期",
    }
    const message = messages[data.errcode] || `微信刷新 token 失败 (${data.errcode})`
    throw new Error(message)
  }

  return data as WechatTokenResponse
}

// ─── Official Account global access_token (cached) ────────────────────────────

let cachedOAToken: { token: string; expiresAt: number } | null = null

export async function getOAGlobalAccessToken(): Promise<string> {
  if (cachedOAToken && Date.now() < cachedOAToken.expiresAt - 300_000) {
    return cachedOAToken.token
  }

  const appId = process.env.WECHAT_OA_APP_ID!
  const appSecret = process.env.WECHAT_OA_APP_SECRET!

  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
  )

  if (!res.ok) {
    throw new Error("微信服务连接失败")
  }

  const data = await res.json()

  if (isWechatError(data)) {
    throw new Error(`获取 access_token 失败: ${data.errmsg}`)
  }

  cachedOAToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  }

  return cachedOAToken.token
}

export async function checkUserSubscribe(openid: string): Promise<boolean> {
  try {
    const token = await getOAGlobalAccessToken()
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/user/info?access_token=${token}&openid=${openid}&lang=zh_CN`
    )

    if (!res.ok) return false

    const data = await res.json()

    if (isWechatError(data)) return false

    return (data as Record<string, unknown>).subscribe === 1
  } catch {
    return false
  }
}

// ─── OA user info (full profile from /cgi-bin/user/info) ──────────────────────

export interface OAUserInfo {
  subscribe: number
  openid: string
  nickname?: string
  sex?: number
  language?: string
  city?: string
  province?: string
  country?: string
  headimgurl?: string
  subscribe_time?: number
  unionid?: string
  subscribe_scene?: string
  qr_scene_str?: string
}

export async function getOAUserInfo(openid: string): Promise<OAUserInfo | null> {
  try {
    const token = await getOAGlobalAccessToken()
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/user/info?access_token=${token}&openid=${openid}&lang=zh_CN`
    )

    if (!res.ok) return null

    const data = await res.json()

    if (isWechatError(data)) return null

    const info = data as OAUserInfo

    // Upgrade avatar URL to HTTPS
    if (info.headimgurl?.startsWith("http://")) {
      info.headimgurl = info.headimgurl.replace("http://", "https://")
    }

    return info
  } catch {
    return null
  }
}

// ─── OA customer service message (主动客服消息) ────────────────────────────────

export async function sendOACustomerMessage(
  openid: string,
  content: string
): Promise<boolean> {
  try {
    const token = await getOAGlobalAccessToken()
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          touser: openid,
          msgtype: "text",
          text: { content },
        }),
      }
    )

    if (!res.ok) return false

    const data = await res.json()
    if (isWechatError(data)) {
      console.error("[WeChat] sendOACustomerMessage failed:", data)
      return false
    }

    return true
  } catch (err) {
    console.error("[WeChat] sendOACustomerMessage error:", err)
    return false
  }
}

// ─── OA template message (模板消息) ───────────────────────────────────────────

/**
 * 主动触达的发送结果。
 *
 * 刻意区分 `not_configured` 与其他失败：模板 ID 还没申请下来（§11.6 第 2 条，
 * 微信侧要审 1–3 天）是**预期内**的状态，调用方应当记 `skipped` 而不是 `failed`，
 * 否则扫描路由每天会把同一个"失败"重试两遍，日志里全是噪声，
 * 真正的失败反而看不见。
 */
export type OASendOutcome =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "failed"; error: string }

/**
 * 发送公众号模板消息。
 *
 * 与客服消息（sendOACustomerMessage）的关键差别在**时效窗口**：
 *   · 客服消息：只有用户 48 小时内与公众号有交互才能发
 *   · 模板消息：**没有窗口限制**，已关注公众号即可发 —— 这是"到期提醒"的主力渠道
 *
 * ⚠️ **只能发服务通知，不能承载营销内容**（微信《运营规范》）。
 * 文案由 lib/lifecycle-scenarios.ts 统一生成，那里有一条单测专门守营销词。
 * 违规会被驳回，严重时处罚账号接口权限 —— 那整套触达体系就没了。
 *
 * @param templateId 公众号后台申请的模板 ID
 * @param url        点击模板消息跳转的地址（转化落在这个页面里，不放在消息里）
 */
export async function sendOATemplateMessage(
  openid: string,
  templateId: string,
  data: Record<string, string>,
  url?: string
): Promise<OASendOutcome> {
  if (!templateId) {
    return { ok: false, reason: "not_configured", error: "模板 ID 未配置" }
  }
  if (!isWeChatOAConfigured()) {
    return { ok: false, reason: "not_configured", error: "公众号未配置" }
  }

  try {
    const token = await getOAGlobalAccessToken()
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          touser: openid,
          template_id: templateId,
          ...(url ? { url } : {}),
          // 微信要求每个字段形如 { value: "..." }，颜色可选（这里统一用默认色，
          // 不为了好看去指定颜色 —— 模板消息的观感由平台模板决定）
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, { value: v }])
          ),
        }),
      }
    )

    if (!res.ok) {
      return { ok: false, reason: "failed", error: `HTTP ${res.status}` }
    }

    const payload = await res.json()
    if (isWechatError(payload)) {
      // 常见错误码：
      //   40037 模板 ID 无效 → 配置错了，属于 not_configured 而非可重试的失败
      //   43004 用户未关注公众号 → 预期内，不该重试
      const errcode = (payload as WechatErrorResponse).errcode
      const errmsg = (payload as WechatErrorResponse).errmsg
      const notConfigured = errcode === 40037
      console.error("[WeChat] sendOATemplateMessage failed:", errcode, errmsg)
      return {
        ok: false,
        reason: notConfigured ? "not_configured" : "failed",
        error: `${errcode}: ${errmsg}`,
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

// ─── OA temporary QR code with scene ───────────────────────────────────────────

interface OACreateQrCodeResponse {
  ticket: string
  expire_seconds: number
  url: string
}

export async function createOAQrCode(
  sceneStr: string,
  expireSeconds = 30
): Promise<{ ticket: string; expireSeconds: number; qrImageUrl: string }> {
  const token = await getOAGlobalAccessToken()

  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expire_seconds: expireSeconds,
        action_name: "QR_STR_SCENE",
        action_info: { scene: { scene_str: sceneStr } },
      }),
    }
  )

  if (!res.ok) {
    throw new Error("创建二维码失败")
  }

  const data = await res.json()

  if (isWechatError(data)) {
    const messages: Record<number, string> = {
      40001: "access_token 无效",
      40013: "appid 无效",
      40125: "scene_str 不合法",
      40164: "IP 不在白名单中",
    }
    const message = messages[data.errcode] || `创建二维码失败 (${data.errcode})`
    throw new Error(message)
  }

  const result = data as OACreateQrCodeResponse
  const qrImageUrl = `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(result.ticket)}`

  return {
    ticket: result.ticket,
    expireSeconds: result.expire_seconds,
    qrImageUrl,
  }
}

// ─── In-memory scene → login mapping (for OA QR code polling) ──────────────────

interface SceneData {
  openid: string
  unionid?: string
  nickname?: string
  avatar?: string
  createdAt: number
}

const sceneStore = new Map<string, SceneData>()

// NOTE: sceneStore is in-memory — server restart or multi-instance deployment will
// lose pending login scenes. Replace with Redis if scaling horizontally.
// Clean expired scenes every 5 minutes
const SCENE_TTL_MS = 120_000 // 2 min — longer than QR expiry to allow network delays
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of sceneStore) {
    if (now - val.createdAt > SCENE_TTL_MS) {
      sceneStore.delete(key)
    }
  }
}, 300_000)

export function storeSceneLogin(scene: string, data: SceneData): void {
  sceneStore.set(scene, data)
}

export function getSceneLogin(scene: string): SceneData | null {
  const data = sceneStore.get(scene)
  if (!data) return null
  if (Date.now() - data.createdAt > SCENE_TTL_MS) {
    sceneStore.delete(scene)
    return null
  }
  return data
}

// ─── WeChat OA message encryption helpers ──────────────────────────────────────

function pkcs7Pad(buf: Buffer, blockSize = 32): Buffer {
  const padLen = blockSize - (buf.length % blockSize)
  const pad = Buffer.alloc(padLen, padLen)
  return Buffer.concat([buf, pad])
}

function pkcs7Unpad(buf: Buffer): Buffer {
  const padLen = buf[buf.length - 1]
  if (padLen < 1 || padLen > 32) return buf
  return buf.subarray(0, buf.length - padLen)
}

/**
 * Decrypt a WeChat OA event push message.
 * Returns the decrypted XML string and the appId embedded in the ciphertext.
 */
export function decryptOAMessage(
  encrypted: string,
  encodingAESKey: string,
): { xml: string; appId: string } {
  // Decode AES key (43-char base64 → 32-byte key)
  const aesKey = Buffer.from(encodingAESKey + "=", "base64")

  const ciphertext = Buffer.from(encrypted, "base64")
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16))
  decipher.setAutoPadding(false)

  const decrypted = pkcs7Unpad(
    Buffer.concat([decipher.update(ciphertext), decipher.final()])
  )

  // Format: random(16) + msg_len(4) + content + appId
  const contentLen = decrypted.readUInt32BE(16)
  const content = decrypted.subarray(20, 20 + contentLen).toString("utf-8")
  const appId = decrypted.subarray(20 + contentLen).toString("utf-8")

  return { xml: content, appId }
}

/**
 * Verify the message signature from WeChat server.
 */
export function verifyOASignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
  signature: string,
): boolean {
  const sorted = [token, timestamp, nonce, encrypted].sort().join("")
  const hash = crypto.createHash("sha1").update(sorted).digest("hex")
  return hash === signature
}
