import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { trialGrantFields } from "@/lib/trial"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createSession, COOKIE_NAME, DEV_SESSION_PREFIX } from "@/lib/auth/session"
import { getSceneLogin } from "@/lib/wechat"
import {
  mergeSignupSource,
  parseSignupSource,
  requestSignupContext,
  signupFields,
} from "@/lib/signup-source"
import { FIRST_TOUCH_COOKIE, parseFirstTouch } from "@/lib/first-touch"
import { recordServerEvent, visitorIdFromRequest } from "@/lib/analytics-server"
import { needsPhoneBinding } from "@/lib/phone-gate"

export async function GET(request: NextRequest) {
  const scene = request.cookies.get("wechat_oa_scene")?.value

  if (!scene) {
    return NextResponse.json(
      { error: "no_scene" },
      { status: 400 }
    )
  }

  // Dev mode: simulate login with a magic click
  // 必须限定 development：scene 值由 oa-qrcode 在响应体中回显，
  // 若在生产生效，匿名请求带上该值即可直接获得登录会话（且被授予 Pro）。
  const devScene = request.nextUrl.searchParams.get("dev_scene")
  if (process.env.NODE_ENV === "development" && devScene && devScene === scene) {
    return handleDevMode(scene)
  }

  // Check if this scene has been claimed
  const sceneData = getSceneLogin(scene)

  if (!sceneData) {
    return NextResponse.json({ success: false })
  }

  // Scene found —— 先判定「要不要绑手机号」，最后再统一构造响应：
  // 这个标志必须写进 **body**，因为前端是 fetch + res.json()，读不到自定义响应头。
  //
  // 判定与 wechat/callback、与 home/layout 的兜底同源（lib/phone-gate），三处必须
  // 一致，否则会出现「回调说不用绑、layout 又把人弹回来」的来回跳。
  let needsBind = false

  if (db) {
    // 这一步是**扫码者自己的浏览器**发起的（它在 /login 上轮询），
    // 所以只有这里能拿到真实的 IP / UA / Referer 与首触 cookie。
    const reqMeta = requestSignupContext(request)
    const firstTouch = parseFirstTouch(request.cookies.get(FIRST_TOUCH_COOKIE)?.value)

    // Look up user by openid
    const [user] = await db
      .select({
        id: users.id,
        phone: users.phone,
        signupChannel: users.signupChannel,
        signupSource: users.signupSource,
      })
      .from(users)
      .where(eq(users.wechatOpenid, sceneData.openid))
      .limit(1)

    if (user) {
      await createSession(user.id)
      // 没绑手机号 → 让前端把我送去登录页绑定，而不是进 /home 后被弹窗拦
      needsBind = needsPhoneBinding({ phone: user.phone })
      // 扫码链是**两步**：关注事件先建号（只有微信侧 scene，没有 IP/UA），
      // 这里再用浏览器侧的请求头补齐。判据是 signup_source 里有没有 ip，
      // **不是** signup_channel 是否为空 —— 后者在上面那步就已经写好了，
      // 用它当条件会让浏览器侧信息在最常见的路径上永远补不上。
      //
      // 只在缺 ip 时补一次：这个接口被前端每 2 秒轮询一次，
      // 无条件 UPDATE 会变成"每次轮询都写一行 users"。
      const existing = parseSignupSource(user.signupSource)
      if (!existing?.ip) {
        await db
          .update(users)
          .set({
            signupChannel: user.signupChannel ?? "wechat_oa_qr",
            signupSource: mergeSignupSource(existing, {
              referrer: firstTouch?.referrer,
              landing: firstTouch?.landing,
              utm: firstTouch?.utm,
              requestReferrer: reqMeta.referrer,
              userAgent: reqMeta.userAgent,
              ip: reqMeta.ip,
            }) as never,
          })
          .where(eq(users.id, user.id))
      }
    } else {
      // User should have been created by the event handler, but just in case:
      // Create a minimal user
      //
      // 这里没有 ref_code 可言（scene 里没有带邀请码），所以按「未受邀注册」处理：
      // 不自动送会员，由 /api/trial/claim 主动领取。
      // 见 db/migrations/00012_trial_claim.sql
      const { randomUUID } = await import("crypto")
      const id = randomUUID()
      // 兜底路径拿不到微信侧 scene（那是关注事件里的），能记的就是这次浏览器请求
      const signup = signupFields({
        channel: "wechat_oa_qr",
        firstTouch,
        request: reqMeta,
      })
      await db.insert(users).values({
        id,
        wechatOpenid: sceneData.openid,
        wechatUnionid: sceneData.unionid || null,
        name: sceneData.nickname || `微信用户${Math.floor(1000 + Math.random() * 9000)}`,
        avatar: sceneData.avatar,
        signupChannel: signup.signupChannel,
        signupSource: signup.signupSource as never,
      })
      await createSession(id)

      await recordServerEvent({
        event: "register_success",
        userId: id,
        properties: { channel: signup.signupChannel, fallback: true },
        pageUrl: "/login",
        // 这是扫码者自己的浏览器在轮询，所以读得到 typ_vid（见 lib/visitor.ts）。
        // 注意：主路径（关注事件先建号）的建号发生在微信服务器的 webhook 里，
        // 那里没有 cookie；那条链路的 visitor 绑定靠登录后浏览器继续上报的埋点事件。
        visitorId: visitorIdFromRequest(request),
      })

      // 兜底建号同样没有手机号 —— 不在这里置位，用户会进 /home 再被 layout 弹回来
      needsBind = true
    }
  }

  const response = NextResponse.json({
    success: true,
    // 返回用户走的是「已有账号」路径（关注事件已建号），不是新人
    isNewUser: false,
    needsBind,
  })

  // Clean up scene cookie
  response.cookies.set("wechat_oa_scene", "", { maxAge: 0, path: "/" })

  return response
}

