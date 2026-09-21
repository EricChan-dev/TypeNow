import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import * as schema from "./schema"

/**
 * 全站唯一的时间口径：DATETIME 一律以 Asia/Shanghai 的墙上时间存储。
 *
 * DB 主机的 SYSTEM 时区（typenow 生产库是 CST）不可依赖，进程时区也不可依赖，
 * 所以这里两处都显式固定，缺一不可：
 *
 *   1. `timezone` —— mysql2 在 JS Date ↔ 字符串之间按 +08:00 转换（不依赖进程时区）
 *   2. `SET time_zone` —— NOW()/CURRENT_TIMESTAMP 产出 +08:00（不依赖 DB 主机时区）
 *
 * 这样 `DATE(created_at)` 恒等于「上海日历日」，读取侧不需要也不应该再叠加
 * CONVERT_TZ(created_at, '+00:00', '+08:00')。
 */
export const DB_TIME_ZONE = "+08:00"

const globalForDb = global as unknown as { pool: mysql.Pool }

function createPool() {
  const url = process.env.DATABASE_URL
  if (!url) return null

  const pool = mysql.createPool({ uri: url, timezone: DB_TIME_ZONE })

  // 'connection' 在连接交付给调用方之前同步触发（mysql2 base/pool.js），
  // 因此这条 SET 一定排在本连接上任何业务语句之前。
  pool.on("connection", (conn) => {
    conn.query(`SET time_zone = '${DB_TIME_ZONE}'`)
  })

  return pool
}

const pool = globalForDb.pool ?? createPool()

if (process.env.NODE_ENV !== "production" && pool) {
  globalForDb.pool = pool
}

export const db = pool ? drizzle(pool, { schema, mode: "default" }) : null

export function isDbConfigured(): boolean {
  return !!pool
}
