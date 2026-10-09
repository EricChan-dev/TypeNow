import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { COOKIE_NAME, DEV_SESSION_PREFIX } from "@/lib/auth/session"

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

  // 必须发**旁路 cookie**（dev:<userId>），不能走 createSession 发真会话。
  //
  // 原因：这个旁路账号由开发态建出来，没有手机号，而 /home 的 layout 会拿
  // needsPhoneBinding 拦一道。它只在 isDevBypassSession() 为真时放行，而那个函数
  // 认的是 cookie 里的 `dev:` 前缀 —— 发真会话（裸 UUID）会让旁路认不出来，
  // 于是「一键登录」把人送到 /home 又立刻被弹回 /login?bind=1，看起来就是登不进去。
  const res = NextResponse.redirect(new URL("/home", request.nextUrl.origin))
  res.cookies.set(COOKIE_NAME, `${DEV_SESSION_PREFIX}${user.id}`, {
    httpOnly: true,
    // 恒为 false：本路由开头已把非 development 的请求挡成 404，
    // 走到这里必然是 http 的本地环境（写成 === "production" 反而是永远为假的死代码）。
    secure: false,
    sameSite: "lax",
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    path: "/",
  })
  return res
}
