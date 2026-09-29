import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { adminAuditLogs } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { parseRangeQuery, resolveRange } from "@/lib/admin-range"
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/admin-audit-labels"
import { and, desc, eq, gte, lte, like, or, sql, type SQL } from "drizzle-orm"

/**
 * 后台「操作审计」列表。
 *
 * 这个接口补的是后台从上线起就缺的一环：业务表只有**最终状态**，
 * 回答不了"谁给谁开的会员、谁删的课程、谁改的角色"。
 *
 * 几条取舍：
 *
 * 1. **只读**。审计日志不提供删除/编辑接口 —— 能改的日志不算日志。
 *    清理旧数据只能由 DBA 在库上做（且应当是归档，不是删除）。
 *
 * 2. `action` / `targetType` 取白名单里的值。不是白名单的筛选值直接忽略，
 *    而不是返回 400：这是展示层参数，一个过期的书签不该看到报错页。
 *
 * 3. 筛选走**联合索引**（见 00022）：adminId+时间、target+时间、action+时间
 *    都有覆盖，所以这里的组合筛不会退化成全表扫。
 *
 * 4. `q` 搜 admin_label / target_label 这两个**快照文本**：拿一个句子或用户名
 *    来反查"这句话是谁动的"，是这个页面最常见的用法。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100)

  const rawAction = (searchParams.get("action") ?? "").trim()
  const action = (AUDIT_ACTIONS as readonly string[]).includes(rawAction) ? rawAction : null

  const rawTarget = (searchParams.get("targetType") ?? "").trim()
  const targetType = (AUDIT_TARGET_TYPES as readonly string[]).includes(rawTarget)
    ? rawTarget
    : null

  const adminId = (searchParams.get("adminId") ?? "").trim().slice(0, 36) || null

  // 时间范围与仪表盘/其它后台列表共用同一份定义（滚动 7/30/90 天），
  // 否则「近一周」在两个页面上会指向不同的区间
  const rangeQuery = parseRangeQuery(searchParams)
  const range = rangeQuery ? resolveRange(rangeQuery) : null
  const from = range?.start ?? null
  // 上界：预设窗口都是"到现在"，只有自定义范围才有终点
  const to = range?.end ?? null

  const conds: SQL[] = []
  if (action) conds.push(eq(adminAuditLogs.action, action))
  if (targetType) conds.push(eq(adminAuditLogs.targetType, targetType))
  if (adminId) conds.push(eq(adminAuditLogs.adminId, adminId))
  if (from) conds.push(gte(adminAuditLogs.createdAt, from))
  if (to) conds.push(lte(adminAuditLogs.createdAt, to))
  if (q) {
    const matched = or(
      like(adminAuditLogs.adminLabel, `%${q}%`),
      like(adminAuditLogs.targetLabel, `%${q}%`),
    )
    if (matched) conds.push(matched)
  }
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds)

  // 分页的第二个排序键是稳定分页所必需的：同一秒内可能有多条日志，
  // 只按 created_at 排序时 MySQL 不保证翻页顺序一致（埋点列表踩过同一个坑）。
  // count(*) 用同一套 where：审计日志每个管理动作才一行，是库里最小的表之一，
  // 而且筛选条件都有索引覆盖，不存在列表 total 拖慢页面的问题。
  const [rows, [countRow]] = await Promise.all([
    database
      .select()
      .from(adminAuditLogs)
      .where(where)
      .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
      .limit(pageSize)
      .offset(offset),
    database.select({ total: sql<number>`count(*)` }).from(adminAuditLogs).where(where),
  ])
  const total = Number(countRow?.total ?? 0)

  // 操作者下拉：从日志里实际出现过的人取（不是从 users 表猜）。
  // 取近 200 条再在内存里去重，避免 DISTINCT 在 label 随时间变化时给出多条同人记录。
  const recentActors = await database
    .select({ adminId: adminAuditLogs.adminId, adminLabel: adminAuditLogs.adminLabel })
    .from(adminAuditLogs)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(200)
  const actorMap = new Map<string, string>()
  for (const a of recentActors) {
    // 同一个 id 只留最新一次的快照标签（人可能改过名）
    if (a.adminId && a.adminLabel && !actorMap.has(a.adminId)) {
      actorMap.set(a.adminId, a.adminLabel)
    }
  }

  return NextResponse.json({
    data: rows,
    total,
    // 回显生效的筛选，便于前端在"筛了但结果为空"时说明原因（而不是让人怀疑没数据）
    applied: { action, targetType, adminId, q, range: range?.range ?? null, rangeLabel: range?.label ?? null },
    actors: Array.from(actorMap, ([id, label]) => ({ id, label })),
  })
}
