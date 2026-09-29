import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/user"
import { judgeAdmin } from "@/lib/admin-identity"
import { getActiveSubscription, checkAndExpirePro } from "@/lib/subscription"
import { ensureDailyMemberGrant } from "@/lib/member-grant"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ user: null })

  // Ensure pro status is current. 上面的 user 是回收前的快照，必须以返回值修正，
  // 否则刚过期的用户会拿到一次 is_pro:true / member_tier:"trial" 的错误响应。
  const revoked = await checkAndExpirePro(user.id)
  const isPro = revoked ? false : !!user.isPro

  // 会员每日赠钻（懒发放）。放在这里是因为 /api/auth/me 是"每次进站都会打到"的那个接口：
  // 用户一登录就把当天那份补上，不需要任何定时任务。
  // 幂等由 diamond_logs 的 uk_diamond_grant_day 保证，重复进站不会重复发。
  // 非会员调用是廉价的空操作（一次索引查询后直接返回）。
  await ensureDailyMemberGrant(user.id).catch((e) => {
    // 赠钻失败不能拖垮"我是谁"这个接口 —— 前端拿不到用户信息会白屏。
    console.error("[auth/me] 会员每日赠钻失败（不影响登录态）:", e)
  })

  // 判定收敛到 lib/admin-identity：这里曾经自己写了一份，且它的 dev 兜底
  // （无条件返回一个硬编码手机号）与 proxy/requireAdmin 不一致
  const isAdmin = judgeAdmin({ role: user.role, phone: user.phone }).isAdmin

  let memberTier: "trial" | "monthly" | "quarterly" | "yearly" | "partner" | "free" = "free"
  if (user.isPartner) {
    memberTier = "partner"
  } else if (isPro) {
    const sub = await getActiveSubscription(user.id)
    memberTier = (sub?.plan as "monthly" | "quarterly" | "yearly") ?? "trial"
  }

  // 余额必须在**赠钻之后**重读：上面的 user 是赠钻前的快照，
  // 直接用会让当天第一次进站的人看到少一天钻石的余额。
  const balances = db
    ? (await db
        .select({ diamonds: users.diamonds, coins: users.coins })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1))[0]
    : undefined

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      is_pro: isPro,
      is_partner: !!user.isPartner,
      /**
       * 是否还能领取体验会员：当前不是会员、且从未领过（按手机号一次）。
       * 前端据此决定给「免费领取体验会员」还是「开通会员」这两个不同的入口。
       */
      trial_available: !isPro && user.trialClaimedAt == null,
      level: user.level,
      member_tier: memberTier,
      /**
       * 两种货币都要回传：钻石（付费，会员每日赠送）与金币（免费，学习获得）。
       * 顶部栏同时展示两者，AI 助手用的是钻石、兑换会员用的是金币。
       */
      diamonds: balances?.diamonds ?? user.diamonds ?? 0,
      coins: balances?.coins ?? user.coins ?? 0,
      role: isAdmin ? "admin" : (user.role ?? "user"),
    },
  })
}
