import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { taskLogs, diamondLogs, users } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"
import { toShanghaiDateStr } from "@/lib/practice-stats"

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const userId = session.userId

  try {
    // 先抢占今日份额，再发钻石。顺序不能反：
    //   - task_logs 的唯一键 uk_task_user_type_date 决定「今日是否已领」，
    //     INSERT IGNORE 冲突时 affectedRows = 0，说明今天已经领过，直接不发钻石；
    //   - 只有确实插入成功（affectedRows > 0）才继续写 diamond_logs 与加余额；
    //   - 整体放在一个事务里，发钻石失败会连同 task_log 一起回滚，用户可重试，
    //     不会出现「名额被占掉但钻石没到账」。
    const claimed = await db.transaction(async (tx) => {
      const claimResult = await tx
        .insert(taskLogs)
        .ignore()
        .values({
          userId,
          taskType: "share_invite",
          rewardType: "diamond",
          rewardAmount: 10,
          date: toShanghaiDateStr(),
        })

      // drizzle 的 mysql2 insert 返回 [ResultSetHeader, ...]
      const affected = Array.isArray(claimResult)
        ? Number((claimResult[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0)
        : 0
      if (affected === 0) return false

      await tx.insert(diamondLogs).values({
        userId,
        amount: 10,
        type: "share_invite",
      })

      await tx.update(users)
        .set({ diamonds: sql`${users.diamonds} + 10` })
        .where(eq(users.id, userId))

      return true
    })

    if (!claimed) {
      return NextResponse.json({ success: false, alreadyClaimed: true })
    }

    return NextResponse.json({ success: true, alreadyClaimed: false })
  } catch (e) {
    console.error("[tasks/share]", e)
    return NextResponse.json({ error: "领取失败，请稍后重试" }, { status: 500 })
  }
}
