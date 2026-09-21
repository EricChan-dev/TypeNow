import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createSession } from "@/lib/auth/session"
import { createHash, timingSafeEqual } from "crypto"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"

/**
 * 裸 SHA-256 强度不足：无 KDF、无盐、可被 GPU/彩虹表高速爆破。
 * 生产库中现存的是 SHA-256 摘要，因此本次不改算法（改了会把管理员锁在门外），
 * 仅做恒定时间比较。需要单独规划一次带迁移的口令轮换
 * （例如：登录成功后用 bcrypt/argon2 重新哈希并落库，逐步替换旧摘要）。
 */
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex")
}

/** 恒定时间比较，避免通过比较耗时逐字节推测摘要。长度不同直接判否。 */
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  // Rate limit: 5 attempts per minute per IP
  const ip = getClientIP(request)
  const limit = checkRateLimit("admin-login", ip, 5, 60_000)
  if (!limit.allowed) {
    return NextResponse.json({ error: `登录尝试过多，请${limit.retryAfter}秒后重试` }, { status: 429 })
  }

  const { email, password } = await request.json().catch(() => ({}))
  if (!email || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 })
  }

  // Rate limit: 10 attempts per 15 min per account. 阈值取 10（而非 IP 的 5），
  // 窗口仅 15 分钟，既能显著降低单账号在线爆破速率，又不会因管理员手误而长期锁定。
  const accountKey = String(email).trim().toLowerCase()
  const accountLimit = checkRateLimit("admin-login-account", accountKey, 10, 15 * 60_000)
  if (!accountLimit.allowed) {
    return NextResponse.json({ error: `该账号登录尝试过多，请${accountLimit.retryAfter}秒后重试` }, { status: 429 })
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
  if (!expectedHash || !timingSafeCompare(hashPassword(password), expectedHash)) {
    return NextResponse.json({ error: "账号或密码错误" }, { status: 401 })
  }

  await createSession(user.id)
  return NextResponse.json({ success: true })
}
