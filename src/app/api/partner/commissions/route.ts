import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { partnerCommissions, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { parsePagination } from "@/lib/pagination"
import { eq, and, lte, desc } from "drizzle-orm"

export async function GET(request: Request) {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  const [partner] = await db
    .select({ isPartner: users.isPartner })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!partner?.isPartner) {
    return NextResponse.json({ error: "您还不是合伙人" }, { status: 403 })
  }

  // Thaw eligible cooling commissions
  await db
    .update(partnerCommissions)
    .set({ status: "available" })
    .where(
      and(
        eq(partnerCommissions.partnerId, session.userId),
        eq(partnerCommissions.status, "cooling"),
        lte(partnerCommissions.availableAt, new Date())
      )
    )

  const { searchParams } = new URL(request.url)
  // 旧写法 Math.max(1, Number("abc")) 会得到 NaN；虽然 offset 为 NULL 时 MySQL
  // 只是忽略偏移（不报错），但页码会变成 NaN 并原样回给前端。统一收敛掉。
  const { page, pageSize, offset } = parsePagination(searchParams, 20)

  const rows = await db
    .select({
      id: partnerCommissions.id,
      referredUserId: partnerCommissions.referredUserId,
      commissionAmount: partnerCommissions.commissionAmount,
      rate: partnerCommissions.rate,
      commissionType: partnerCommissions.commissionType,
      status: partnerCommissions.status,
      availableAt: partnerCommissions.availableAt,
      createdAt: partnerCommissions.createdAt,
      referredUserPhone: users.phone,
    })
    .from(partnerCommissions)
    .leftJoin(users, eq(partnerCommissions.referredUserId, users.id))
    .where(eq(partnerCommissions.partnerId, session.userId))
    .orderBy(desc(partnerCommissions.createdAt))
    .limit(pageSize)
    .offset(offset)

  const data = rows.map((r) => ({
    ...r,
    referredUserPhone: r.referredUserPhone
      ? r.referredUserPhone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")
      : null,
  }))

  return NextResponse.json({ data, page, pageSize })
}
