import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { peekRateLimit } from "@/lib/rate-limit"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { isProActive } from "@/lib/subscription"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import {
  DAY_MS,
  FREE_PRONUNCIATION_PER_DAY,
  PRO_PRONUNCIATION_PER_DAY,
} from "@/lib/membership-benefits"

/**
 * 跟读评分的剩余额度（**只读**）。
 *
 * ── 为什么需要这个接口 ──────────────────────────────────────────────────────
 *
 * 基准实现口语模式在**开口之前**就会显示「今日评测次数已用完」卡片：
 * `speaking.js:145 updateSpeakingLimitUI` 在状态回到 `idle` 时跑一次，数据来自
 * `GET /Ise/Api/CheckLimit`（`:184 refreshSpeakingLimitState`）。我们没有那个
 * 接口。若不做这一步，只能等用户按下录音、被 `POST /api/youdao/evaluate`
 * 用 429 `quota_exhausted` 拒绝后才知道没额度 —— 那是一次白录，
 * 用户对着麦克风读完一整句才被告知「今天没次数了」。
 *
 * ── 为什么不能用 `checkRateLimit` ───────────────────────────────────────────
 *
 * 它是「判 + 记账」一体：拿它来查询会**白扣一次额度**。用户每刷新一次页面
 * 就少一次评测机会，这比没有卡片更糟。所以用 `peekRateLimit`
 * （`lib/rate-limit.ts`），它与 `checkRateLimit` 共用同一个桶和同一条判据，
 * 保证「查询说还有额度」与「真的能评」不会自相矛盾。
 *
 * ── 返回口径与 evaluate 路由严格同源 ────────────────────────────────────────
 *
 * 桶名 `youdao-evaluate-user-daily`、键 `${userId}:${上海日历日}`、窗口一天、
 * 额度按会员身份区分 —— 全部照抄 `api/youdao/evaluate/route.ts:126-141`。
 * 两处一旦漂移，会出现「这里说还有 1 次、点下去却被 429」的鬼故事。
 *
 * **刻意不做的一件事**：基准实现对合伙人（`isPartnerMember`）直接放行
 * （`speaking.js:123`），我们**不**照抄。因为 evaluate 路由只认
 * `isProActive`，合伙人并不豁免 —— 在这里显示「无限次」而路由照旧 429，
 * 界面就撒了谎。要开这个口子必须先改路由，那是单独的决定。
 */
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const [viewer] = db
    ? await db
        .select({ isPro: users.isPro, proExpires: users.proExpires })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1)
    : []
  const isPro = isProActive(viewer)
  const maxCount = isPro ? PRO_PRONUNCIATION_PER_DAY : FREE_PRONUNCIATION_PER_DAY

  const peek = peekRateLimit(
    "youdao-evaluate-user-daily",
    `${session.userId}:${toShanghaiDateStr()}`,
    maxCount,
    DAY_MS,
  )

  return NextResponse.json({
    allowed: peek.allowed,
    used: peek.used,
    maxCount,
    remaining: peek.remaining,
    // 与 evaluate 路由的 429 文案同源（`membership-benefits` 里的数值），
    // 保证「卡片上的说法」与「被拒时的说法」一致。
    message: peek.allowed
      ? ""
      : isPro
        ? `今日评测次数已用完（会员每天 ${PRO_PRONUNCIATION_PER_DAY} 次），请明天再来`
        : `今日免费评测次数已用完（每天 ${FREE_PRONUNCIATION_PER_DAY} 次），开通会员可提升至每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
    // 免费用户被拒时才引导升级；会员被拒（已用完 30 次）升级也没用。
    needUpgrade: !peek.allowed && !isPro,
    isPro,
  })
}
