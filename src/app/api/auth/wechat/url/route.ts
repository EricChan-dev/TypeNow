import { NextResponse } from "next/server"
import { generateOAuthUrl, isWeChatConfigured } from "@/lib/wechat"

export async function GET() {
  if (!isWeChatConfigured()) {
    return NextResponse.json({ devMode: true })
  }

  const redirectUri = process.env.NEXT_PUBLIC_WECHAT_REDIRECT_URI
  if (!redirectUri) {
    return NextResponse.json(
      { error: "微信回调地址未配置" },
      { status: 500 }
    )
  }

  const { url, state } = generateOAuthUrl(redirectUri)

  const response = NextResponse.json({ url })

  response.cookies.set("wechat_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  })

  return response
}
