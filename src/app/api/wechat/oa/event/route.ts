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
import { maskId } from "@/lib/log-redact"
import { generateInviteCode } from "@/lib/subscription"
import { signupFields } from "@/lib/signup-source"
import { recordServerEvent } from "@/lib/analytics-server"
import { trialGrantFields } from "@/lib/trial"
import { INVITE_REGISTER_DAYS } from "@/lib/invite-rules"
import { optInNotifications, optOutNotifications } from "@/lib/notify"

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
  console.log("[OA Event] Received event:", event.Event, "from:", maskId(event.FromUserName))

  await handleEvent(event)
  return new NextResponse("success")
}

/**
 * 退订指令的精确匹配表。
 *
 * 刻意用**精确匹配**而不是 includes：中文里「不想退订」「怎么退订」都含「退订」，
 * 用 includes 会把它们误判成退订请求 —— 那是把用户的选择权搞反，比不实现更糟。
 * 所以只认短指令，并容忍首尾空白与标点。
 */
const OPT_OUT_COMMANDS = ["退订", "退订通知", "取消订阅", "不再接收", "td", "TD", "T"]
const OPT_IN_COMMANDS = ["订阅", "开启通知", "恢复通知", "接收通知"]

/** 归一化：去掉空白与首尾标点，再小写英文比较。 */
function normalizeCommand(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/^[，。！？、,.!?]+|[，。！？、,.!?]+$/g, "")
}

/**
 * 处理用户在公众号里发来的文本指令。
 *
 * 只处理「恰好等于某个指令」的消息；其余文本一律不回复 ——
 * 这个公众号不是客服机器人，对任意消息回话会让人以为有人工在值守。
 * 找不到对应用户时也静默返回（比如只是关注了公众号但没注册）。
 */
async function handleTextCommand(openid: string, raw: string): Promise<void> {
  const cmd = normalizeCommand(raw)
  const isOptOut = OPT_OUT_COMMANDS.some((k) => cmd === k.toLowerCase() || cmd === k)
  const isOptIn = OPT_IN_COMMANDS.some((k) => cmd === k)
  if (!isOptOut && !isOptIn) return
  if (!db) return

  const [user] = await db
    .select({ id: users.id, optedOutAt: users.notifyOptOutAt })
    .from(users)
    .where(eq(users.wechatOpenid, openid))
    .limit(1)

  if (!user) {
    console.log("[OA Event] 退订指令来自未绑定账号的 openid:", maskId(openid))
    return
  }

  if (isOptOut) {
    await optOutNotifications(user.id)
    console.log("[OA Event] 用户已退订服务通知:", maskId(openid))
    await sendOACustomerMessage(
      openid,
      "已为你关闭服务通知。会员到期、学习提醒等消息不会再发送。\n" +
        "账号与会员权益不受影响；如需重新开启，可在「设置 → 消息通知」里打开，或回复「订阅」。",
    )
  } else {
    await optInNotifications(user.id)
    console.log("[OA Event] 用户已重新开启服务通知:", maskId(openid))
    await sendOACustomerMessage(
      openid,
      "已为你重新开启服务通知。你会收到会员到期与学习提醒（不含促销内容）。\n" +
        "如需关闭，可在「设置 → 消息通知」里操作，或回复「退订」。",
    )
  }
}

async function handleEvent(event: Record<string, string>): Promise<void> {
  const openid = event.FromUserName
  const eventType = event.Event
  const eventKey = event.EventKey || ""

  if (!openid) {
    console.warn("[OA Event] Event without FromUserName")
    return
  }

  // ── 用户发来的文本消息：退订 / 重新开启 ────────────────────────────────────
  //
  // 隐私政策 §2.1 与用户协议 §9 白纸黑字写了「在公众号内发送『退订』」可以关闭
  // 服务通知 —— 这里就是那句话的实现。**承诺了就必须能兑现**：没有这个分支，
  // 用户发「退订」会石沉大海，而政策里明明写着可以。
  //
  // 确认回执走**客服消息**：不需要模板审核，而且用户刚发过消息，
  // 48 小时窗口一定是开的（见 §11.2 的渠道能力表）。
  if (event.MsgType === "text") {
    await handleTextCommand(openid, event.Content ?? "")
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
      console.warn("[OA Event] User not found or not subscribed:", maskId(openid))
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

      // 注册来源：这条链路能拿到微信侧的**权威归因**——subscribe_scene 回答
      // 「他怎么找到我们的」（公众号搜索 / 名片分享 / 扫码…），qr_scene 是我们
      // 自己的码（带邀请码时能看出是谁的码）。此前这些字段一个都没落库，
      // 于是"新增用户从哪来"只能事后写临时脚本去微信接口捞。
      //
      // 这里没有 IP/UA：请求来自微信服务器，记它毫无意义（会在 oa-check 那步
      // 用扫码者浏览器的真实请求头补齐）。
      const signup = signupFields({
        channel: "wechat_oa_qr",
        wechat: {
          subscribeScene: oaUser.subscribe_scene,
          qrScene: sceneStr,
          subscribeTime: oaUser.subscribe_time,
        },
      })

      await db.insert(users).values({
        id,
        wechatOpenid: openid,
        wechatUnionid: oaUser.unionid || null,
        name: oaUser.nickname || `微信用户${Math.floor(1000 + Math.random() * 9000)}`,
        avatar: oaUser.headimgurl,
        referredBy,
        inviteCode: generateInviteCode(),
        signupChannel: signup.signupChannel,
        signupSource: signup.signupSource as never,
        // 未受邀不送会员，由 /api/trial/claim 主动领取；受邀注册即自动领取。
        // 见 db/migrations/00012_trial_claim.sql
        ...(referredBy ? trialGrantFields(new Date(), INVITE_REGISTER_DAYS) : {}),
      })

      // 注册事件：数量仍以 users 表为权威（见 lib/analytics-events 的 FUNNEL_STEPS），
      // 这条事件只补"什么时候注册、走的哪个渠道"的时序
      await recordServerEvent({
        event: "register_success",
        userId: id,
        properties: {
          channel: signup.signupChannel,
          scene: oaUser.subscribe_scene ?? null,
          qrScene: sceneStr,
          referred: Boolean(referredBy),
        },
        pageUrl: "/login",
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
