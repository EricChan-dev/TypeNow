/**
 * 后台列表的「回收站」视图。
 *
 * 软删除之后，后台列表需要三种视角：
 *   normal（默认）—— 只看未删除的，日常管理用
 *   only          —— 只看已删除的，也就是回收站，恢复按钮在这里
 *   all           —— 全部，用来排查"这条到底是被删了还是没了"
 *
 * 为什么单独一个模块而不是在三个接口里各写一遍：这三个字符串（以及它们对应的
 * WHERE）一旦写歪，后果是"删了却在回收站里找不到"，也就是**内容看起来永久丢了**——
 * 而这正是软删除要避免的事。集中一处，测试也只需要覆盖一处。
 */

import { sql, type SQL } from "drizzle-orm"

/** 恒真占位，用于 scope=all（MySQL 会优化掉）。 */
const TRUE = sql`TRUE`

export const DELETED_SCOPES = ["normal", "only", "all"] as const
export type DeletedScope = (typeof DELETED_SCOPES)[number]

/** 默认只看未删除的：没人操作时列表应当和"没有软删除这个功能"时一样。 */
export const DEFAULT_DELETED_SCOPE: DeletedScope = "normal"

/** 解析 ?deleted= 参数，非法值回落默认（不抛错，这是展示层参数）。 */
export function deletedScope(raw: string | null | undefined): DeletedScope {
  if (!raw) return DEFAULT_DELETED_SCOPE
  return (DELETED_SCOPES as readonly string[]).includes(raw) ? (raw as DeletedScope) : DEFAULT_DELETED_SCOPE
}

/**
 * 生成对应的 WHERE 片段。
 *
 * `alive` / `deleted` 是 lib/soft-delete 导出的两个谓词（未删除 / 已删除）。
 * 返回类型固定为 SQL（`all` 用 `TRUE` 占位），这样调用方可以用 `SQL[]` 组装，
 * 不必到处判断 undefined；MySQL 会把这个恒真条件优化掉。
 */
export function deletedCondition(scope: DeletedScope, alive: SQL, deleted: SQL): SQL {
  switch (scope) {
    case "only":
      return deleted
    case "all":
      return TRUE
    case "normal":
    default:
      return alive
  }
}
