/**
 * 一次性数据迁移：把「应用写入的 DATETIME」从 UTC 墙上时间对齐到 +08 墙上时间。
 *
 * 背景
 * ----
 * drizzle 的 MySqlDateTime 映射是纯 UTC 的（mapToDriverValue 用 toISOString，
 * mapFromDriverValue 用 str + "Z"），完全绕开 mysql2 的 timezone 选项。因此同一
 * 个库里长期并存两种口径：
 *
 *   - MySQL 默认值 CURRENT_TIMESTAMP / NOW()（连接已 SET time_zone='+08:00'）
 *     → +08 墙上时间
 *   - 应用把 JS Date 交给 drizzle 写入
 *     → UTC 墙上时间
 *
 * 代码侧已在 src/lib/db/index.ts 里把 drizzle 的映射统一到 +08（见
 * patchDatetimeMapping）。本脚本负责把**已经写进库里的 UTC 值 +8 小时**，
 * 使其与新口径一致。
 *
 * 不变量：迁移前后，应用读到的「绝对时刻」完全不变。迁移只改变磁盘上的
 * 表示法，不会延长/缩短任何人的会员期限、会话有效期或复习计划。
 *
 * 唯一例外是 user_notes.updated_at：它的初始值来自 MySQL 默认值（+08），
 * 只有被 PUT 更新过的行才是应用写入（UTC）。用 `updated_at <> created_at`
 * 区分这两类，绝不能整列无差别 +8。
 *
 * 幂等性：site_config 里有一行标记，重复执行会直接拒绝。
 *
 * 用法：
 *   npx tsx scripts/migrations/2026-09-23-datetime-tz-align.ts            # 试运行
 *   npx tsx scripts/migrations/2026-09-23-datetime-tz-align.ts --apply    # 实际执行
 */
import "dotenv/config"
import mysql from "mysql2/promise"

const MARKER_KEY = "migration_datetime_tz_align_2026_09_23"
const APPLY = process.argv.includes("--apply")

/** 需要 +8 小时的列。where 用来排除"本来就是 +08"的行。 */
const TARGETS: Array<{ table: string; column: string; where?: string; note: string }> = [
  { table: "users", column: "pro_expires", where: "pro_expires IS NOT NULL", note: "试用/会员到期（含试用、月付、年付、合伙人）" },
  { table: "users", column: "partner_agreed_at", where: "partner_agreed_at IS NOT NULL", note: "合伙人协议时间" },
  { table: "users", column: "wechat_token_expires_at", where: "wechat_token_expires_at IS NOT NULL", note: "微信 access_token 过期" },
  { table: "users", column: "referral_locked_until", where: "referral_locked_until IS NOT NULL", note: "（已废弃字段）" },
  { table: "sessions", column: "expires_at", note: "登录会话" },
  { table: "verification_codes", column: "expires_at", note: "短信验证码有效期" },
  { table: "review_queue", column: "next_review_at", note: "复习计划下一次到期" },
  { table: "payment_orders", column: "paid_at", where: "paid_at IS NOT NULL", note: "支付完成时间" },
  { table: "payment_orders", column: "expires_at", where: "expires_at IS NOT NULL", note: "订单有效期" },
  { table: "subscriptions", column: "starts_at", note: "订阅开始" },
  { table: "subscriptions", column: "expires_at", note: "订阅到期" },
  { table: "subscriptions", column: "cancelled_at", where: "cancelled_at IS NOT NULL", note: "订阅取消时间" },
  { table: "partner_commissions", column: "available_at", note: "佣金解冻时间" },
  { table: "withdrawal_requests", column: "completed_at", where: "completed_at IS NOT NULL", note: "提现完成时间" },
  { table: "user_course_progress", column: "last_studied_at", note: "最后学习时间" },
  { table: "user_notes", column: "updated_at", where: "updated_at <> created_at", note: "只处理被 PUT 更新过的行（created_at 是 +08 默认值，未更新过的行与它相等）" },
  { table: "site_config", column: "updated_at", where: "updated_at <> CURRENT_TIMESTAMP", note: "（当前无应用写入）" },
]

function targetWhere(t: { column: string; where?: string }): string {
  return t.where ? `WHERE ${t.where}` : ""
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("缺少 DATABASE_URL")

  const conn = await mysql.createConnection({ uri: url, timezone: "+08:00", multipleStatements: false })
  try {
    const [markerRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT `key` FROM site_config WHERE `key` = ?",
      [MARKER_KEY]
    )
    if (markerRows.length > 0) {
      console.log(`已执行过（site_config.${MARKER_KEY} 存在），本次不做任何修改。`)
      return
    }

    console.log(`数据库：${url.replace(/:[^:@/]+@/, ":***@")}`)
    console.log(`模式：${APPLY ? "实际执行" : "试运行（加 --apply 才写入）"}\n`)

    let totalRows = 0
    for (const t of TARGETS) {
      const where = targetWhere(t)
      const [[cnt]] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM \`${t.table}\` ${where}`
      )
      const n = Number(cnt.c)
      totalRows += n
      console.log(`  ${t.table}.${t.column}: ${n} 行  — ${t.note}`)
    }
    console.log(`\n合计 ${totalRows} 行将被 +8 小时。`)

    // 迁移前的口径证据：应用写入的 pro_expires 相对 MySQL 默认值的 created_at 应差 64 小时
    const [[before]] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(MINUTE, created_at, pro_expires) AS d FROM users
       WHERE pro_expires IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    )
    console.log(`迁移前：最新一条 users 的 (pro_expires - created_at) = ${before?.d} 分钟（应为 3840 = 72h-8h）`)

    if (!APPLY) {
      console.log("\n试运行结束，未做任何修改。")
      return
    }

    await conn.beginTransaction()
    for (const t of TARGETS) {
      const [res] = await conn.query<mysql.ResultSetHeader>(
        `UPDATE \`${t.table}\` SET \`${t.column}\` = DATE_ADD(\`${t.column}\`, INTERVAL 8 HOUR) ${targetWhere(t)}`
      )
      console.log(`  ${t.table}.${t.column}: 更新 ${res.affectedRows} 行`)
    }
    await conn.query(
      "INSERT INTO site_config (`key`, value, updated_at) VALUES (?, CAST(? AS JSON), NOW())",
      [MARKER_KEY, JSON.stringify({ appliedAt: new Date().toISOString(), rows: totalRows })]
    )
    await conn.commit()

    const [[after]] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(MINUTE, created_at, pro_expires) AS d FROM users
       WHERE pro_expires IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    )
    console.log(`\n迁移后：同一行 (pro_expires - created_at) = ${after?.d} 分钟（应为 4320 = 72h）`)
    console.log("完成。")
  } finally {
    await conn.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
