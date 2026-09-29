import { db } from "@/lib/db"
import { subscriptions, users, partnerCommissions, paymentOrders as paymentOrdersTable } from "@/lib/db/schema"
import { eq, and, lte, desc, ne, sql, count as sqlCount, type SQL } from "drizzle-orm"
import { randomInt, randomUUID } from "crypto"
import { CommissionWriteError, classifyCommissionWriteError } from "@/lib/commission-safety"
// 时长与价格的唯一事实源都在 lib/pricing —— 加一档只改那里一处。
// 此前时长映射写在本文件、价格写在 lib/wechat-pay，加档要改两处、很容易漏。
import { planDurationDays, type PlanKey } from "@/lib/pricing"

/**
 * 生成邀请码。
 *
 * 用 `crypto.randomInt` 而不是 `Math.random()`：邀请码是**归因凭据** ——
 * 拿到某个码就能拿到它带来的佣金，所以"不可预测"本身就是它的安全属性。
 * `Math.random()` 用的是非密码学 PRNG（V8 是 xorshift128+），观察到若干输出
 * 即可推出后续；而字符集只有 32 个、长度 8（约 40 bit），可预测 + 可枚举
 * 不是好组合。
 *
 * `randomInt` 还自带无偏取模 —— `Math.floor(Math.random() * len)` 在 len 不整除
 * 2^32 时对靠前的字符有微小偏好（这里 32 恰好整除，但依赖这种巧合很脆弱）。
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("")
}

async function grantPartnerAccess(userId: string): Promise<void> {
  if (!db) return

  // Preserve existing inviteCode if user already has one (avoid breaking referral links)
  const [existingUser] = await db
    .select({ inviteCode: users.inviteCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  let inviteCode = existingUser?.inviteCode
  if (!inviteCode) {
    // 生成到不冲突为止。此前是一个 `do { inviteCode = generateInviteCode() } while
    // (attempts < 10)` 的空循环：从不查询数据库，只是重复赋值十次同一个新码。
    // 一旦撞上 users.invite_code 唯一索引，整条开通链路会直接 500。
    for (let attempt = 0; attempt < 12 && !inviteCode; attempt++) {
      const candidate = generateInviteCode()
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.inviteCode, candidate))
        .limit(1)
      if (!taken) inviteCode = candidate
    }
    if (!inviteCode) throw new Error("生成邀请码失败，请稍后重试")
  }

  await db
    .update(users)
    .set({ isPartner: 1, partnerAgreedAt: new Date(), inviteCode })
    .where(eq(users.id, userId))

  // Retroactive: scan referred users' past purchases and award commissions
  const referredUsers = await db
    .select({
      userId: users.id,
      orderId: subscriptions.paymentOrderId,
    })
    .from(users)
    .innerJoin(subscriptions, eq(users.id, subscriptions.userId))
    .where(eq(users.referredBy, userId))

  for (const row of referredUsers) {
    if (!row.orderId) continue
    const [order] = await db
      .select({ amount: paymentOrdersTable.amount })
      .from(paymentOrdersTable)
      .where(and(eq(paymentOrdersTable.id, row.orderId), eq(paymentOrdersTable.status, "paid")))
      .limit(1)
    if (order?.amount) {
      // 追溯扫描刻意保持"失败不阻断"：这是合伙人开通之后的补记，
      // 让它把整笔开通事务炸掉更糟。但必须留下可检索的 CRITICAL 痕迹 ——
      // 这一档没有重试路径，靠日志人工补。
      await triggerCommission(row.userId, row.orderId, order.amount).catch((e) =>
        console.error(
          `[Partner] CRITICAL: 追溯佣金写入失败，需人工补记 referredUserId=${row.userId} orderId=${row.orderId}`,
          e,
        )
      )
    }
  }
}

async function triggerCommission(
  userId: string,
  orderId: string,
  orderAmount: number
): Promise<void> {
  if (!db) return

  const [buyer] = await db
    .select({ referredBy: users.referredBy, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!buyer?.referredBy) return

  // Only trigger commission if buyer registered within the 90-day attribution window.
  // Use the order timestamp (not Date.now()) so delayed payment notifications don't skip commission.
  let orderTime = Date.now()
  if (orderId) {
    const [order] = await db
      .select({ createdAt: paymentOrdersTable.createdAt })
      .from(paymentOrdersTable)
      .where(eq(paymentOrdersTable.id, orderId))
      .limit(1)
    if (order?.createdAt) orderTime = new Date(order.createdAt).getTime()
  }
  const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
  if (!buyer.createdAt || orderTime - new Date(buyer.createdAt).getTime() > ATTRIBUTION_WINDOW_MS) return

  // ── 推广资格在 2026-09-29 已与付费解绑：任何注册用户都能拿佣金 ──────────────
  //
  // ⚠️ 下面这两行是《禁止传销条例》第七条(二)「变相入门费」在**数据层的唯一落点**。
  //
  // 改动前它是 `if (!partner || !partner.isPartner) return`，语义是"付过 ¥399 合伙人
  // 才能拿现金佣金"——这正是当初九个审查要件里**唯一命中**的那个，而且是权重最高的：
  // 交费取得的是"发展他人加入的资格"，命中七(二)；而单级直推只让人通过七(三)。
  //
  // 现在推广资格对全部注册用户开放，付费档只剩学习权益。
  // **不要再把任何付费条件加回这里** —— 那会立刻恢复原来的法律风险，
  // 而且是在用户完全看不见的地方。依据见 docs/distribution-compliance.md。
  const [partner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, buyer.referredBy))
    .limit(1)

  if (!partner) return

  // 「首购」只看真正结算过的佣金。被退款扣回的记录（clawed_back）等于从没
  // 结算过：如果把它也算进去，被邀请人退款后重新购买会被判成续费，佣金从 50%
  // 掉到 30%，合伙人替平台承担了退款成本。
  const [{ cnt }] = await db
    .select({ cnt: sqlCount() })
    .from(partnerCommissions)
    .where(
      and(
        eq(partnerCommissions.referredUserId, userId),
        ne(partnerCommissions.status, "clawed_back")
      )
    )

  const isFirst = Number(cnt) === 0
  const rate = isFirst ? 0.5 : 0.3
  const commissionAmount = Math.floor(orderAmount * rate)
  const availableAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)

  try {
    await db.insert(partnerCommissions).values({
      id: randomUUID(),
      partnerId: partner.id,
      orderId,
      referredUserId: userId,
      grossAmount: orderAmount,
      commissionAmount,
      rate: String(rate),
      commissionType: isFirst ? "first" : "renewal",
      status: "cooling",
      availableAt,
    })
  } catch (err) {
    // 撞唯一键 idx_pc_order_id = 这一单已经结算过（微信重试回调必然走到），
    // 属于正常的幂等结果，静默返回。
    if (classifyCommissionWriteError(err) === "already_awarded") return
    // 其余是真故障：**必须抛出去**。此前这里是 fire-and-forget，进程抖动就
    // 让这笔佣金永久消失（没有重试、也没有定时任务补偿）。抛出去 → 回调 500
    // → 微信重试 → activateSubscription 的幂等分支再补一次，即可自愈。
    throw new CommissionWriteError(orderId, err)
  }
}

export async function activateSubscription(
  userId: string,
  plan: PlanKey,
  paymentOrderId?: string,
  orderAmount?: number
) {
  if (!db) throw new Error("Database not configured")

  const days = planDurationDays(plan)

  // Idempotency: if this payment order was already processed, skip duplicate activation
  if (paymentOrderId) {
    const [dup] = await db
      .select({ id: subscriptions.id, expiresAt: subscriptions.expiresAt })
      .from(subscriptions)
      .where(eq(subscriptions.paymentOrderId, paymentOrderId))
      .limit(1)
    if (dup) {
      // 幂等：该订单已经开通过订阅。此前直接 return，若上一次在"写入订阅"之后、
      // "更新用户权益"之前失败，就会永久留下"有订阅但没会员"的状态；这里把
      // 用户权益补齐再返回。
      if (dup.expiresAt && new Date(dup.expiresAt) > new Date()) {
        await db
          .update(users)
          .set({ isPro: 1, proExpires: dup.expiresAt })
          .where(eq(users.id, userId))
      }
      // 补一次佣金写入：上一次可能在"写入订阅"之后、"写入佣金"之前失败
      // （佣金原先是 fire-and-forget，那条路径失败不会有任何重试）。
      // 幂等由 partner_commissions.order_id 的唯一索引保证，重复调用安全；
      // 若这次仍失败就继续抛，交给微信的回调重试再试。
      if (paymentOrderId && orderAmount) {
        await triggerCommission(userId, paymentOrderId, orderAmount)
      }
      console.warn(`[Subscription] Duplicate activation skipped for paymentOrder: ${paymentOrderId}`)
      return
    }
  }

  const [existing] = await db
    .select({ expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .limit(1)

  const startsAt = new Date()
  const baseDate = existing?.expiresAt ? new Date(existing.expiresAt) : startsAt
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)

  await db.insert(subscriptions).values({
    userId,
    plan,
    status: "active",
    paymentOrderId: paymentOrderId || null,
    startsAt,
    expiresAt,
  })

  await db
    .update(users)
    .set({ isPro: 1, proExpires: expiresAt })
    .where(eq(users.id, userId))

  if (plan === "partner") {
    await grantPartnerAccess(userId)
  }
  // 佣金：与订阅开通同一条路径，且**必须 await**。
  // 原来这里是 `void ... .catch(console.error)` —— 记账失败时用户已经拿到会员，
  // 而合作方的佣金永久消失。现在让它抛出去：payment/notify 返回 500 → 微信重试
  // → 上面的幂等分支再补一次，最终要么记上、要么在日志里留下明确的失败。
  if (paymentOrderId && orderAmount) {
    await triggerCommission(userId, paymentOrderId, orderAmount)
  }

  return { plan, startsAt, expiresAt }
}

/**
 * 顺手把已过期的会员权益回收掉。
 *
 * 返回「本次是否真的回收了」：调用方若在调用前就读过 users 行，那份快照已经
 * 过期，必须据此修正，否则会把 is_pro:true 回给一个刚被降级的用户。
 */
