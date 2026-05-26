import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import { db } from "@/lib/db"
import { sessions } from "@/lib/db/schema"
import { eq, and, gt } from "drizzle-orm"

const COOKIE_NAME = "typenow_session"
const SESSION_DAYS = 30

export interface SessionInfo {
  sessionId: string
  userId: string
  expiresAt: Date
}

export async function getSession(): Promise<SessionInfo | null> {
  if (!db) return null
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(COOKIE_NAME)?.value
    if (!sessionId) return null

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
    await db.delete(sessions).where(eq(sessions.id, sessionId))
  }
  cookieStore.delete(COOKIE_NAME)
}

export async function isDbConfigured(): Promise<boolean> {
  return !!db
}
