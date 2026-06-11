import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
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
  const devScene = request.nextUrl.searchParams.get("dev_scene")
  if (devScene && devScene === scene) {
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
      const { randomUUID } = await import("crypto")
      const id = randomUUID()
      const trialExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      await db.insert(users).values({
        id,
        wechatOpenid: sceneData.openid,
        wechatUnionid: sceneData.unionid || null,
        name: sceneData.nickname || `微信用户${Math.floor(1000 + Math.random() * 9000)}`,
        avatar: sceneData.avatar,
        isPro: 1,
        proExpires: trialExpiresAt,
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
      const trialExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      await db.insert(users).values({
        id,
        wechatOpenid: devOpenid,
        name: "公众号开发用户",
        isPro: 1,
        proExpires: trialExpiresAt,
      })
      const [newUser] = await db.select().from(users).where(eq(users.id, id)).limit(1)
      user = newUser
    }

    await createSession(user!.id)
  }

  return response
}
