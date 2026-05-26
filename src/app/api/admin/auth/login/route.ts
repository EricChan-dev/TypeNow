import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createSession } from "@/lib/auth/session"
import { createHash } from "crypto"

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex")
}

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const { email, password } = await request.json().catch(() => ({}))
  if (!email || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 })
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "账号或密码错误" }, { status: 401 })
  }

  // Simple password check against hashed stored value (ADMIN_PASSWORD_HASH env)
  const expectedHash = process.env.ADMIN_PASSWORD_HASH
  if (!expectedHash || hashPassword(password) !== expectedHash) {
    return NextResponse.json({ error: "账号或密码错误" }, { status: 401 })
  }

  await createSession(user.id)
  return NextResponse.json({ success: true })
}