export async function checkAndExpirePro(userId: string): Promise<boolean> {
  if (!db) return false

  const [user] = await db
    .select({ proExpires: users.proExpires })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (user?.proExpires && new Date(user.proExpires) <= new Date()) {
    await db
      .update(subscriptions)
      .set({ status: "expired" })
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active"),
          lte(subscriptions.expiresAt, new Date())
        )
      )

    await db
      .update(users)
      .set({ isPro: 0, proExpires: null })
      .where(eq(users.id, userId))

    return true
  }

  return false
}

/**
 * 「此刻真的还是会员」的统一口径。
 *
 * 为什么需要它：`users.is_pro` 是一个**标记**，不是事实 —— 它只在
 * `checkAndExpirePro` 被调用的那一刻才被回收，而后者只挂在三个接口上
 * （`/api/auth/me`、`/api/subscription/status`、`/api/courses/sentences`）。
 * 于是**再也不回来的用户会一直挂着 `is_pro=1`**：2026-09-27 实测线上有 18 行
 * （全是注册时领的 3 天体验会员，早已过期），把后台的会员数从真实的 3 抬到 21。
 *
 * 所以凡是**统计、筛选、展示**会员身份的地方，都必须按下面的口径算，
 * 而不是直接读标记。它们与 checkAndExpirePro 同义（那条规则是权威）：
 * **只有 pro_expires 非空且已过期才算失效**；`pro_expires IS NULL` 表示不设到期，
 * 仍算会员（历史遗留的"永久会员"就是这种形态）。
 *
 * 反过来，**权限判定**仍然可以继续读标记 + 先调 checkAndExpirePro
 * （那条路径会当场把自己修正过来），不要为了统一而改动鉴权逻辑。
 */
