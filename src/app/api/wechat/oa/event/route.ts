import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import {
  verifyOASignature,
  decryptOAMessage,
  getOAUserInfo,
  storeSceneLogin,
  sendOACustomerMessage,
} from "@/lib/wechat"
import { generateInviteCode } from "@/lib/subscription"
import { trialGrantFields } from "@/lib/trial"
import { INVITE_REGISTER_DAYS } from "@/lib/invite-rules"

async function resolveReferredBy(refCode: string | null): Promise<string | null> {
  if (!refCode || !db) return null
  const code = refCode.toUpperCase()
  const [partner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.inviteCode, code))
    .limit(1)
  return partner?.id ?? null
}

/**
 * 从二维码 scene 里取出邀请码。
 *
 * scene 的格式是 oa-qrcode 生成的 `<48位随机hex>_<邀请码>`；随机部分既用于
 * 扫码登录的一次性令牌，也用于防猜测，所以邀请码只能放在后缀里。
 * 没有下划线时说明这次扫码没有邀请码，按自然流量处理。
 */
function extractRefCode(sceneStr: string): string | null {
  const sep = sceneStr.lastIndexOf("_")
  if (sep < 0) return null
  const candidate = sceneStr.slice(sep + 1).toUpperCase()
  return /^[A-Z0-9]{4,12}$/.test(candidate) ? candidate : null
}

function getOAConfig() {
  return {
    token: process.env.WECHAT_OA_TOKEN,
    encodingAESKey: process.env.WECHAT_OA_ENCODING_AES_KEY,
    appId: process.env.WECHAT_OA_APP_ID,
  }
}

/**
 * Parse simple WeChat XML event body.
 * Extracts fields like ToUserName, FromUserName, Event, EventKey.
 * WeChat wraps values in <![CDATA[...]]>, but also supports plain text.
 */
function parseWechatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {}
  const tagRegex = /<(\w+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(xml)) !== null) {
    result[match[1]] = match[2]
  }
  // Also match plain text tags (no CDATA)
  const plainRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
  while ((match = plainRegex.exec(xml)) !== null) {
    if (!(match[1] in result)) {
      result[match[1]] = match[2]
    }
  }
  // Remove leading/trailing whitespace from xml
  return result
}

/**
 * GET — WeChat server URL verification.
 * WeChat sends: signature, timestamp, nonce, echostr.
 * We verify the signature and return echostr if valid.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const signature = searchParams.get("signature") || ""
  const timestamp = searchParams.get("timestamp") || ""
  const nonce = searchParams.get("nonce") || ""
  const echostr = searchParams.get("echostr") || ""

  const config = getOAConfig()
  if (!config.token) {
    return new NextResponse("OA TOKEN not configured", { status: 500 })
  }

  // Verify: sort [token, timestamp, nonce], SHA1, compare
  const crypto = await import("crypto")
  const sorted = [config.token, timestamp, nonce].sort().join("")
  const hash = crypto.createHash("sha1").update(sorted).digest("hex")

  if (hash !== signature) {
    return new NextResponse("Invalid signature", { status: 403 })
  }

  return new NextResponse(echostr)
}

/**
 * POST — Receive WeChat event push (subscribe, scan, etc.).
 * Body is encrypted XML. We decrypt, parse, and process.
 */
export async function POST(request: NextRequest) {
  const config = getOAConfig()

  // Require encryption config
  if (!config.token || !config.encodingAESKey || !config.appId) {
    console.error("[OA Event] Missing WECHAT_OA_TOKEN/ENCODING_AES_KEY/APP_ID")
    return new NextResponse("success") // Don't let WeChat retry indefinitely
  }

  const searchParams = request.nextUrl.searchParams
  const msgSignature = searchParams.get("msg_signature") || ""
  const timestamp = searchParams.get("timestamp") || ""
  const nonce = searchParams.get("nonce") || ""

  // Read raw XML body
  let body: string
  try {
    body = await request.text()
  } catch {
    console.error("[OA Event] Failed to read request body")
    return new NextResponse("success")
  }

  // Extract <Encrypt> value (with or without CDATA)
  const encMatch =
    /<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/.exec(body) ??
    /<Encrypt>(.*?)<\/Encrypt>/.exec(body)
  if (!encMatch) {
    console.error("[OA Event] No <Encrypt> in body:", body.slice(0, 200))
    return new NextResponse("success")
  }

  const encrypted = encMatch[1]

  // Verify signature
  if (
    !verifyOASignature(config.token, timestamp, nonce, encrypted, msgSignature)
  ) {
    console.error("[OA Event] Signature verification failed")
    return new NextResponse("success")
  }

  // Decrypt
  let xml: string
  try {
    const decrypted = decryptOAMessage(encrypted, config.encodingAESKey)
    xml = decrypted.xml
  } catch (err) {
    console.error("[OA Event] Decryption failed:", err)
    return new NextResponse("success")
  }

  // Parse event
  const event = parseWechatXml(xml)
  console.log("[OA Event] Received event:", event.Event, "from:", event.FromUserName)

  await handleEvent(event)
  return new NextResponse("success")
}

