import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { taskLogs, coinLogs, users } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import { COIN_SHARE } from "@/lib/coins"

/**
 * 每日分享任务：领取**金币**。
 *
 * 2026-09-29 由钻石改为金币。这是一处必要的收紧，不只是换个名字：
 * 分享是零成本动作，而钻石能换真正的 AI 调用（真金白银）。改发金币之后，
 * 免费用户不再能靠"每天点一下分享"攒出付费货币 —— 那正是双货币拆分要堵的口子。
 * 金额见 lib/coins.ts 的 COIN_SHARE。
 */
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const userId = session.userId
  const today = toShanghaiDateStr()

  try {
    // 先抢占今日份额，再发金币。顺序不能反：
    //   - task_logs 的唯一键 uk_task_share_day 决定「今日是否已领」，
    //     INSERT IGNORE 冲突时 affectedRows = 0，说明今天已经领过，直接不发；
    //   - 只有确实插入成功（affectedRows > 0）才继续写 coin_logs 与加余额；
    //   - 整体放在一个事务里，发币失败会连同 task_log 一起回滚，用户可重试，
    //     不会出现「名额被占掉但金币没到账」。
    const claimed = await db.transaction(async (tx) => {
      const claimResult = await tx
        .insert(taskLogs)
        .ignore()
        .values({
          userId,
          taskType: "share_invite",
          // 2026-09-29：由 diamond 改为 coin
          rewardType: "coin",
          rewardAmount: COIN_SHARE,
          date: today,
        })

      // drizzle 的 mysql2 insert 返回 [ResultSetHeader, ...]
      const affected = Array.isArray(claimResult)
        ? Number((claimResult[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0)
        : 0
      if (affected === 0) return false

      await tx.insert(coinLogs).values({
        userId,
        amount: COIN_SHARE,
        type: "share_invite",
        date: today,
      })

      await tx.update(users)
        .set({ coins: sql`${users.coins} + ${COIN_SHARE}` })
        .where(eq(users.id, userId))

      return true
    })

    if (!claimed) {
      return NextResponse.json({ success: false, alreadyClaimed: true, coinsEarned: 0 })
    }

    return NextResponse.json({ success: true, alreadyClaimed: false, coinsEarned: COIN_SHARE })
  } catch (e) {
    console.error("[tasks/share]", e)
    return NextResponse.json({ error: "领取失败，请稍后重试" }, { status: 500 })
  }
}
