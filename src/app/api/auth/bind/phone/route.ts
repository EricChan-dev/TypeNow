import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users, verificationCodes } from "@/lib/db/schema"
import { eq, and, gt } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { getUserByPhone } from "@/lib/auth/user"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"

const PHONE_REGEX = /^1[3-9]\d{9}$/

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 500 })
  }

  // Must be logged in
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  let body: { phone?: string; code?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const phone = body.phone?.trim()
  const code = body.code?.trim()

  if (!phone || !PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "请输入有效的手机号" }, { status: 400 })
  }
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: "请输入6位验证码" }, { status: 400 })
  }

  // 防验证码枚举：IP（10次/分钟）+ 手机号（5次/5分钟）双维度限流。
  // 手机号维度是关键——否则单个 IP 可对同一号码高速试 6 位码（10^6 空间）。
  // 阈值与 verify-code 保持一致（5次/5分钟），一个有效验证码一次即可通过，不影响正常用户。
  const ip = getClientIP(request)
  const ipLimit = checkRateLimit("bind-phone-ip", ip, 10, 60_000)
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: `尝试次数过多，请${ipLimit.retryAfter}秒后重试` }, { status: 429 })
  }
  const phoneLimit = checkRateLimit("bind-phone-phone", phone, 5, 300_000)
  if (!phoneLimit.allowed) {
    return NextResponse.json({ error: `该号码尝试次数过多，请${phoneLimit.retryAfter}秒后重试` }, { status: 429 })
  }

  // Verify SMS code
  const [record] = await db
    .select()
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.phone, phone),
        eq(verificationCodes.code, code),
        eq(verificationCodes.used, 0),
        gt(verificationCodes.expiresAt, new Date())
      )
    )
    .orderBy(verificationCodes.createdAt)
    .limit(1)

  if (!record) {
    return NextResponse.json({ error: "验证码错误或已过期" }, { status: 400 })
  }

  // Check if phone is already bound to another user BEFORE consuming code
  const existingUser = await getUserByPhone(phone)
  if (existingUser && existingUser.id !== session.userId) {
    // 这里**不**做账号合并：本接口的语义是「把手机号写到当前账号」。
    // 但走到这个分支的人几乎都是同一种处境 —— 先用手机号注册过，后来又用微信登录，
    // 于是同一人拥有两个账号。当前系统没有任何合并能力（22 张表按 user_id 挂载，
    // 其中 8 个唯一约束在合并时会冲突），所以只能如实告知并给出人工出口，
    // 而不是丢一句「已被绑定」让人反复重试。
    return NextResponse.json(
      {
        error:
          "该手机号已用于另一个账号。通常是因为你之前用手机号注册过、后来又用微信登录，产生了两个账号。系统暂不支持自助合并，请联系客服帮你合并。",
        code: "PHONE_TAKEN",
      },
      { status: 409 },
    )
  }

  if (existingUser?.id === session.userId) {
    return NextResponse.json({ error: "该手机号已绑定当前账号" }, { status: 409 })
  }

  // Mark code as used only after validation passes
  await db
    .update(verificationCodes)
    .set({ used: 1 })
    .where(eq(verificationCodes.id, record.id))

  // Bind phone to current user
  await db
    .update(users)
    .set({ phone })
    .where(eq(users.id, session.userId))

  return NextResponse.json({ success: true, phone })
}
