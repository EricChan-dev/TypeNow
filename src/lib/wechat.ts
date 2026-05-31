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
