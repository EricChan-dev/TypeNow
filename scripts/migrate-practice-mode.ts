#!/usr/bin/env tsx
/**
 * practice_sessions 增加 mode 列，恢复槽位由「每课时一行」改为「每课时每模式一行」。
 *
 * 背景：基准实现有四种模式（听写/拼图/学习/口语），每种模式各自记录练到第几句。
 * 原唯一索引 uk_practice_session(user_id, lesson_id) 让四种模式共用一个槽位，
 * 切换模式后恢复位置会互相覆盖 —— 表现为「上次练到第 30 句听写，切到口语再回来
 * 变成了第 0 句」。
 *
 * 幂等：重复执行会把「已应用」逐条打出来，不会报错。
 * 安全：mode 列有默认值 'dictation'，存量行自动归入听写模式，
 *       与旧行为（当时只有听写一种模式）完全一致，不丢进度。
 */
import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import mysql from "mysql2/promise"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, "..", ".env.local") })

const pool = mysql.createPool(process.env.DATABASE_URL!)

const migrations = [
  {
    label: "practice_sessions: add mode",
    sql: `ALTER TABLE practice_sessions ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'dictation'`,
  },
  {
    label: "practice_sessions: drop old unique index uk_practice_session",
    sql: `ALTER TABLE practice_sessions DROP INDEX uk_practice_session`,
  },
  {
    label: "practice_sessions: add unique index uk_practice_session (user_id, lesson_id, mode)",
    sql: `ALTER TABLE practice_sessions ADD UNIQUE INDEX uk_practice_session (user_id, lesson_id, mode)`,
  },
]

async function main() {
  const conn = await pool.getConnection()
  let ok = 0
  let fail = 0
  for (const m of migrations) {
    try {
      await conn.query(m.sql)
      console.log("✓", m.label)
      ok++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (
        msg.includes("Duplicate key name") ||
        msg.includes("already exists") ||
        msg.includes("Duplicate column name")
      ) {
        console.log("~", m.label, "(already applied)")
        ok++
      } else if (msg.includes("Can't DROP") || msg.includes("check that column/key exists")) {
        // 旧索引已经不在了（例如本脚本被跑过两次），视为已应用
        console.log("~", m.label, "(already applied)")
        ok++
      } else {
        console.error("✗", m.label, "-", msg)
        fail++
      }
    }
  }

  // 结果核对：把索引与列的真实形状打出来，不依赖上面的成功计数
  const [cols] = await conn.query(`SHOW COLUMNS FROM practice_sessions LIKE 'mode'`)
  const [idx] = await conn.query(`SHOW INDEX FROM practice_sessions WHERE Key_name = 'uk_practice_session'`)
  console.log("\nmode column:", JSON.stringify(cols))
  console.log(
    "uk_practice_session columns:",
    (idx as { Seq_in_index: number; Column_name: string }[])
      .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
      .map((r) => r.Column_name)
      .join(", ")
  )

  conn.release()
  await pool.end()
  console.log(`\n${ok} succeeded, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