async function handleDevMode(scene: string): Promise<NextResponse> {
  // 开发态夹具账号多半也没手机号，但本地开发不该被绑手机号拦住
  // （与 lib/auth/session 的 isDevBypassSession 同一种取舍）：
  // 所以这里恒为 false，用户走 dev 路径不会被送进绑定流程。
  const response = NextResponse.json({
    success: true,
    isNewUser: true,
    needsBind: false,
  })

  response.cookies.set("wechat_oa_scene", "", { maxAge: 0, path: "/" })

  if (db) {
    const devOpenid = "dev_oa_user"
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.wechatOpenid, devOpenid))
      .limit(1)

    if (!user) {
      const { randomUUID } = await import("crypto")
      const id = randomUUID()
      // 开发态夹具**保留**自动送会员：本地要验证会员功能（练习页、AI 讲解等），
      // 每个 dev 账号都先去领一次体验会员会很烦。仍然写上 trial_claimed_at，
      // 否则这个账号还能再领一次，与「每人一次」的口径不一致。
      // 这与 CLAUDE.md 记录的其他开发态旁路（dev 登录 cookie）是同一类取舍。
      await db.insert(users).values({
        id,
        wechatOpenid: devOpenid,
        name: "公众号开发用户",
        ...trialGrantFields(),
      })
      const [newUser] = await db.select().from(users).where(eq(users.id, id)).limit(1)
      user = newUser
    }

    // 必须发**旁路 cookie**（dev:<userId>），不能走 createSession 发真会话。
    //
    // 上面那句「用户走 dev 路径不会被送进绑定流程」的注释要成立，靠的就是这个：
    // /home 的 layout 用 needsPhoneBinding 拦人，而它只在 isDevBypassSession() 为真时
    // 放行，该函数认的是 cookie 的 `dev:` 前缀。开发态建的这个账号没有手机号，
    // 发真会话（裸 UUID）会让旁路认不出来，扫码登录后人就被弹回 /login?bind=1。
    response.cookies.set(COOKIE_NAME, `${DEV_SESSION_PREFIX}${user!.id}`, {
      httpOnly: true,
      secure: false, // 恒为 false：本分支只在 development 生效（见上方 dev_scene 判定）
      sameSite: "lax",
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      path: "/",
    })
  }

  return response
}
