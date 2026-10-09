import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import { db } from "@/lib/db"
import { sessions } from "@/lib/db/schema"
import { eq, and, gt } from "drizzle-orm"

export const COOKIE_NAME = "typenow_session"
const SESSION_DAYS = 30

/**
 * 开发态登录旁路的会话前缀：cookie 值形如 `dev:<userId>`。
 *
 * 导出成常量是因为它有两个使用点（下面的 getSession / isDevBypassSession，以及
 * api/auth/dev-login 发这条 cookie），字面量散在多处时改一处漏一处就会出现
 * 「发了会话但旁路认不出来」这种只在开发态复现的故障。
 */
export const DEV_SESSION_PREFIX = "dev:"

export interface SessionInfo {
  sessionId: string
  userId: string
  expiresAt: Date
}

export async function getSession(): Promise<SessionInfo | null> {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(COOKIE_NAME)?.value
    if (!sessionId) return null

    // Dev mode bypass: cookie value is "dev:<userId>" — no DB needed. Dev only.
    if (process.env.NODE_ENV === "development" && sessionId.startsWith(DEV_SESSION_PREFIX)) {
      const userId = sessionId.slice(DEV_SESSION_PREFIX.length)
      return { sessionId, userId, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) }
    }

    if (!db) return null

    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          gt(sessions.expiresAt, new Date())
        )
      )
      .limit(1)

    if (!row) return null
    return { sessionId: row.id, userId: row.userId, expiresAt: row.expiresAt }
  } catch {
    return null
  }
}

/**
 * 当前请求是否走开发态登录旁路（cookie 值形如 dev:<userId>，且处于 development）。
 *
 * 单独暴露出来是给「强制绑定手机号」那道闸门用的：本地开发与 e2e 的账号
 * 都没有手机号，不该被拦在门外（与仓库其它 dev 旁路同一种取舍）。
 */
export async function isDevBypassSession(): Promise<boolean> {
  if (process.env.NODE_ENV !== "development") return false
  try {
    const cookieStore = await cookies()
    return (cookieStore.get(COOKIE_NAME)?.value ?? "").startsWith(DEV_SESSION_PREFIX)
  } catch {
    return false
  }
}

export async function createSession(userId: string): Promise<string> {
  if (!db) throw new Error("Database not configured")

  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)

  await db.insert(sessions).values({ id: sessionId, userId, expiresAt })

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  })

  return sessionId
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(COOKIE_NAME)?.value
  if (sessionId && db) {
    try {
      await db.delete(sessions).where(eq(sessions.id, sessionId))
    } catch {
      // ignore DB failure — cookie clearing below is the critical step
    }
  }
  cookieStore.set(COOKIE_NAME, "", { maxAge: 0, path: "/" })
}

export async function isDbConfigured(): Promise<boolean> {
  return !!db
}
