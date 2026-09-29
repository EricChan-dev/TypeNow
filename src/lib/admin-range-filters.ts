/**
 * 在 refine 的 filters 与时间选择之间做转换。
 *
 * 后台列表的时间范围走 refine 的 filters（因此会进 URL、能和从仪表盘钻取过来的
 * 条件共存）。field 名与 URL 参数保持一致：`range` / `from` / `to`。
 *
 * 这里刻意**不 import @refinedev/core 的类型**，入参用宽松结构：
 * `lib/admin-range.ts` 会被服务端路由 import，一旦把 refine 的类型依赖带进来，
 * 服务端也会被拖着加载前端框架的类型与运行时代码。
 */

import { DEFAULT_RANGE, RANGE_VALUES, type RangeSelection, type StatsRange } from "@/lib/admin-range"

interface FilterLike {
  field?: unknown
  value?: unknown
}

/** 从 filters 里读回当前的时间选择；缺参数或非法值回落到默认窗口。 */
export function readRangeSelection(filters: unknown): RangeSelection {
  const list = Array.isArray(filters) ? (filters as FilterLike[]) : []
  const raw = (field: string): unknown =>
    list.find((f) => f && typeof f === "object" && String(f.field) === field)?.value

  const rangeRaw = raw("range")
  const range: StatsRange = (RANGE_VALUES as readonly string[]).includes(String(rangeRaw))
    ? (rangeRaw as StatsRange)
    : DEFAULT_RANGE

  const asDate = (v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null
    const s = String(v)
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
  }

  if (range !== "custom") return { range, from: null, to: null }
  return { range, from: asDate(raw("from")), to: asDate(raw("to")) }
}
