import { drizzle } from "drizzle-orm/mysql2"
import { MySqlDateTime } from "drizzle-orm/mysql-core"
import mysql from "mysql2/promise"
import * as schema from "./schema"

/**
 * 全站唯一的时间口径：DATETIME 一律以 Asia/Shanghai 的墙上时间存储。
 *
 * DB 主机的 SYSTEM 时区（typenow 生产库是 CST）不可依赖，进程时区也不可依赖，
 * 所以下面三处都显式固定，缺一不可：
 *
 *   1. `timezone` —— mysql2 在 JS Date ↔ 字符串之间按 +08:00 转换（不依赖进程时区）
 *   2. `SET time_zone` —— NOW()/CURRENT_TIMESTAMP 产出 +08:00（不依赖 DB 主机时区）
 *   3. drizzle 的 datetime 映射 —— 见 patchDatetimeMapping()，drizzle 自带的映射
 *      是 UTC 墙上时间，会把上面两条全部绕过去
 *
 * 这样 `DATE(created_at)` 恒等于「上海日历日」，读取侧不需要也不应该再叠加
 * CONVERT_TZ(created_at, '+00:00', '+08:00')。
 */
export const DB_TIME_ZONE = "+08:00"

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 把绝对时刻格式化成 +08:00 的墙上时间字符串（MySQL DATETIME 字面量）。 */
export function toDbDateTime(value: Date): string {
  return new Date(value.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ")
}

/** 把 +08:00 的墙上时间字符串还原成绝对时刻。 */
export function fromDbDateTime(value: string | Date): Date {
  if (value instanceof Date) return value
  return new Date(`${value.replace(" ", "T")}+08:00`)
}

let datetimeMappingPatched = false

/**
 * 修正 drizzle 的 DATETIME 映射口径。
 *
 * drizzle 的 MySqlDateTime 实现与 mysql2 的 `timezone` 选项完全无关，它自己
 * 完成 Date ↔ 字符串的转换，且一律按 UTC：
 *
 *   mapToDriverValue   : value.toISOString()      → "2026-09-23 07:39:00"（UTC 墙上时间）
 *   mapFromDriverValue : new Date(str + "Z")      → 把库里任何值都当成 UTC
 *
 * 而本库的写入口不止 drizzle 一处：几乎所有 created_at 都是 MySQL 默认值
 * `CURRENT_TIMESTAMP`，在 `SET time_zone='+08:00'` 下产出的是 **+08 墙上时间**。
 * 两种口径混在同一批列里，后果不是"差 8 小时显示"，而是**同一个比较里两个
 * 操作数口径不同**，例如：
 *
 *   - auth/send-sms 用 gte(createdAt, now-1min) 过滤，created_at 是 +08、
 *     参数被 drizzle 映射成 UTC，于是「1 分钟冷却」实际变成「9 小时冷却」，
 *     用户重发验证码会被拦下并看到"请 28860 秒后再试"。
 *   - archive/home 的统计窗口用 shanghaiDayStart()（+08 零点）作参数，
 *     与 +08 存储的 created_at 比较时整体前移 8 小时，跨日统计因此错位。
 *
 * 生产库已确认存在该错位：users.created_at 与 users.pro_expires 相差 3840
 * 分钟（= 72h − 8h）。这里把映射统一到 +08，与 mysql2/DB 两条路径对齐。
 */
function patchDatetimeMapping(): void {
  if (datetimeMappingPatched) return
  datetimeMappingPatched = true

  MySqlDateTime.prototype.mapToDriverValue = function (this: unknown, value: Date): string {
    return toDbDateTime(value)
  }
  MySqlDateTime.prototype.mapFromDriverValue = function (this: unknown, value: string | Date): Date {
    return fromDbDateTime(value)
  }
}

patchDatetimeMapping()

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
