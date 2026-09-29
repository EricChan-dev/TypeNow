import { NextResponse } from "next/server"
import { createHash, timingSafeEqual } from "crypto"
import { db } from "@/lib/db"
import { practiceRecords, reviewQueue, subscriptions, users } from "@/lib/db/schema"
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm"
import {
  EXPIRY_SCENARIOS,
  SCENARIO_KEYS,
  computeDueExpiryScenarios,
  expiryPeriodKey,
  findScenario,
  dailyPeriodKey,
  type LifecycleScenario,
  type LifecycleTier,
} from "@/lib/lifecycle-scenarios"
import {
  getFrequencyState,
  sendLifecycleMessage,
  usableChannels,
  type NotifyOutcome,
  type NotifyTarget,
} from "@/lib/notify"

/**
 * 主动触达的扫描入口。由服务器 crontab 每天 10:00 / 19:00 各调用一次
 * （见 deploy.sh 的 crontab 安装步骤）。设计见 docs/business-model.md §11.5 ①。
 *
 * ── 三条安全约定，改动时不要放宽 ────────────────────────────────────────────
 *
 * ① **不接受任何入参。** 触发条件全部由服务端时间与数据库推导。
 *    一个"能指定收件人"的接口等于把公众号变成了群发器 —— 那既是骚扰风险，
 *    也是《个人信息保护法》意义上的违规处理。所以带任何查询参数一律 400。
 *
 * ② **鉴权 fail-closed。** `CRON_SECRET` 未配置时**拒绝所有请求**，
 *    而不是"没配就放行"。理由与 webhook 一样：这个入口一旦敞开，
 *    任何人都能反复触发全量扫描。
 *
 * ③ **全局开关默认关闭。** 只有显式设置 `LIFECYCLE_ENABLED=true` 才会真正发送。
 *    主动发消息这件事，发错比不发糟得多（骚扰用户 + 公众号接口权限风险），
 *    所以默认值取"不发"。上线时显式打开。
 *
 * ── 单个用户异常不中断整批 ──────────────────────────────────────────────────
 *
 * 每个用户、每个场景都独立 try/catch。一个用户的脏数据（比如 openid 异常）
 * 不该让整批触达停摆 —— 那批人里有收入最直接的触点。
 */

/** 单次扫描最多处理多少用户。防止一次异常数据把整批发送拉成长事务。 */
const SCAN_BATCH_LIMIT = 500

/** 模板消息点击后的落地页（转化设计放在那里，不放在消息里，§11.4）。 */
const LANDING_URL = "https://typenow.cn/home/membership"

type ScanCounters = {
  scanned: number
  sent: number
  skipped: number
  duplicate: number
  failed: number
  errors: string[]
}

function newCounters(): ScanCounters {
  return { scanned: 0, sent: 0, skipped: 0, duplicate: 0, failed: 0, errors: [] }
}

function tally(counters: ScanCounters, outcome: NotifyOutcome) {
  switch (outcome.status) {
    case "sent":
      counters.sent++
      break
    case "skipped":
      counters.skipped++
      break
    case "duplicate":
      counters.duplicate++
      break
    case "failed":
      counters.failed++
      break
    case "db_unavailable":
      counters.failed++
      break
  }
}

