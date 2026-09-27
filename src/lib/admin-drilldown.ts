/**
 * 后台「指标 → 列表」钻取的公共定义。
 *
 * 背景：仪表盘上的每个数字都必须能点进去，看到构成它的那批记录（闭环）。
 * 这需要三样东西在三处保持一致，任何一处对不上都会静默失败：
 *   1. **链接构造**（仪表盘发出去的 URL）—— lib/admin-links 的 listUrl
 *   2. **URL 参数语义**（列表页把 URL 变成 refine 的 filters）
 *   3. **接口实现**（API 路由把参数变成 WHERE）
 *
 * 这个模块承担 (2) 的词汇表与 (1)(2) 共用的文案，接口侧 import 同一批常量，
 * 于是"页面认识的参数"和"接口认识的参数"不会再各写一份。
 *
 * 参数形式沿用 refine 的 filters 序列化（`filters[0][field]=range&...`）而不是
 * 我们自己的 `?range=week`：列表页用的是 useTable + syncWithLocation，
 * 它只认自己的 filters 格式，遇到不认识的参数会**在首次渲染时把 URL 重写掉**
 * （把 range 丢掉）。顺着依赖库的约定走，钻取链接才不会在落地那一刻失效。
 */

import type { CrudFilter } from "@refinedev/core"
import { RANGE_OPTIONS } from "@/lib/admin-range"

/**
 * 钻取专用字段。
 *
 * 与用户手输的搜索条件（q）区别开：清空钻取条件时只清这些，
 * 不能把用户正在搜的关键词一起清掉。
 */
export const DRILLDOWN_FIELDS = ["range", "active", "trial", "pro", "status"] as const
export type DrilldownField = (typeof DRILLDOWN_FIELDS)[number]

const DRILLDOWN_SET = new Set<string>(DRILLDOWN_FIELDS)

export function isDrilldownFilter(filter: CrudFilter): boolean {
  return "field" in filter && DRILLDOWN_SET.has(String(filter.field))
}

/** 每个钻取字段的中文名，用于列表页顶部的条件提示。 */
const FIELD_LABELS: Record<DrilldownField, string> = {
  range: "时间",
  active: "活跃",
  trial: "体验会员",
  pro: "会员",
  status: "状态",
}

/**
 * 布尔类钻取字段的完整文案。
 *
 * 不给它们拼「字段名：值」，是因为布尔没有"值"这回事 ——`活跃：活跃`
 * 这种输出读起来像坏掉了。这里直接给出整句话。
 */
const BOOLEAN_LABELS: Partial<Record<DrilldownField, string>> = {
  active: "仅这段时间练过的用户",
  trial: "仅这段时间领取过体验会员的用户",
  pro: "仅当前会员用户",
}

/** 值的展示文案。未知值原样返回，方便看出"这个参数不是我发的"。 */
function valueLabel(field: DrilldownField, value: string): string {
  if (field === "range") {
    return `时间：${RANGE_OPTIONS.find((o) => o.value === value)?.label ?? value}`
  }
  if (field === "status") {
    const zh =
      {
        // 订单状态（payment_orders.status）
        paid: "已支付",
        pending: "待支付",
        // 订阅状态（subscriptions.status）
        active: "生效中",
        // 两者共用
        expired: "已过期",
        cancelled: "已取消",
      }[value] ?? value
    return `状态：${zh}`
  }
  // 布尔类：约定 "1" / "true" 为真。注意 refine 从 URL 解析出来的值
  // **一律是字符串**，所以这里必须按字符串比较（写成 === 1 会永远不成立，
  // 表现为提示条说错话，而且不报错）
  const truthy = value === "1" || value === "true"
  return truthy ? (BOOLEAN_LABELS[field] ?? FIELD_LABELS[field]) : `排除${FIELD_LABELS[field]}`
}

export interface DrilldownBadge {
  field: string
  label: string
}

/**
 * 把 refine 当前的 filters 里属于钻取的那些，翻译成人能读的条件标签。
 * 没有钻取条件时返回空数组（调用方据此隐藏整条提示，而不是显示一个空壳）。
 */
export function drilldownBadges(filters: CrudFilter[] | undefined): DrilldownBadge[] {
  if (!filters?.length) return []
  const badges: DrilldownBadge[] = []
  for (const f of filters) {
    if (!("field" in f)) continue
    const field = String(f.field)
    if (!DRILLDOWN_SET.has(field)) continue
    const raw = f.value == null ? "" : String(f.value)
    if (raw === "") continue
    badges.push({ field, label: valueLabel(field as DrilldownField, raw) })
  }
  return badges
}

/**
 * 去掉钻取条件，保留其他条件（搜索词、用户手选的筛选）。
 * 「清空筛选」按钮用它 —— 直接 `setFilters([])` 会把关键词也清掉，那不是使用者要的。
 */
export function withoutDrilldown(filters: CrudFilter[] | undefined): CrudFilter[] {
  return (filters ?? []).filter((f) => !isDrilldownFilter(f))
}

/**
 * 换掉/追加一个非钻取条件（例如把旧的 q 替换成新的 q），同时原样保留钻取条件。
 *
 * 搜索框此前直接 `setFilters([{field:"q",...}], "replace")`：从仪表盘钻进来
 * （带着 range）再搜一下，时间范围就被静默丢掉了，而使用者只会觉得"数字对不上"。
 */
export function withFilter(
  filters: CrudFilter[] | undefined,
  field: string,
  value: string | number,
): CrudFilter[] {
  const rest = (filters ?? []).filter((f) => !("field" in f) || String(f.field) !== field)
  // 空值表示"取消这个条件"，而不是"筛一个空字符串"
  if (value === "") return rest
  return [...rest, { field, operator: "eq", value }]
}
