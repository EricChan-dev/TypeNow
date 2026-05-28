import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createSession } from "@/lib/auth/session"
import {
  exchangeCodeForAccessToken,
  getUserInfo,
  isWeChatConfigured,
  type WechatUserInfo,
} from "@/lib/wechat"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const errorParam = searchParams.get("error")

  const loginUrl = new URL("/login", request.url)

  if (errorParam) {
    loginUrl.searchParams.set("error", "wechat_denied")
    return NextResponse.redirect(loginUrl)
  }

  if (!code || !state) {
    loginUrl.searchParams.set("error", "invalid_callback")
    return NextResponse.redirect(loginUrl)
  }

  // Dev mode: mock WeChat login
  if (code === "dev_mock" && !isWeChatConfigured()) {
    return handleDevLogin(request)
  }

  // Verify CSRF state
  const cookieState = request.cookies.get("wechat_oauth_state")?.value
  if (!cookieState || cookieState !== state) {
    loginUrl.searchParams.set("error", "csrf_mismatch")
    const res = NextResponse.redirect(loginUrl)
    res.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" })
    return res
  }

  try {
    const tokenData = await exchangeCodeForAccessToken(code)
    const userInfo = await getUserInfo(tokenData.access_token, tokenData.openid)
    const redirectRes = await upsertWeChatUser(userInfo, request)
    redirectRes.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" })
    return redirectRes
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败"
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
  wechatUser: WechatUserInfo,
  request: NextRequest
): Promise<NextResponse> {
  const loginUrl = new URL("/login", request.url)

  if (!db) {
    loginUrl.searchParams.set("error", "server_error")
    return NextResponse.redirect(loginUrl)
  }

  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.wechatOpenid, wechatUser.openid))
    .limit(1)

  if (user) {
    await db
      .update(users)
      .set({
        name: wechatUser.nickname,
        avatar: wechatUser.headimgurl,
        wechatUnionid: wechatUser.unionid || null,
      })
      .where(eq(users.id, user.id))
  } else {
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
    })
    const [newUser] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    user = newUser
  }

  await createSession(user.id)
  return NextResponse.redirect(new URL("/home", request.url))
}

async function handleDevLogin(request: NextRequest): Promise<NextResponse> {
  if (!db) return NextResponse.redirect(new URL("/home", request.url))

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
  return NextResponse.redirect(new URL("/home", request.url))
}
