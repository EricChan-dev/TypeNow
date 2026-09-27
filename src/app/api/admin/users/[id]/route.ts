import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents, paymentOrders, practiceRecords, subscriptions, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { describeAuditActor, diffAuditFields, logAdminAction } from "@/lib/admin-audit"
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

/** 等级的取值范围。库里实测只有 1，取一个宽松但有界的区间防脏数据。 */
const MAX_LEVEL = 1000

/**
 * 修改用户的角色 / 会员状态 / 等级。
 *
 * ⚠️ 这个接口前端**没有入口**（用户详情页是只读的），所以它只能被手工构造的请求调用。
 * 正因为没人会顺手发现它出问题，校验必须写在服务端、而且要挡得住**自锁与提权**：
 *
 *   1. 逐字段校验类型与范围。原先只校验了 role，`isPro` / `level` 是任意值直写 ——
 *      `isPro: 999`、`level: "abc"` 都能落库，之后所有读 isPro 的地方
 *      （会员判定、付费墙、试学截断）行为都不确定。
 *
 *   2. **禁止自我降权**。管理员把自己改成 user，就再也进不了后台；
 *      如果他还是唯一的管理员，等于把整个后台锁死，只能改库救回来。
 *
 *   3. **禁止降级最后一个管理员**。同上，针对"改别人"的情形兜一层。
 *      注意 requireAdmin 还认 ADMIN_PHONES，所以"有后台权限的人"可能多于
 *      `role='admin'` 的人数 —— 这条守卫按 role 计数，是保守的那个方向。
 *
 *   4. **isPro 与 proExpires 必须一致**。checkAndExpirePro 只在
 *      `proExpires` 非空且已过期时才降级，所以 `isPro=1` + `proExpires=NULL`
 *      意味着**永久会员、永不自动过期**。这是最容易被无意中造出来的状态
 *      （想送一个月，结果写成了永久），所以要求：把 isPro 置 1 时必须给出
 *      proExpires（想永久就显式传一个很远的日期，让意图写在请求里）。
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { role, isPro, level, proExpires } = body as {
    role?: unknown
    isPro?: unknown
    level?: unknown
    proExpires?: unknown
  }

  // ── 逐字段校验 ──
  if (role !== undefined && !(VALID_ROLES as readonly unknown[]).includes(role)) {
    return NextResponse.json(
      { error: `无效角色（只能是 ${VALID_ROLES.join(" / ")}）` },
      { status: 400 },
    )
  }

  // isPro 接受 0/1 与布尔，统一归一成 0/1 落库（tinyint 列）
  let normalizedIsPro: 0 | 1 | undefined
  if (isPro !== undefined) {
    if (isPro === 0 || isPro === 1) normalizedIsPro = isPro
    else if (isPro === true) normalizedIsPro = 1
    else if (isPro === false) normalizedIsPro = 0
    else {
      return NextResponse.json({ error: "isPro 只能是 0 / 1 / true / false" }, { status: 400 })
    }
  }

  if (level !== undefined) {
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
      return NextResponse.json(
        { error: `level 必须是 0~${MAX_LEVEL} 之间的整数` },
        { status: 400 },
      )
    }
  }

  let normalizedProExpires: Date | null | undefined
  if (proExpires !== undefined) {
    if (proExpires === null || proExpires === "") {
      normalizedProExpires = null
    } else {
      const d = new Date(proExpires as string)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "proExpires 不是合法时间" }, { status: 400 })
      }
      normalizedProExpires = d
    }
  }

  // 三个字段都没给：明确报错。原先会把 {role:undefined,isPro:undefined,level:undefined}
  // 交给 drizzle，而它没有可写的列 —— 要么抛错 500，要么静默什么也没做，
  // 两种都不是调用方想要的
  if (role === undefined && normalizedIsPro === undefined && level === undefined && normalizedProExpires === undefined) {
    return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 })
  }

  // ── 读现状：守卫、一致性判断与审计差异都要用它 ──
  // 这里多取了 isPro / level / name / phone：审计要给出"从什么改成什么"，
  // 只取 id/role/proExpires 的话日志里就只有 role 的变更。
  const [existing] = await database
    .select({
      id: users.id,
      role: users.role,
      proExpires: users.proExpires,
      isPro: users.isPro,
      level: users.level,
      name: users.name,
      phone: users.phone,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // ── 2. 禁止自我降权 ──
  if (role !== undefined && role !== "admin" && id === auth.userId) {
    return NextResponse.json(
      { error: "不能取消自己的管理员权限（会让当前账号立刻失去后台访问权）。请让另一位管理员操作。" },
      { status: 400 },
    )
  }

  // ── 3. 禁止降级最后一个管理员 ──
  if (role !== undefined && role !== "admin" && existing.role === "admin") {
    const [row] = await database
      .select({ n: sql<number>`COUNT(*)` })
      .from(users)
      .where(eq(users.role, "admin"))
    if (Number(row?.n ?? 0) <= 1) {
      return NextResponse.json(
        { error: "这是最后一位管理员，降级后没人能进后台。请先指定另一位管理员。" },
        { status: 400 },
      )
    }
  }

  // ── 4. isPro 与 proExpires 的一致性 ──
  // 判定用的是**写完之后**的 proExpires：本次给了就用本次的，没给就沿用库里的现值。
  const resultingProExpires =
    normalizedProExpires !== undefined ? normalizedProExpires : existing.proExpires
  if (normalizedIsPro === 1 && (resultingProExpires === null || resultingProExpires === undefined)) {
    return NextResponse.json(
      {
        error:
          "把用户设为会员时必须同时给 proExpires —— 否则就是永久会员、永不自动过期" +
          "（checkAndExpirePro 只在 proExpires 非空且已过期时才降级）。" +
          "确实想永久开通，请显式传一个很远的日期，让意图写在请求里。",
      },
      { status: 400 },
    )
  }

  await database
    .update(users)
    .set({
      ...(role !== undefined ? { role: role as (typeof VALID_ROLES)[number] } : {}),
      ...(normalizedIsPro !== undefined ? { isPro: normalizedIsPro } : {}),
      ...(level !== undefined ? { level: level as number } : {}),
      ...(normalizedProExpires !== undefined ? { proExpires: normalizedProExpires } : {}),
    })
    .where(eq(users.id, id))

  const [row] = await database.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // 给谁开了会员/提了权，是审计里最需要留痕的一类操作 —— 它直接改变权限与付费状态。
  // 操作者用 adminLabel 快照，对象用 describeAuditActor（姓名 + 脱敏手机号）：
  // 用户改名或删除之后这行日志仍然读得懂。
  await logAdminAction(auth, {
    action: "update",
    targetType: "user",
    targetId: id,
    targetLabel: describeAuditActor(row, id),
    detail: diffAuditFields(existing, row, ["role", "isPro", "level", "proExpires"]),
  }, request)
  // Exclude sensitive fields
  const {
    wechatAccessToken, wechatRefreshToken, wechatTokenExpiresAt,
    phone: _phone, email: _email,
    ...safeRow
  } = row
  return NextResponse.json({ data: safeRow })
}
