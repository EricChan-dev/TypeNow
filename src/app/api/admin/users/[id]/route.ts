import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents, paymentOrders, practiceRecords, subscriptions, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { and, eq, sql } from "drizzle-orm"

/** 手机号脱敏：后台详情页只用于辨认是谁，不需要完整号码。 */
function maskPhone(phone: string | null): string | null {
  if (!phone || phone.length < 7) return phone ? "***" : null
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  /**
   * 关键指标。
   *
   * 一律用查询构造器（.select().from().where()），**不要**手写
   * `sql\`(SELECT COUNT(*) ... WHERE user_id = ${users.id})\``——
   * drizzle 在单表查询里会把列名去掉表限定，那样 `user_id = id` 会解析成子查询自己的列，
   * 结果恒错且不报错。用户列表就踩过这个坑，见 src/app/api/admin/users/route.ts。
   */
  const [practiceCount, eventCount, paidRow, activeSubs, firstEvent, lastEvent] = await Promise.all([
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(practiceRecords)
      .where(eq(practiceRecords.userId, id))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.userId, id))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({
        n: sql<number>`COUNT(*)`,
        fen: sql<number>`COALESCE(SUM(${paymentOrders.amount}), 0)`,
      })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.userId, id), eq(paymentOrders.status, "paid")))
      .then((r) => ({ n: Number(r[0]?.n ?? 0), fen: Number(r[0]?.fen ?? 0) })),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, id), eq(subscriptions.status, "active")))
      .then((r) => Number(r[0]?.n ?? 0)),
    // 埋点时间跨度：判断"注册后到底有没有来过"
    db
      .select({ t: sql<string | null>`MIN(${analyticsEvents.createdAt})` })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.userId, id))
      .then((r) => r[0]?.t ?? null),
    db
      .select({ t: sql<string | null>`MAX(${analyticsEvents.createdAt})` })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.userId, id))
      .then((r) => r[0]?.t ?? null),
  ])

  // Exclude sensitive fields: OAuth tokens, phone, email
  // （phone 单独以脱敏形式给出，见下 —— 后台需要辨认"这是谁"，但不必暴露完整号码）
  const {
    wechatAccessToken, wechatRefreshToken, wechatTokenExpiresAt,
    phone, email,
    ...safeRow
  } = row

  return NextResponse.json({
    data: {
      ...safeRow,
      phoneMasked: maskPhone(phone),
      stats: {
        practiceCount,
        eventCount,
        paidOrderCount: paidRow.n,
        revenueFen: paidRow.fen,
        activeSubscriptions: activeSubs,
        firstEventAt: firstEvent,
        lastEventAt: lastEvent,
      },
    },
  })
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
