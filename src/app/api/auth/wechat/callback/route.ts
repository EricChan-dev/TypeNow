import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createSession } from "@/lib/auth/session"
import { getUserById, getUserByWechatUnionid } from "@/lib/auth/user"
import { encrypt } from "@/lib/crypto"
import {
  exchangeCodeForAccessToken,
  getUserInfo,
  checkUserSubscribe,
  type WechatUserInfo,
  type WechatTokenResponse,
  type WechatFlowType,
} from "@/lib/wechat"

function siteOrigin(request: NextRequest): string {
  const fromEnv = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL
  return fromEnv?.replace(/\/$/, "") ?? new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const errorParam = searchParams.get("error")

  const loginUrl = new URL("/login", siteOrigin(request))

  if (errorParam) {
    loginUrl.searchParams.set("error", "wechat_denied")
    return NextResponse.redirect(loginUrl)
  }

  if (!code || !state) {
    loginUrl.searchParams.set("error", "invalid_callback")
    return NextResponse.redirect(loginUrl)
  }

  // Dev mode: mock WeChat login or bind
  if (code === "dev_mock") {
    const isBind = state.startsWith("bind_") ||
      !!request.cookies.get("wechat_bind_intent")?.value
    if (isBind) return handleDevBind(request)
    return handleDevLogin(request)
  }

  // Determine flow: login vs bind
  const isBindFlow = state.startsWith("bind_") &&
    request.cookies.get("wechat_bind_intent")?.value

  // Determine OAuth platform from state prefix
  const effectiveState = state.replace(/^bind_/, "")
  const flowType: WechatFlowType = effectiveState.startsWith("oa_") ? "oa" : "open"

  // Verify CSRF state (login uses wechat_oauth_state, bind uses wechat_bind_state)
  const cookieName = isBindFlow ? "wechat_bind_state" : "wechat_oauth_state"
  const cookieState = request.cookies.get(cookieName)?.value
  if (!cookieState || cookieState !== state) {
    const errorKey = isBindFlow ? "bind_error" : "error"
    const errorVal = isBindFlow ? "csrf_mismatch" : "csrf_mismatch"
    const redirectUrl = isBindFlow
      ? new URL("/home/settings", siteOrigin(request))
      : loginUrl
    redirectUrl.searchParams.set(errorKey, errorVal)
    const res = NextResponse.redirect(redirectUrl)
    res.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" })
    res.cookies.set("wechat_bind_state", "", { maxAge: 0, path: "/" })
    res.cookies.set("wechat_bind_intent", "", { maxAge: 0, path: "/" })
    return res
  }

  try {
    const tokenData = await exchangeCodeForAccessToken(code, flowType)
    const userInfo = await getUserInfo(tokenData.access_token, tokenData.openid)

    if (isBindFlow) {
      return handleWechatBind(tokenData, userInfo, request)
    }

    // Check if user follows the Official Account (OA flow only, non-blocking)
    let isOAUserSubscribed = true
    if (flowType === "oa") {
      isOAUserSubscribed = await checkUserSubscribe(userInfo.openid)
    }

    const redirectRes = await upsertWeChatUser(tokenData, userInfo, request, isOAUserSubscribed)
    redirectRes.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" })
    return redirectRes
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败"
    if (isBindFlow) {
      const settingsUrl = new URL("/home/settings", siteOrigin(request))
      settingsUrl.searchParams.set("bind_error", message)
      const res = NextResponse.redirect(settingsUrl)
      res.cookies.set("wechat_bind_state", "", { maxAge: 0, path: "/" })
      res.cookies.set("wechat_bind_intent", "", { maxAge: 0, path: "/" })
      return res
    }

    const errorMap: Record<string, string> = {
      "微信授权码无效": "wechat_invalid_code",
      "微信授权码已被使用": "code_used",
      "微信授权码已过期": "code_expired",
      "微信服务连接失败": "network_error",
    }
    loginUrl.searchParams.set("error", errorMap[message] || "server_error")
    const res = NextResponse.redirect(loginUrl)
    res.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" })
    return res
  }
}

async function upsertWeChatUser(
  tokenData: WechatTokenResponse,
  wechatUser: WechatUserInfo,
  request: NextRequest,
  isSubscribed = true
): Promise<NextResponse> {
  const loginUrl = new URL("/login", siteOrigin(request))

  if (!db) {
    loginUrl.searchParams.set("error", "server_error")
    return NextResponse.redirect(loginUrl)
  }

  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000)

  // 1. Look up by wechatOpenid
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.wechatOpenid, wechatUser.openid))
    .limit(1)

  // 2. If not found by openid, try unionid for cross-platform association
  if (!user && wechatUser.unionid) {
    const [unionidUser] = await db
      .select()
      .from(users)
      .where(eq(users.wechatUnionid, wechatUser.unionid))
      .limit(1)
    user = unionidUser
  }

  let isNewUser = false

  if (user) {
    // Update existing user
    await db
      .update(users)
      .set({
        name: user.name ?? wechatUser.nickname,
        avatar: wechatUser.headimgurl || user.avatar,
        wechatOpenid: wechatUser.openid,
        wechatUnionid: wechatUser.unionid || null,
        wechatAccessToken: tokenData.access_token,
        wechatRefreshToken: encrypt(tokenData.refresh_token),
        wechatTokenExpiresAt: tokenExpiresAt,
      })
      .where(eq(users.id, user.id))
  } else {
    // Create new user
    isNewUser = true
    const refCode = request.cookies.get("ref_code")?.value
    let referredBy: string | null = null
    if (refCode) {
      const [partner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.inviteCode, refCode.toUpperCase()))
        .limit(1)
      referredBy = partner?.id ?? null
    }
    const id = randomUUID()
    const trialExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    await db.insert(users).values({
      id,
      wechatOpenid: wechatUser.openid,
      wechatUnionid: wechatUser.unionid || null,
      name: wechatUser.nickname || `微信用户${Math.floor(1000 + Math.random() * 9000)}`,
      avatar: wechatUser.headimgurl,
      referredBy,
      isPro: 1,
      proExpires: trialExpiresAt,
      wechatAccessToken: tokenData.access_token,
      wechatRefreshToken: tokenData.refresh_token,
      wechatTokenExpiresAt: tokenExpiresAt,
    })
    const [newUser] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    user = newUser

    if (referredBy) {
      const { awardInviteRegister } = await import("@/lib/auth/invite")
      await awardInviteRegister(referredBy, id).catch(() => null)
    }
  }

  await createSession(user.id)

  const homeUrl = new URL("/home", siteOrigin(request))
  homeUrl.searchParams.set("login_success", "wechat")
  if (isNewUser) {
    homeUrl.searchParams.set("new_user", "1")
  }
  if (!isSubscribed) {
    homeUrl.searchParams.set("follow_oa", "0")
  }
  return NextResponse.redirect(homeUrl)
}

