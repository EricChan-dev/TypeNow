import { NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { verificationCodes } from "@/lib/db/schema"
import { eq, and, gt, gte, count } from "drizzle-orm"
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

  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown").slice(0, 50)
  const now = Date.now()
  const minus1min = new Date(now - 60 * 1000)
  const minus1hr = new Date(now - 60 * 60 * 1000)
  const minus24hr = new Date(now - 24 * 60 * 60 * 1000)

  // IP: max 3 per minute
  const [{ ipCount }] = await db
    .select({ ipCount: count() })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.ip, ip), gte(verificationCodes.createdAt, minus1min)))
  if (ipCount >= 3) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 })
  }

  // Phone: max 5 per hour
  const [{ ph1h }] = await db
    .select({ ph1h: count() })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.phone, phone), gte(verificationCodes.createdAt, minus1hr)))
  if (ph1h >= 5) {
    return NextResponse.json({ error: "发送次数超限，请1小时后再试" }, { status: 429 })
  }

  // Phone: max 10 per 24h
  const [{ ph24h }] = await db
    .select({ ph24h: count() })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.phone, phone), gte(verificationCodes.createdAt, minus24hr)))
  if (ph24h >= 10) {
    return NextResponse.json({ error: "今日发送次数已达上限，请明天再试" }, { status: 429 })
  }

  // Phone: 60s cooldown
  const [recent] = await db
    .select({ createdAt: verificationCodes.createdAt })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.phone, phone), gte(verificationCodes.createdAt, minus1min)))
    .orderBy(verificationCodes.createdAt)
    .limit(1)

  if (recent) {
    const elapsed = Math.floor((now - recent.createdAt.getTime()) / 1000)
    const remaining = 60 - elapsed
    return NextResponse.json(
      { error: `发送过于频繁，请${remaining}秒后再试`, cooldown: remaining },
      { status: 429 }
    )
  }

  const code = crypto.randomInt(100000, 999999).toString()

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
  await db.insert(verificationCodes).values({ phone, code, ip, expiresAt })

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
