import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createOAQrCode, isWeChatOAConfigured } from "@/lib/wechat"

/**
 * 把邀请码编进二维码 scene。
 *
 * scene_str 上限 64 字符，并且它同时充当「扫码登录」的一次性令牌，随机部分必须
 * 保持足够长。这里用 24 字节（48 hex）+ "_" + 邀请码（≤12）≤ 61 字符。
 *
 * 背景：此前 scene 是纯随机 32 字节，而 oa/event 又拿这个随机串去 users.invite_code
 * 里找邀请人 —— 永远查不到，公众号渠道注册的新用户完全没有归属，邀请人拿不到
 * 任何奖励与佣金。
 */
function buildScene(refCode: string): string {
  const randomPart = crypto.randomBytes(24).toString("hex")
  return refCode ? `${randomPart}_${refCode}` : randomPart
}

export async function GET(request: NextRequest) {
  // 邀请码来源与手机号注册一致：/ref/[code] 页面落下的 ref_code cookie。
  const rawRef = (request.cookies.get("ref_code")?.value ?? "").trim().toUpperCase()
  const refCode = /^[A-Z0-9]{4,12}$/.test(rawRef) ? rawRef : ""

  // Dev mode: return a mock QR code
  if (!isWeChatOAConfigured()) {
    const devScene = buildScene(refCode)
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

  const scene = buildScene(refCode)

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
