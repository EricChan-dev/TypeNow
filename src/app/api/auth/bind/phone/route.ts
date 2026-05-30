import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users, verificationCodes } from "@/lib/db/schema"
import { eq, and, gt } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { getUserByPhone } from "@/lib/auth/user"

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

  // Mark code as used
  await db
    .update(verificationCodes)
    .set({ used: 1 })
    .where(eq(verificationCodes.id, record.id))

  // Check if phone is already bound to another user
  const existingUser = await getUserByPhone(phone)
  if (existingUser && existingUser.id !== session.userId) {
    return NextResponse.json({ error: "该手机号已被其他账号绑定" }, { status: 409 })
  }

  if (existingUser?.id === session.userId) {
    return NextResponse.json({ error: "该手机号已绑定当前账号" }, { status: 409 })
  }

  // Bind phone to current user
  await db
    .update(users)
    .set({ phone })
    .where(eq(users.id, session.userId))

  return NextResponse.json({ success: true, phone })
}
