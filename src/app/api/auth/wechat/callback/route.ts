import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/service"
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

  // Handle WeChat user denying authorization
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
    return await handleDevLogin(request)
  }

  // Verify CSRF state token
  const cookieState = request.cookies.get("wechat_oauth_state")?.value

  if (!cookieState || cookieState !== state) {
    loginUrl.searchParams.set("error", "csrf_mismatch")
    const response = NextResponse.redirect(loginUrl)
    response.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" })
    return response
  }

  try {
    // Exchange code for access token
    const tokenData = await exchangeCodeForAccessToken(code)

    // Get user info
    const userInfo = await getUserInfo(tokenData.access_token, tokenData.openid)

    // Create session
    const redirectResponse = await createWeChatSession(userInfo, request)

    // Clear the state cookie
    redirectResponse.cookies.set("wechat_oauth_state", "", {
      maxAge: 0,
      path: "/",
    })

    return redirectResponse
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败"

    const errorMap: Record<string, string> = {
      "微信授权码无效": "wechat_invalid_code",
      "微信授权码已被使用": "code_used",
      "微信授权码已过期": "code_expired",
      "微信服务连接失败": "network_error",
    }

    loginUrl.searchParams.set(
      "error",
      errorMap[message] || "server_error"
    )
    const response = NextResponse.redirect(loginUrl)
    response.cookies.set("wechat_oauth_state", "", { maxAge: 0, path: "/" })
    return response
  }
}

async function createWeChatSession(
  wechatUser: WechatUserInfo,
  request: NextRequest
): Promise<NextResponse> {
  const supabaseAdmin = createServiceClient()
  if (!supabaseAdmin) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("error", "server_error")
    return NextResponse.redirect(loginUrl)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const email = `wechat_${wechatUser.openid}@typenow.local`
  const password = crypto.randomUUID()

  // Look up by wechat_openid
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, wechat_openid")
    .eq("wechat_openid", wechatUser.openid)
    .maybeSingle()

  if (profile) {
    // Existing WeChat user: update password, refresh avatar/name
    await supabaseAdmin.auth.admin.updateUserById(profile.id, { password })
    await supabaseAdmin
      .from("profiles")
      .update({
        name: wechatUser.nickname,
        avatar: wechatUser.headimgurl,
        wechat_unionid: wechatUser.unionid || null,
      })
      .eq("id", profile.id)
  } else {
    // New WeChat user
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: wechatUser.nickname,
        avatar: wechatUser.headimgurl,
        wechat_openid: wechatUser.openid,
        wechat_unionid: wechatUser.unionid || null,
      },
    })

    if (createError && createError.code !== "duplicate") {
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("error", "server_error")
      return NextResponse.redirect(loginUrl)
    }
  }

  // Sign in to create session
  const cookieStore = await cookies()
  const supabaseSsr = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        )
      },
    },
  })

  const { error: authError } = await supabaseSsr.auth.signInWithPassword({
    email,
    password,
  })

  if (authError) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("error", "signin_failed")
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.redirect(new URL("/home", request.url))
}

async function handleDevLogin(request: NextRequest): Promise<NextResponse> {
  const supabaseAdmin = createServiceClient()

  if (!supabaseAdmin) {
    const homeUrl = new URL("/home", request.url)
    return NextResponse.redirect(homeUrl)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const devOpenid = "dev_wechat_user"
  const email = `wechat_${devOpenid}@typenow.local`
  const password = crypto.randomUUID()

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("wechat_openid", devOpenid)
    .maybeSingle()

  if (profile) {
    await supabaseAdmin.auth.admin.updateUserById(profile.id, { password })
  } else {
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: "微信开发用户",
        avatar: "",
        wechat_openid: devOpenid,
      },
    })
  }

  const cookieStore = await cookies()
  const supabaseSsr = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        )
      },
    },
  })

  await supabaseSsr.auth.signInWithPassword({ email, password })

  return NextResponse.redirect(new URL("/home", request.url))
}
