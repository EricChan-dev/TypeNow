import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { getSession } from "./session"
import type { User } from "@/lib/db/schema"

export async function getCurrentUser(): Promise<User | null> {
  if (!db) return null
  const session = await getSession()
  if (!session) return null

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  return user ?? null
}

export async function getUserById(id: string): Promise<User | null> {
  if (!db) return null
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return user ?? null
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  if (!db) return null
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1)
  return user ?? null
}

export async function getUserByWechatOpenid(openid: string): Promise<User | null> {
  if (!db) return null
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.wechatOpenid, openid))
    .limit(1)
  return user ?? null
}