/**
 * 常量时间比较密钥。
 *
 * ⚠️ 必须先比长度：`timingSafeEqual` 在两个 buffer 长度不同时抛 RangeError。
 * webhook-server.js 里为这个坑写过一段注释 —— 那里它位于 req 的 end 回调里，
 * 抛出去就是未捕获异常、直接打挂进程，于是"任何人发一个长度不对的头就能让
 * webhook 崩溃重启"。这里虽然是请求处理器（抛错只 500），也不该留下这个形状。
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false
  // 先各自哈希到定长再比：既避免长度不等抛错，也让比较不泄露长度信息
  const a = createHash("sha256").update(provided).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

/** 每个用户的发送上下文（学习数字用于个性化文案，§11.4）。 */
async function loadStats(userId: string): Promise<{ practiced: number; pendingReview: number }> {
  const database = db!
  const now = new Date()
  const [[p], [r]] = await Promise.all([
    database
      .select({ n: sql<number>`COUNT(DISTINCT ${practiceRecords.sentenceId})` })
      .from(practiceRecords)
      .where(eq(practiceRecords.userId, userId)),
    database
      .select({ n: sql<number>`COUNT(*)` })
      .from(reviewQueue)
      .where(
        and(
          eq(reviewQueue.userId, userId),
          eq(reviewQueue.status, "pending"),
          lte(reviewQueue.nextReviewAt, now)
        )
      ),
  ])
  return { practiced: Number(p?.n ?? 0), pendingReview: Number(r?.n ?? 0) }
}

const TIER_LABELS: Record<LifecycleTier, string> = {
  trial: "体验会员",
  monthly: "月度会员",
  quarterly: "季度会员",
  yearly: "年度会员",
  partner: "终身会员",
}

/** 发一条，并把结果计入统计。任何异常都只记录、不抛出。 */
async function attemptSend(
  counters: ScanCounters,
  params: {
    scenario: LifecycleScenario
    periodKey: string
    target: NotifyTarget
    tier: LifecycleTier
    expiry?: Date
    now: Date
  }
): Promise<void> {
  const { scenario, periodKey, target, tier, expiry, now } = params
  try {
    // 频控状态按用户查两次即可，但这里每个场景查一次更简单，
    // 且扫描量级很小（每天两次、每次上限 500 人）。
    const frequency = await getFrequencyState(target.userId, EXPIRY_SCENARIO_KEYS, now)
    const stats = await loadStats(target.userId)

    const outcome = await sendLifecycleMessage({
      scenario,
      periodKey,
      target,
      expiry,
      tierLabel: TIER_LABELS[tier],
      practicedSentences: stats.practiced,
      pendingReview: stats.pendingReview,
      landingUrl: LANDING_URL,
      frequency,
      now,
    })
    tally(counters, outcome)
  } catch (e) {
    counters.failed++
    counters.errors.push(`${scenario.key}/${target.userId}: ${e instanceof Error ? e.message : String(e)}`)
    console.error("[lifecycle-scan] 单用户发送异常（已跳过，不中断整批）:", scenario.key, target.userId, e)
  }
}

/** 只取带 window 的场景键，用于频控里排除"到期类"。 */
const EXPIRY_SCENARIO_KEYS: readonly string[] = EXPIRY_SCENARIOS.map((s) => s.key)