async function handleEvent(event: Record<string, string>): Promise<void> {
  const openid = event.FromUserName
  const eventType = event.Event
  const eventKey = event.EventKey || ""

  if (!openid) {
    console.warn("[OA Event] Event without FromUserName")
    return
  }

  // Handle subscribe event (with or without scene)
  if (eventType === "subscribe") {
    // Extract scene_str from EventKey: "qrscene_<scene_str>"
    const sceneStr = eventKey.startsWith("qrscene_")
      ? eventKey.slice("qrscene_".length)
      : null

    if (sceneStr) {
      console.log("[OA Event] Subscribe with scene:", sceneStr)
      await processSceneLogin(openid, sceneStr)
    } else {
      console.log("[OA Event] Subscribe without scene")
      // Still send a welcome message for direct follows
      await sendOACustomerMessage(openid, "感谢关注 TypeNow · 码上英语！\n\n🔤 AI 驱动中译英打字练习\n📚 丰富课程 + 智能复习\n🎯 碎片时间，轻松提升\n\n👉 <a href=\"https://typenow.cn/login\">点击登录开始学习</a>")
    }
  }

  // Handle SCAN event (user already subscribed, scans QR code)
  if (eventType === "SCAN" && eventKey) {
    console.log("[OA Event] SCAN with scene:", eventKey)
    await processSceneLogin(openid, eventKey)
  }
}

async function processSceneLogin(openid: string, sceneStr: string): Promise<void> {
  try {
    // Get user info from WeChat OA
    const oaUser = await getOAUserInfo(openid)
    if (!oaUser || oaUser.subscribe !== 1) {
      console.warn("[OA Event] User not found or not subscribed:", openid)
      return
    }

    if (!db) {
      storeSceneLogin(sceneStr, {
        openid,
        unionid: oaUser.unionid,
        nickname: oaUser.nickname,
        avatar: oaUser.headimgurl,
        createdAt: Date.now(),
      })
      return
    }

    // Look up existing user by openid or unionid
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.wechatOpenid, openid))
      .limit(1)

    if (!user && oaUser.unionid) {
      const [unionidUser] = await db
        .select()
        .from(users)
        .where(eq(users.wechatUnionid, oaUser.unionid))
        .limit(1)
      user = unionidUser
    }

    if (user) {
      // Update existing user's WeChat info
      await db
        .update(users)
        .set({
          name: user.name ?? oaUser.nickname,
          avatar: oaUser.headimgurl || user.avatar,
          wechatOpenid: openid,
          wechatUnionid: oaUser.unionid || null,
        })
        .where(eq(users.id, user.id))

      storeSceneLogin(sceneStr, {
        openid,
        unionid: oaUser.unionid,
        nickname: oaUser.nickname,
        avatar: oaUser.headimgurl,
        createdAt: Date.now(),
      })

      // Send message: returning user
      const name = user.name || oaUser.nickname || "同学"
      await sendOACustomerMessage(openid, `👋 欢迎回来，${name}！\n\n已成功登录 TypeNow，继续你的英语学习之旅吧～`)
    } else {
      // Create new user
      const id = randomUUID()
      const referredBy = await resolveReferredBy(extractRefCode(sceneStr))

      await db.insert(users).values({
        id,
        wechatOpenid: openid,
        wechatUnionid: oaUser.unionid || null,
        name: oaUser.nickname || `微信用户${Math.floor(1000 + Math.random() * 9000)}`,
        avatar: oaUser.headimgurl,
        referredBy,
        inviteCode: generateInviteCode(),
        // 未受邀不送会员，由 /api/trial/claim 主动领取；受邀注册即自动领取。
        // 见 db/migrations/00012_trial_claim.sql
        ...(referredBy ? trialGrantFields(new Date(), INVITE_REGISTER_DAYS) : {}),
      })

      if (referredBy) {
        const { awardInviteRegister } = await import("@/lib/auth/invite")
        await awardInviteRegister(referredBy, id).catch(() => null)
      }

      storeSceneLogin(sceneStr, {
        openid,
        unionid: oaUser.unionid,
        nickname: oaUser.nickname,
        avatar: oaUser.headimgurl,
        createdAt: Date.now(),
      })

      // Send message: new user
      const name = oaUser.nickname || "同学"
      await sendOACustomerMessage(openid, `🎉 ${name}，欢迎关注 TypeNow · 码上英语！\n\n🔤 AI 驱动中译英打字练习\n📚 丰富课程 + 智能复习\n🎯 碎片时间，轻松提升\n\n已自动登录，快去网站开始学习吧！`)
    }
  } catch (err) {
    console.error("[OA Event] processSceneLogin error:", err)
  }
}
