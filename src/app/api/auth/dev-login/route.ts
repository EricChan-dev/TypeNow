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
