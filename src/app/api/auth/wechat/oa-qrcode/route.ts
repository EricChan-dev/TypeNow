import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createOAQrCode, isWeChatOAConfigured } from "@/lib/wechat"

export async function GET(request: NextRequest) {
  const siteOrigin =
    process.env.SITE_URL?.replace(/\/$/, "") ??
    new URL(request.url).origin

  // Dev mode: return a mock QR code
  if (!isWeChatOAConfigured()) {
    const devScene = crypto.randomBytes(16).toString("hex")
    const response = NextResponse.json({
      devMode: true,
      scene: devScene,
      qrImageUrl: null,
      expiresIn: 30,
    })
    response.cookies.set("wechat_oa_scene", devScene, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    })
    return response
  }

  const scene = crypto.randomBytes(32).toString("hex")

  try {
    const qr = await createOAQrCode(scene, 30)
    // Also pass the ticket URL for direct <img> use
    const response = NextResponse.json({
      scene,
      qrImageUrl: qr.qrImageUrl,
      expiresIn: qr.expireSeconds,
    })

    response.cookies.set("wechat_oa_scene", scene, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    })

    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : "获取二维码失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
