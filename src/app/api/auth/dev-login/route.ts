import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createSession } from "@/lib/auth/session"

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development" || !db) {
    return new NextResponse("Not found", { status: 404 })
  }

  const devOpenid = "dev_qrcode_login"
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.wechatOpenid, devOpenid))
    .limit(1)

  if (!user) {
    const id = randomUUID()
    await db.insert(users).values({
      id,
      wechatOpenid: devOpenid,
      name: "开发测试用户",
      // 开发旁路建的号也要打上渠道：来源报表里必须能把它们摘出去，
      // 否则本地调试会污染"新增用户从哪来"的统计（线上那三个测试账号
      // 就是本地连生产库调试留下的，此前无从区分）
      signupChannel: "dev",
      signupSource: { channel: "dev", note: "dev-login 本地旁路" } as never,
    })
    const [newUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    user = newUser
  }

  await createSession(user.id)
  return NextResponse.redirect(new URL("/home", request.nextUrl.origin))
}
