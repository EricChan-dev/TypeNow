import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createOAQrCode, isWeChatOAConfigured, WechatApiError } from "@/lib/wechat"

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
    // 不要把内部的 err.message 直接回给客户端：微信接口的错误信息里可能带着
    // appid、access_token 片段或内部 URL。日志留全量，响应给通用文案。
    console.error("[wechat/oa-qrcode] 创建二维码失败:", err)

    // 少数错误是**运维配置问题、有明确修复动作**，给通用文案会让排障人无从下手。
    // 目前只区分 40164（出口 IP 不在公众号白名单）——它回一句「获取二维码失败」
    // 完全等于没说，而修法是确定的。其余一律保持通用文案，不泄漏内部细节。
    if (err instanceof WechatApiError && err.errcode === 40164) {
      return NextResponse.json(
        {
          error:
            "公众号二维码暂不可用：服务器出口 IP 不在公众平台白名单，请在公众号后台「设置与开发 → 基本配置 → IP 白名单」中添加后重试",
          code: "OA_IP_NOT_ALLOWED",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ error: "获取二维码失败，请稍后重试" }, { status: 500 })
  }
}