async function handleWechatBind(
  tokenData: WechatTokenResponse,
  wechatUser: WechatUserInfo,
  request: NextRequest
): Promise<NextResponse> {
  const settingsUrl = new URL("/home/settings", siteOrigin(request))
  const clearCookies = (res: NextResponse) => {
    res.cookies.set("wechat_bind_state", "", { maxAge: 0, path: "/" })
    res.cookies.set("wechat_bind_intent", "", { maxAge: 0, path: "/" })
    return res
  }

  if (!db) {
    settingsUrl.searchParams.set("bind_error", "server_error")
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  const sessionCookie = request.cookies.get("typenow_session")?.value
  if (!sessionCookie) {
    settingsUrl.searchParams.set("bind_error", "not_logged_in")
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  // Get current user from session
  const { getSession } = await import("@/lib/auth/session")
  const session = await getSession()
  if (!session) {
    settingsUrl.searchParams.set("bind_error", "not_logged_in")
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  const currentUser = await getUserById(session.userId)
  if (!currentUser) {
    settingsUrl.searchParams.set("bind_error", "not_logged_in")
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  // Check if this openid is already bound to another user
  const [existingByOpenid] = await db
    .select()
    .from(users)
    .where(eq(users.wechatOpenid, wechatUser.openid))
    .limit(1)

  if (existingByOpenid && existingByOpenid.id !== session.userId) {
    settingsUrl.searchParams.set("bind_error", "wechat_already_bound")
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  // Check if current user already has a different WeChat bound
  if (currentUser.wechatOpenid && currentUser.wechatOpenid !== wechatUser.openid) {
    settingsUrl.searchParams.set("bind_error", "already_has_wechat")
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  // Bind WeChat to current user
  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000)
  await db
    .update(users)
    .set({
      wechatOpenid: wechatUser.openid,
      wechatUnionid: wechatUser.unionid || null,
      name: currentUser.name ?? wechatUser.nickname,
      avatar: wechatUser.headimgurl || currentUser.avatar,
      wechatAccessToken: tokenData.access_token,
      wechatRefreshToken: tokenData.refresh_token,
      wechatTokenExpiresAt: tokenExpiresAt,
    })
    .where(eq(users.id, session.userId))

  settingsUrl.searchParams.set("bind_success", "wechat")
  return clearCookies(NextResponse.redirect(settingsUrl))
}

async function handleDevLogin(request: NextRequest): Promise<NextResponse> {
  const homeUrl = new URL("/home", siteOrigin(request))

  if (!db) {
    // No DB at all — use cookie-only session
    const res = NextResponse.redirect(homeUrl)
    res.cookies.set("typenow_session", "dev:dev_wechat_user", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      path: "/",
    })
    return res
  }

  try {
    const devOpenid = "dev_wechat_user"
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.wechatOpenid, devOpenid))
      .limit(1)

    if (!user) {
      const id = randomUUID()
      await db.insert(users).values({ id, wechatOpenid: devOpenid, name: "微信开发用户" })
      const [newUser] = await db.select().from(users).where(eq(users.id, id)).limit(1)
      user = newUser
    }

    await createSession(user.id)
    return NextResponse.redirect(homeUrl)
  } catch {
    // DB connection failed — use cookie-only session
    const res = NextResponse.redirect(homeUrl)
    res.cookies.set("typenow_session", "dev:dev_wechat_user", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      path: "/",
    })
    return res
  }
}

async function handleDevBind(request: NextRequest): Promise<NextResponse> {
  const settingsUrl = new URL("/home/settings", siteOrigin(request))

  if (!db) {
    settingsUrl.searchParams.set("bind_error", "server_error")
    return clearBindCookies(NextResponse.redirect(settingsUrl))
  }

  const { getSession } = await import("@/lib/auth/session")
  const session = await getSession()
  if (!session) {
    settingsUrl.searchParams.set("bind_error", "not_logged_in")
    return clearBindCookies(NextResponse.redirect(settingsUrl))
  }

  await db
    .update(users)
    .set({ wechatOpenid: "dev_wechat_user", wechatUnionid: "dev_wechat_unionid" })
    .where(eq(users.id, session.userId))

  settingsUrl.searchParams.set("bind_success", "wechat")
  return clearBindCookies(NextResponse.redirect(settingsUrl))
}

function clearBindCookies(res: NextResponse): NextResponse {
  res.cookies.set("wechat_bind_state", "", { maxAge: 0, path: "/" })
  res.cookies.set("wechat_bind_intent", "", { maxAge: 0, path: "/" })
  return res
}
