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
