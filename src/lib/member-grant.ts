import { db } from "@/lib/db"
import { diamondLogs, users } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"
import { affectedRows } from "@/lib/db/affected-rows"
import { isProActive } from "@/lib/subscription"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import { MEMBER_DAILY_DIAMONDS } from "@/lib/membership-benefits"

/**
 * 会员每日赠送钻石 —— **懒发放**，不需要任何定时任务。
 *
 * ── 为什么不做「每月 1 号发一大笔」 ──────────────────────────────────────────
 *
 * 句乐部的做法是「会员每月自动获得 10,000 颗钻石，在会员周期开始日重置」。
 * 那需要定时任务或周期计算，而本仓库**没有任何定时任务**
 * （`lib/commission-safety.ts` 明确说明了这点，它自己也是靠懒补偿规避的）。
 *
 * 这里换成「用户每次进站时补发当日份」：触发点是普通请求，天然幂等，
 * 而且不怕漏跑 —— 用户下一天进站时补的就是那一天。代价是"不进站就不到账"，
 * 但钻石本来就只在站内消费（AI 助手），所以这个代价不成立。
 *
 * ── 幂等靠数据库，不靠代码 ──────────────────────────────────────────────────
 *
 * `diamond_logs` 上有 `uk_diamond_grant_day (user_id, grant_day)` 唯一索引，
 * 而 `grant_day` **只有 member_grant 类型的行才有值**（其余为 NULL，
 * MySQL 唯一索引允许多个 NULL）。于是「一天只发一次」成为数据库约束：
 *
 *   · 并发（用户开两个标签页同时进站）→ 第二个 INSERT 命中唯一键 → affectedRows = 0
 *   · 顺序重复调用 → 同上
 *
 * 用 `INSERT IGNORE` + affectedRows 判断，而不是「先 SELECT 再 INSERT」——
 * 后者在并发下两边都会查到"没发过"，然后各发一份。
 *
 * ── 为什么包在事务里 ────────────────────────────────────────────────────────
 *
 * 流水写成功、余额更新失败会留下「有赠钻记录但余额没加」的静默不一致。
 * 放进事务后要么都成，要么都不成，下一次进站重试即可。
 *
 * @returns 本次实际补发的钻石数（0 表示今天已发过 / 不是会员 / 未配置数据库）
 */
export async function ensureDailyMemberGrant(userId: string): Promise<number> {
  if (!db) return 0
  const database = db

  const [viewer] = await database
    .select({ isPro: users.isPro, proExpires: users.proExpires })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  // 非会员不发。注意用 isProActive 而不是裸 isPro：过期但还没被懒回收的账号
  // is_pro 仍是 1，那种情况不该继续发钻石。
  if (!isProActive(viewer)) return 0

  const today = toShanghaiDateStr()

  const granted = await database.transaction(async (tx) => {
    const result = await tx
      .insert(diamondLogs)
      .ignore()
      .values({
        userId,
        amount: MEMBER_DAILY_DIAMONDS,
        type: "member_grant",
        grantDay: today,
      })

    if (affectedRows(result) === 0) return false

    await tx
      .update(users)
      .set({ diamonds: sql`${users.diamonds} + ${MEMBER_DAILY_DIAMONDS}` })
      .where(eq(users.id, userId))

    return true
  })

  return granted ? MEMBER_DAILY_DIAMONDS : 0
}
