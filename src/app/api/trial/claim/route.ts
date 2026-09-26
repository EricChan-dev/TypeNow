import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { claimTrial, TRIAL_DAYS } from "@/lib/trial"

/**
 * 领取体验会员（TRIAL_DAYS 天）。
 *
 * 场景：未受邀注册的新用户默认没有会员，练完每课免费的 3 句后（见 lib/free-trial）
 * 撞到付费墙，此时给一次「免费领取体验会员」的机会；受邀用户已在注册时自动领取，
 * 不会走到这里。这正是句乐部「点击会员专属内容时弹领取窗口」的落点。
 *
 * 幂等与防并发全部由 lib/trial 的条件更新负责（trial_claimed_at IS NULL
 * 且当前无有效会员），本路由不额外做「先查再写」——那会引入竞态。
 */
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  const result = await claimTrial(session.userId)

  if (result === "db_unavailable") {
    return NextResponse.json({ error: "服务未配置" }, { status: 500 })
  }

  if (result === "already_claimed") {
    // 涵盖三种情况：已领过、当前已是有效会员、用户不存在。
    // 对客户端而言都只需知道「没能领取」，不必区分（区分反而会泄露账号状态）。
    return NextResponse.json(
      { error: "体验会员每人仅可领取一次", code: "ALREADY_CLAIMED" },
      { status: 409 },
    )
  }

  return NextResponse.json({ success: true, days: TRIAL_DAYS })
}
