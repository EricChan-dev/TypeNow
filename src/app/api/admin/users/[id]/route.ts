import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Exclude sensitive fields: OAuth tokens, phone, email
  const {
    wechatAccessToken, wechatRefreshToken, wechatTokenExpiresAt,
    phone, email,
    ...safeRow
  } = row
  return NextResponse.json({ data: safeRow })
}

const VALID_ROLES = ["user", "admin"] as const

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const { role, isPro, level } = await request.json()
  // Validate role value
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "无效角色" }, { status: 400 })
  }
  await db.update(users).set({ role, isPro, level }).where(eq(users.id, id))
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Exclude sensitive fields
  const {
    wechatAccessToken, wechatRefreshToken, wechatTokenExpiresAt,
    phone: _phone, email: _email,
    ...safeRow
  } = row
  return NextResponse.json({ data: safeRow })
}