export function activeProSql(): SQL<boolean> {
  return sql<boolean>`(${users.isPro} = 1 AND (${users.proExpires} IS NULL OR ${users.proExpires} > NOW()))`
}

/** 同上的纯函数版本：用于把已取回的行走一遍（例如接口返回前的映射、单测）。 */
export function isProActive(
  user: { isPro?: number | boolean | null; proExpires?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!user) return false
  if (!user.isPro) return false
  if (user.proExpires === null || user.proExpires === undefined) return true
  const expires = user.proExpires instanceof Date ? user.proExpires : new Date(user.proExpires)
  if (Number.isNaN(expires.getTime())) return false
  return expires.getTime() > now.getTime()
}

/**
 * 「此刻仍然生效」的订阅口径，与 activeProSql 同一类问题的另一面：
 * `subscriptions.status='active'` 同样只在 checkAndExpirePro 被调用时才回收，
 * 所以到期未清理的行会一直留在 active 上。
 *
 * 仪表盘「活跃订阅」与订阅列表的 `status=active` **必须**共用这一份 ——
 * 否则卡片上的数字与点进去的列表条数对不上（这条不变量有 e2e 钉着）。
 */
export function activeSubscriptionSql(): SQL<boolean> {
  return sql<boolean>`(${subscriptions.status} = 'active' AND (${subscriptions.expiresAt} IS NULL OR ${subscriptions.expiresAt} > NOW()))`
}

/** 同上的纯函数版本。 */
export function isSubscriptionActive(
  sub: { status?: string | null; expiresAt?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!sub) return false
  if (sub.status !== "active") return false
  if (sub.expiresAt === null || sub.expiresAt === undefined) return true
  const expires = sub.expiresAt instanceof Date ? sub.expiresAt : new Date(sub.expiresAt)
  if (Number.isNaN(expires.getTime())) return false
  return expires.getTime() > now.getTime()
}

export async function getActiveSubscription(userId: string) {
  if (!db) return null

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1)

  return sub ?? null
}

export async function cancelSubscription(userId: string) {
  if (!db) throw new Error("Database not configured")

  const [sub] = await db
    .select({ id: subscriptions.id, paymentOrderId: subscriptions.paymentOrderId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .limit(1)

  if (!sub) throw new Error("No active subscription found")

  await db
    .update(subscriptions)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(subscriptions.id, sub.id))

  // Clawback: mark any commissions from this order as clawed_back
  if (sub.paymentOrderId) {
    await db
      .update(partnerCommissions)
      .set({ status: "clawed_back" })
      .where(eq(partnerCommissions.orderId, sub.paymentOrderId))
      .catch(() => { /* non-critical */ })
  }

  return { success: true }
}
