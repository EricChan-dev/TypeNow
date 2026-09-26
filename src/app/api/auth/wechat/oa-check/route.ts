import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { trialGrantFields } from "@/lib/trial"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createSession } from "@/lib/auth/session"
import { getSceneLogin } from "@/lib/wechat"

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

  // Scene found — create/update user session
  const response = NextResponse.json({
    success: true,
    isNewUser: false,
  })

  // Clean up scene cookie
  response.cookies.set("wechat_oa_scene", "", { maxAge: 0, path: "/" })

  if (db) {
    // Look up user by openid
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.wechatOpenid, sceneData.openid))
      .limit(1)

    if (user) {
      await createSession(user.id)
    } else {
      // User should have been created by the event handler, but just in case:
      // Create a minimal user
      //
      // 这里没有 ref_code 可言（scene 里没有带邀请码），所以按「未受邀注册」处理：
      // 不自动送会员，由 /api/trial/claim 主动领取。
      // 见 supabase/migrations/00012_trial_claim.sql
      const { randomUUID } = await import("crypto")
      const id = randomUUID()
      await db.insert(users).values({
        id,
        wechatOpenid: sceneData.openid,
        wechatUnionid: sceneData.unionid || null,
        name: sceneData.nickname || `微信用户${Math.floor(1000 + Math.random() * 9000)}`,
        avatar: sceneData.avatar,
      })
      await createSession(id)
    }
  }

  return response
}

async function handleDevMode(scene: string): Promise<NextResponse> {
  const response = NextResponse.json({
    success: true,
    isNewUser: true,
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

    await createSession(user!.id)
  }

  return response
}
