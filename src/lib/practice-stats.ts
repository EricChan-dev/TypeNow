/**
 * 练习统计的时间口径与序列构建。
 *
 * 全站约定：DATETIME 一律以 Asia/Shanghai 的墙上时间存储。
 * lib/db 在建池时把连接时区和客户端时区都固定为 +08:00，所以：
 *
 *   - `DATE(created_at)` 恒等于「上海日历日」
 *   - 不要再用 CONVERT_TZ(created_at, '+00:00', '+08:00')，
 *     那会把已经是 +08:00 的值再加 8 小时（历史上就是这样错的）
 *
 * 同理，任何「今天」都必须用 toShanghaiDateStr()，不要用
 * `new Date().toISOString().slice(0, 10)` —— 后者是 UTC 日期，
 * 会在 CST 00:00-08:00 与实际存储口径错开一天。
 */

const SH_TZ = "Asia/Shanghai"

/** 把任意时刻折算为 Asia/Shanghai 的 YYYY-MM-DD。 */
export function toShanghaiDateStr(d: Date = new Date()): string {
  // sv-SE locale 的短日期格式恰好就是 YYYY-MM-DD
  return d.toLocaleDateString("sv-SE", { timeZone: SH_TZ })
}

/** 上海时区某天 00:00 对应的绝对时刻。 */
export function shanghaiDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+08:00`)
}

/** 在 YYYY-MM-DD 上按天偏移。中国无夏令时，按毫秒回推是安全的。 */
export function shiftShanghaiDate(dateStr: string, days: number): string {
  return toShanghaiDateStr(new Date(shanghaiDayStart(dateStr).getTime() + days * 86400000))
}

export interface DailyCount {
  date: string
  count: number
}

/**
 * 生成截至 today 的连续 days 天序列，缺失日期补 0。
 *
 * - rows[].date 必须是 Asia/Shanghai 的 YYYY-MM-DD
 * - 窗口之外的数据被忽略，重复日期累加
 * - 返回按日期升序，最后一项即「今天」，前端无需自己算时区
 */
export function buildDailySeries(
  rows: DailyCount[],
  today: Date = new Date(),
  days = 7,
): DailyCount[] {
  const byDate = new Map<string, number>()
  for (const row of rows) {
    if (!row?.date) continue
    const n = Number(row.count)
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + (Number.isFinite(n) ? n : 0))
  }

  const todayStr = toShanghaiDateStr(today)
  const series: DailyCount[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftShanghaiDate(todayStr, -i)
    series.push({ date, count: byDate.get(date) ?? 0 })
  }
  return series
}

/**
 * 连续打卡天数。
 *
 * sortedDates 必须是按降序排列的 "YYYY-MM-DD"（上海日历日，即 check_ins.date）。
 * 今天还没打卡时从昨天起算，保证「昨天打过、今天还没打」不会把连续天数清零。
 */
export function computeStreak(
  sortedDates: string[],
  today: string = toShanghaiDateStr(),
): number {
  if (sortedDates.length === 0) return 0

  const yesterday = shiftShanghaiDate(today, -1)
  let expected = sortedDates[0] === today ? today : yesterday
  let streak = 0

  for (const date of sortedDates) {
    if (date === expected) {
      streak++
      expected = shiftShanghaiDate(expected, -1)
    } else if (date < expected) {
      break
    }
  }
  return streak
}
