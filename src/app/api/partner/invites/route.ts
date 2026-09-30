import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { partnerCommissions, practiceRecords, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { parsePagination } from "@/lib/pagination"
import { ATTRIBUTION_WINDOW_DAYS, ATTRIBUTION_WINDOW_MS, daysLeftInWindow } from "@/lib/partner-rules"
import { eq, and, ne, desc, count, inArray, notInArray, gt } from "drizzle-orm"

/**
 * 「我邀请的人」明细列表。
 *
 * 为什么需要这个接口：`/api/partner/dashboard` 只给两个**总数**（邀请人数、付费人数）。
 * 总数能让推广员知道成绩，但**不能让他做任何事** —— 他不知道该跟进谁。
 * 这是推广员唯一能自己动手提升转化的抓手，也是句乐部两套推广后台都做了
 * 「待付费邀请记录」这个视图的原因（见 docs/membership-growth-plan.md 的 P2-4）。
 *
 * 三个必须带上的字段，各自解决一个具体问题：
 *
 *   · `practiced` —— 注册了但**一句都没练**的人，是最该被提醒的那批。
 *     注册来源归因显示「登录后零练习」是最主要的流失形态（见 docs/TODO.md），
 *     推广员本人去问一句「你试了吗」比平台发任何通知都有效。
 *
 *   · `daysLeft` / `expired` —— **唯一的紧迫性来源**。归因窗口是注册后 90 天，
 *     过了这个点这个人再付款也**不产生佣金**。没有这个倒计时，推广员只能盲发；
 *     有了它，他会知道该在这周内跟进谁。数值取自 lib/partner-rules（与佣金链路同源）。
 *
 *   · `paid` 的判定口径与 dashboard 的 `paidCount` **完全一致**
 *     （非 clawed_back 的 first 佣金），否则列表说 3 人未付费、统计说付费 2 人，
 *     两个数字对不上，推广员会先怀疑平台在克扣。
 *
 * 隐私：手机号脱敏后再返回，与 `/api/partner/commissions` 同口径 ——
 * 推广员需要认出"这是我朋友"，不需要拿到完整号码。
 */

/** 已付费 = 有一笔未被扣回的 first 佣金。退款扣回后不该继续算已付费。 */
function paidFirstCommissionWhere(partnerId: string) {
  return and(
    eq(partnerCommissions.partnerId, partnerId),
    eq(partnerCommissions.commissionType, "first"),
    ne(partnerCommissions.status, "clawed_back"),
  )
}

export async function GET(request: Request) {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  // 门禁与其余 partner 路由一致：免费主动同意协议（partner_agreed_at），不是付费。
  const [promoter] = await db
    .select({ partnerAgreedAt: users.partnerAgreedAt })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!promoter) return NextResponse.json({ error: "账号不存在" }, { status: 403 })
  if (!promoter.partnerAgreedAt) {
    return NextResponse.json({ error: "请先加入推广计划" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const { page, pageSize, offset } = parsePagination(searchParams, 20)

  const paidRows = await db
    .selectDistinct({ referredUserId: partnerCommissions.referredUserId })
    .from(partnerCommissions)
    .where(paidFirstCommissionWhere(session.userId))

  const paidIds = new Set(paidRows.map((r) => r.referredUserId))

  const [totalRow] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.referredBy, session.userId))
  const total = Number(totalRow?.n ?? 0)

  // 先分页取本页用户，再只对这批 id 做一次 IN 查询。
  // 不用「相关子查询 + GROUP BY」的写法：单表查询里 drizzle 会把列名去掉表限定，
  // 手写 sql 相关子查询会**静默算错**（这个坑在 admin/users 里踩过，见那边的注释）。
  const rows = await db
    .select({
      userId: users.id,
      phone: users.phone,
      name: users.name,
      registeredAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.referredBy, session.userId))
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset(offset)

  const pageIds = rows.map((r) => r.userId)

  const practicedIds = new Set<string>()
  if (pageIds.length) {
    const practiced = await db
      .selectDistinct({ userId: practiceRecords.userId })
      .from(practiceRecords)
      .where(inArray(practiceRecords.userId, pageIds))
    for (const p of practiced) if (p.userId) practicedIds.add(p.userId)
  }

  // 待跟进里「还赶得上」的那批：未付费 **且** 归因窗口未过期。
  // 单独查一次 —— 既不能用 total - paidCount 推（里面混着已过期的人），
  // 也不能用本页数据算（本页只有 20 条，算出来是页内数）。
  // 窗口边界用 gt() 而不是手写 sql 拼列引用，理由同上。
  const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_MS)
  const [pendingRow] = await db
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.referredBy, session.userId),
        gt(users.createdAt, cutoff),
        notInArray(
          users.id,
          db
            .select({ id: partnerCommissions.referredUserId })
            .from(partnerCommissions)
            .where(paidFirstCommissionWhere(session.userId)),
        ),
      ),
    )

  const now = Date.now()
  const data = rows.map((r) => {
    const paid = paidIds.has(r.userId)
    const daysLeft = r.registeredAt ? daysLeftInWindow(r.registeredAt, now) : 0
    return {
      userId: r.userId,
      // 与 commissions 路由同口径脱敏：推广员要能认出朋友，不需要完整号码
      phone: r.phone ? r.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2") : null,
      name: r.name,
      registeredAt: r.registeredAt,
      practiced: practicedIds.has(r.userId),
      paid,
      // 已付费的人不需要倒计时（钱已经记上了）
      daysLeft: paid ? null : daysLeft,
      expired: paid ? false : daysLeft < 0,
    }
  })

  return NextResponse.json({
    data,
    page,
    pageSize,
    total,
    attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
    summary: {
      total,
      paidCount: paidIds.size,
      pendingCount: total - paidIds.size,
      pendingInWindow: Number(pendingRow?.n ?? 0),
    },
  })
}