export async function POST(request: Request) {
  // ③ 全局开关：默认关闭（fail-closed）
  if (process.env.LIFECYCLE_ENABLED !== "true") {
    return NextResponse.json(
      { ok: false, code: "disabled", message: "LIFECYCLE_ENABLED 未设为 true，未执行任何发送。" },
      { status: 503 },
    )
  }

  // ② 鉴权：fail-closed
  const expected = process.env.CRON_SECRET ?? ""
  if (!expected) {
    return NextResponse.json(
      { ok: false, code: "unconfigured", message: "CRON_SECRET 未配置，拒绝所有请求。" },
      { status: 503 },
    )
  }
  if (!secretMatches(request.headers.get("x-cron-secret"), expected)) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 })
  }

  // ① 不接受任何入参
  const url = new URL(request.url)
  if ([...url.searchParams.keys()].length > 0) {
    return NextResponse.json(
      { ok: false, code: "params_not_allowed", message: "本接口不接受任何参数。" },
      { status: 400 },
    )
  }

  if (!db) {
    return NextResponse.json({ ok: false, code: "db_unavailable" }, { status: 503 })
  }
  const database = db
  const now = new Date()

  const expiry = newCounters()
  const others = newCounters()

  // ── 到期类：按"有效到期时刻"挑候选 ────────────────────────────────────────
  //
  // 有效到期时刻 = COALESCE(pro_expires, last_expiry_at)：
  // 有效会员取前者（未来时间），已过期取后者（checkAndExpirePro 清空 pro_expires 时写入）。
  // 只用 pro_expires 会让「已到期挽回」永远查不到人，见 00032 的说明。
  const fromHours = Math.min(...EXPIRY_SCENARIOS.map((s) => s.window!.from))
  const toHours = Math.max(...EXPIRY_SCENARIOS.map((s) => s.window!.to))
  const H = 60 * 60 * 1000
  const expiryUpper = new Date(now.getTime() - fromHours * H) // 最早可触及的到期时刻
  const expiryLower = new Date(now.getTime() - toHours * H) // 最晚可触及的到期时刻

  const effectiveExpiry = sql`COALESCE(${users.proExpires}, ${users.lastExpiryAt})`

  const candidates = await database
    .select({
      id: users.id,
      openid: users.wechatOpenid,
      phone: users.phone,
      nickname: users.name,
      optOutAt: users.notifyOptOutAt,
      isPartner: users.isPartner,
      proExpires: users.proExpires,
      lastExpiryAt: users.lastExpiryAt,
      trialClaimedAt: users.trialClaimedAt,
    })
    .from(users)
    .where(
      and(
        // 终身会员没有到期概念，直接在 SQL 层排除（computeDueExpiryScenarios 里还有一道）
        eq(users.isPartner, 0),
        // 退订的人在 SQL 层就排除，避免把他们捞进内存
        isNull(users.notifyOptOutAt),
        sql`${effectiveExpiry} IS NOT NULL`,
        gte(effectiveExpiry, expiryLower),
        lte(effectiveExpiry, expiryUpper)
      )
    )
    .limit(SCAN_BATCH_LIMIT)

  // 档位：优先取「最近一次订阅」的 plan；没有订阅但领过体验会员的算 trial。
  //
  // ⚠️ 这里刻意**不在 SQL 里用行级子查询 + 原始 sql 别名**。曾经那样写过，
  // 结果 drizzle 没有把那个表达式的值映射到 `tier` 这个键上（`u.tier` 是
  // undefined），于是每个用户都被判成"无档位"直接跳过 —— 表现为扫描永远
  // "scanned=1 但什么都没发生"，且没有任何报错。一次批量查询 + JS 归并
  // 虽然多一次往返，但行为是**看得见**的，不会被 ORM 的别名规则悄悄改变。
  //
  // 为什么是"最近一次"而不是 getActiveSubscription：已过期用户取不到
  // active 订阅（checkAndExpirePro 已把它标成 expired），而我们要找的
  // 恰恰是这批人。
  const planByUser = new Map<string, string>()
  if (candidates.length > 0) {
    const planRows = await database
      .select({
        userId: subscriptions.userId,
        plan: subscriptions.plan,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .where(inArray(subscriptions.userId, candidates.map((c) => c.id)))
      .orderBy(desc(subscriptions.createdAt))
    // 已按时间倒序，第一条即该用户最近一次订阅
    for (const r of planRows) {
      if (!planByUser.has(r.userId)) planByUser.set(r.userId, r.plan)
    }
  }

  for (const u of candidates) {
    expiry.scanned++
    const tier = (planByUser.get(u.id) ??
      (u.trialClaimedAt ? "trial" : null)) as LifecycleTier | null
    if (!tier) continue // 既没订阅也没领过体验会员：不推断，跳过

    const exp = u.proExpires ?? u.lastExpiryAt
    if (!exp) continue
    const expiryDate = new Date(exp)

    const due = computeDueExpiryScenarios({ now, expiry: expiryDate, tier })
    if (due.length === 0) continue

    const target: NotifyTarget = {
      userId: u.id,
      openid: u.openid ?? null,
      phone: u.phone ?? null,
      nickname: u.nickname ?? null,
      optOutAt: u.optOutAt ? new Date(u.optOutAt) : null,
    }

    for (const scenario of due) {
      // 简单渠道检查：一个可用渠道都没有就没必要查频控与学习数字（省两次查询）
      if (usableChannels(scenario, target).length === 0) {
        expiry.skipped++
        continue
      }
      await attemptSend(expiry, {
        scenario,
        // 到期类周期键 = 到期日：同一次会员周期内幂等，续费后自动换键
        periodKey: expiryPeriodKey(expiryDate),
        target,
        tier,
        expiry: expiryDate,
        now,
      })
    }
  }

  // ── 非到期类 ──────────────────────────────────────────────────────────────
  const dayKey = dailyPeriodKey(now)
  const h24 = new Date(now.getTime() - 24 * H)
  const h48 = new Date(now.getTime() - 48 * H)

  // ① 领了体验会员但 24–48 小时内一次都没练（走客服消息，正好在 48h 窗口内）
  const noPracticeScenario = findScenario("trial_claimed_no_practice")
  if (noPracticeScenario) {
    const rows = await database
      .select({
        id: users.id,
        openid: users.wechatOpenid,
        phone: users.phone,
        nickname: users.name,
        optOutAt: users.notifyOptOutAt,
      })
      .from(users)
      .where(
        and(
          eq(users.isPartner, 0),
          isNull(users.notifyOptOutAt),
          // 领取时间落在 24–48 小时前（窗口宽 24h > 15h 最大扫描间隔）
          gte(users.trialClaimedAt, h48),
          lte(users.trialClaimedAt, h24),
          // 一次都没练过
          sql`NOT EXISTS (SELECT 1 FROM practice_records p WHERE p.user_id = ${users.id})`
        )
      )
      .limit(SCAN_BATCH_LIMIT)

    for (const u of rows) {
      others.scanned++
      const target: NotifyTarget = {
        userId: u.id,
        openid: u.openid ?? null,
        phone: u.phone ?? null,
        nickname: u.nickname ?? null,
        optOutAt: u.optOutAt ? new Date(u.optOutAt) : null,
      }
      if (usableChannels(noPracticeScenario, target).length === 0) {
        others.skipped++
        continue
      }
      await attemptSend(others, {
        scenario: noPracticeScenario,
        periodKey: dayKey, // 每日键：当天只发一次
        target,
        tier: "trial",
        now,
      })
    }
  }

  // ② 注册后 24–48 小时仍未领体验会员
  const noTrialScenario = findScenario("registered_no_trial")
  if (noTrialScenario) {
    const rows = await database
      .select({
        id: users.id,
        openid: users.wechatOpenid,
        phone: users.phone,
        nickname: users.name,
        optOutAt: users.notifyOptOutAt,
      })
      .from(users)
      .where(
        and(
          eq(users.isPartner, 0),
          isNull(users.notifyOptOutAt),
          isNull(users.trialClaimedAt),
          gte(users.createdAt, h48),
          lte(users.createdAt, h24)
        )
      )
      .limit(SCAN_BATCH_LIMIT)

    for (const u of rows) {
      others.scanned++
      const target: NotifyTarget = {
        userId: u.id,
        openid: u.openid ?? null,
        phone: u.phone ?? null,
        nickname: u.nickname ?? null,
        optOutAt: u.optOutAt ? new Date(u.optOutAt) : null,
      }
      if (usableChannels(noTrialScenario, target).length === 0) {
        others.skipped++
        continue
      }
      await attemptSend(others, {
        scenario: noTrialScenario,
        periodKey: dayKey,
        target,
        tier: "trial",
        now,
      })
    }
  }

  const summary = {
    ok: true,
    at: now.toISOString(),
    expiry: { ...expiry, errors: expiry.errors.slice(0, 20) },
    others: { ...others, errors: others.errors.slice(0, 20) },
    scenarioKeys: SCENARIO_KEYS,
  }
  // 不主动抛错：cron 只关心 HTTP 状态。逐用户失败已计入 counters。
  return NextResponse.json(summary)
}
