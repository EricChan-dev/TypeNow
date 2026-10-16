#!/usr/bin/env tsx
/**
 * 新建 sentence_favorites 表：听写页底栏「收藏句子」的存储。
 *
 * 背景：听写页底栏的星标收藏的是**句子**，与单词收藏走的
 * `wordbook_items` 是两回事——两者是两个独立接口、两份独立数据。
 * 我们的库里此前没有句子收藏的对应表。
 *
 * 幂等：重复执行会把「已存在」打出来，不会报错。
 * 安全：纯新增表，不动任何既有表；`sentence_favorites` 此前不存在，
 *       所以不存在数据迁移或覆盖的风险。
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
    label: "sentence_favorites: create table",
    sql: `CREATE TABLE sentence_favorites (
      id VARCHAR(36) NOT NULL DEFAULT (UUID()),
      user_id VARCHAR(36) NOT NULL,
      sentence_id VARCHAR(64) NOT NULL,
      course_id VARCHAR(36) NULL,
      lesson_id VARCHAR(36) NULL,
      sentence_text TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_favorite_user_sentence (user_id, sentence_id),
      KEY idx_favorite_user_time (user_id, created_at)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
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
      if (msg.includes("already exists")) {
        console.log("~", m.label, "(already applied)")
        ok++
      } else {
        console.error("✗", m.label, "-", msg)
        fail++
      }
    }
  }

  // 结果核对：把索引的真实形状打出来，不依赖上面的成功计数
  const [idx] = await conn.query(
    `SHOW INDEX FROM sentence_favorites WHERE Key_name = 'uk_favorite_user_sentence'`
  )
  console.log(
    "\nuk_favorite_user_sentence columns:",
    (idx as { Seq_in_index: number; Column_name: string }[])
      .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
      .map((r) => r.Column_name)
      .join(", ")
  )
  const [cnt] = await conn.query(`SELECT COUNT(*) AS n FROM sentence_favorites`)
  console.log("rows:", JSON.stringify(cnt))

  conn.release()
  await pool.end()
  console.log(`\n${ok} succeeded, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
