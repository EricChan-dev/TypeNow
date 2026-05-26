import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { sql } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("current") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "20")
  const offset = (page - 1) * pageSize

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(paymentOrders).limit(pageSize).offset(offset).orderBy(paymentOrders.createdAt),
    db.select({ total: sql<number>`count(*)` }).from(paymentOrders),
  ])

  return NextResponse.json({ data: rows, total })
}
