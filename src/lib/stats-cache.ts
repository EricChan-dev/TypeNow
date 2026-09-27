import { db } from "@/lib/db"
import { siteConfig } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

/**
 * 后台统计数字的带 TTL 缓存，落在 `site_config` 这张 KV 表上。
 *
 * 为什么需要：仪表盘的「句子总数」是 `SELECT COUNT(*) FROM sentences`，
 * 而 sentences 有 46 万行 / 3GB。实测这条查询 **104~356ms**，而且每次打开后台都要跑一遍。
 * 计数本身还会随数据增长变慢，属于典型的"每次都在为同一个答案付全表扫描的钱"。
 *
 * 存到 MySQL 而不是进程内存：pm2 重启、多实例、以及将来换机器时都不会丢，
 * 也不会出现"这个实例说有 46 万、那个实例说 45 万"。
 *
 * 读路径 = 一次主键查询（实测 17ms 级别且不随数据量增长），写路径只在缓存过期时发生。
 */

/** 默认缓存 10 分钟。内容总量这类数字不需要实时，1 分钟的误差无所谓。 */
export const DEFAULT_TTL_MS = 10 * 60 * 1000

interface CachedValue {
  value: number
  computedAt: string
}

/**
 * 缓存是否已过期（纯函数，便于单测）。
 *
 * 解析失败（脏数据、老格式）一律视为过期：宁可多算一次，也不要拿一个读不出来的值去糊弄。
 */
export function isCacheStale(
  computedAt: string | null | undefined,
  ttlMs: number,
  now: number = Date.now(),
): boolean {
  if (!computedAt) return true
  const t = new Date(computedAt).getTime()
  if (!Number.isFinite(t)) return true
  // 未来时间（时钟回拨或写入异常）也视为过期
  if (t > now) return true
  return now - t >= ttlMs
}

/**
 * 取一个计数：命中未过期的缓存就直接返回，否则重新计算并写回。
 *
 * `compute` 抛错时返回 null，由调用方决定怎么显示 —— 统计数字不该让整个仪表盘挂掉
 * （这个教训在 /admin 已经吃过一次：一个接口 404 让整页 Promise.all 崩掉）。
 */
export async function getCachedCount(
  key: string,
  compute: () => Promise<number>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<number | null> {
  if (!db) return null

  try {
    const [row] = await db
      .select({ value: siteConfig.value })
      .from(siteConfig)
      .where(eq(siteConfig.key, key))
      .limit(1)

    let cached: CachedValue | null = null
    if (row?.value) {
      const v = row.value as Partial<CachedValue>
      if (typeof v.value === "number" && typeof v.computedAt === "string") {
        cached = { value: v.value, computedAt: v.computedAt }
      }
    }

    if (cached && !isCacheStale(cached.computedAt, ttlMs)) {
      return cached.value
    }

    const fresh = await compute()
    const payload: CachedValue = { value: fresh, computedAt: new Date().toISOString() }

    await db
      .insert(siteConfig)
      .values({ key, value: payload })
      .onDuplicateKeyUpdate({ set: { value: payload, updatedAt: new Date() } })

    return fresh
  } catch (e) {
    console.error(`[stats-cache] ${key} 失败:`, e)
    return null
  }
}

/** 强制刷新（后台「刷新」按钮、或数据导入后主动失效用）。 */
export async function invalidateCachedCount(key: string): Promise<void> {
  if (!db) return
  try {
    await db.delete(siteConfig).where(eq(siteConfig.key, key))
  } catch (e) {
    console.error(`[stats-cache] 失效 ${key} 失败:`, e)
  }
}

/** 缓存 key 统一在这里定义，避免各处手写字符串写歪。 */
export const STATS_KEYS = {
  totalSentences: "stats.total_sentences",
  totalCourses: "stats.total_courses",
  totalLessons: "stats.total_lessons",
} as const
