import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verificationCodes } from "@/lib/db/schema"
import { eq, and, gt, gte } from "drizzle-orm"
import { sendVerificationCode } from "@/lib/aliyun-sms"

const PHONE_REGEX = /^1[3-9]\d{9}$/

function isDevMode() {
  return process.env.NODE_ENV === "development" && !process.env.DATABASE_URL
}

export async function POST(request: Request) {
  let body: { phone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const phone = body.phone?.trim()
  if (!phone || !PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "请输入有效的手机号" }, { status: 400 })
  }

  // Dev mode (no DB): use fixed code 123456
  if (isDevMode() || !db) {
    return NextResponse.json({ success: true, message: "验证码已发送（开发模式：输入 123456）" })
  }

  // Rate limiting: max 1 SMS per 60 seconds per phone
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000)
  const [recent] = await db
    .select({ createdAt: verificationCodes.createdAt })
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.phone, phone),
        gte(verificationCodes.createdAt, sixtySecondsAgo)
      )
    )
    .orderBy(verificationCodes.createdAt)
    .limit(1)

  if (recent) {
    const elapsed = Math.floor((Date.now() - recent.createdAt.getTime()) / 1000)
    const remaining = 60 - elapsed
    return NextResponse.json(
      { error: `发送过于频繁，请${remaining}秒后再试`, cooldown: remaining },
      { status: 429 }
    )
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString()

  if (!process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET) {
    return NextResponse.json({ error: "短信服务未配置" }, { status: 500 })
  }

  const result = await sendVerificationCode(phone, code)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "短信发送失败，请稍后重试" },
      { status: 500 }
    )
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
  await db.insert(verificationCodes).values({ phone, code, expiresAt })

  // Clean up old expired codes for this phone (fire-and-forget)
  void db
    .delete(verificationCodes)
    .where(
      and(
        eq(verificationCodes.phone, phone),
        gt(verificationCodes.expiresAt, new Date(0))
      )
    )
    .catch(() => {})

  return NextResponse.json({ success: true, message: "验证码已发送" })
}
