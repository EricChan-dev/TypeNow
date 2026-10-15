/**
 * 课程列表 / 计数共用的查询片段。
 *
 * ── 为什么单独抽一层 ──────────────────────────────────────────────────────
 *
 * 「标签上的数字」与「点进去看到的列表」必须用**逐字相同**的条件，
 * 否则会出现「标签写着 27、点进去只有 25 门」这类最难自查的 bug ——
 * 数字看起来总是差不多对。
 *
 * 之前 `escapeLike` 在 `api/courses/list/route.ts` 里是私有函数。计数接口
 * 一旦自己再抄一份转义逻辑，两边就会各自演化：某个路由补了 `\\` 的转义、
 * 另一个没补，`%`、`_` 这类输入立刻让两边分叉。所以这里收敛成唯一实现，
 * 两边都从这里取。
 */

import { courses } from "@/lib/db/schema"
import { like } from "drizzle-orm"

/**
 * 转义 LIKE 通配符。
 *
 * 不转义时 `?search=%` 会被当成「匹配任意标题」——等于把搜索框变成全表返回；
 * 用户输入里的 `%` 和 `_` 必须按字面量处理。反斜杠要先转，否则会把自己
 * 转义出来的 `\%` 再转一次（`\\` → `\\\\`）。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/**
 * 标题模糊匹配条件；搜索词为空（或只有空白）时返回 undefined，表示「不加条件」。
 *
 * 返回 `undefined` 而不是一个恒真条件：让调用方能把它整个略过，
 * 少一个 AND 子句，SQL 也更好读。
 */
export function courseSearchCondition(search: string | null | undefined) {
  const needle = search?.trim()
  if (!needle) return undefined
  return like(courses.title, `%${escapeLike(needle)}%`)
}
