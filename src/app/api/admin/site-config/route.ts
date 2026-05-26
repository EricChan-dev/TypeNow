import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { siteConfig } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const key = searchParams.get("key")

  if (key) {
    const [row] = await db.select().from(siteConfig).where(eq(siteConfig.key, key)).limit(1)
    return NextResponse.json({ data: row ?? null })
  }

  const rows = await db.select().from(siteConfig)
  return NextResponse.json({ data: rows, total: rows.length })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { key, value } = await request.json()
  await db.insert(siteConfig).values({ key, value, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } })

  return NextResponse.json({ data: { key, value } })
}
