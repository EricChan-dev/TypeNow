import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verificationCodes, users } from "@/lib/db/schema"
import { eq, and, gt } from "drizzle-orm"
import { createSession } from "@/lib/auth/session"

const PHONE_REGEX = /^1[3-9]\d{9}$/

function isDevMode() {
  return process.env.NODE_ENV === "development" && !process.env.DATABASE_URL
}

async function resolveReferredBy(refCode: string | null | undefined): Promise<string | null> {
  if (!refCode || !db) return null
  const code = refCode.toUpperCase()
  const [partner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.inviteCode, code))
    .limit(1)
  return partner?.id ?? null
}

export async function POST(request: NextRequest) {
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

  // Dev mode: accept 123456 without DB
  if (isDevMode() || !db) {
    if (code !== "123456") {
      return NextResponse.json({ error: "验证码错误（开发模式请输入 123456）" }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  }

  // Verify code
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

  // Mark code as used
  await db
    .update(verificationCodes)
    .set({ used: 1 })
    .where(eq(verificationCodes.id, record.id))

  // Find or create user
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1)

  if (!user) {
    const refCode = request.cookies.get("ref_code")?.value
    const referredBy = await resolveReferredBy(refCode)
    const id = randomUUID()
    const trialExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const defaultName = `用户${Math.floor(1000 + Math.random() * 9000)}`
    await db.insert(users).values({ id, phone, name: defaultName, referredBy, isPro: 1, proExpires: trialExpiresAt })
    const [newUser] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    user = newUser

    if (referredBy) {
      const { awardInviteRegister } = await import("@/lib/auth/invite")
      await awardInviteRegister(referredBy, id).catch(() => null)
    }
  }

  await createSession(user.id)

  return NextResponse.json({ success: true, user: { id: user.id, phone: user.phone } })
}
