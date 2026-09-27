"use client"

/**
 * 列表页的「正常 / 回收站 / 全部」切换。
 *
 * 软删除之后必须给运营一个能看见已删除内容的地方，否则"删了"和"永久丢了"
 * 在使用者眼里没有区别 —— 那软删除就白做了。恢复入口就在"回收站"这一档里。
 *
 * 值走 refine 的 filters（field=deleted），这样状态进 URL、刷新后还在，
 * 也和列表其余筛选走同一套机制。默认档不写进 filters，保持 URL 干净。
 */

import { Segmented } from "antd"
import type { CrudFilter } from "@refinedev/core"
import { withFilter } from "@/lib/admin-drilldown"

export const DELETED_VIEW_OPTIONS = [
  { label: "正常", value: "normal" },
  { label: "回收站", value: "only" },
  { label: "全部", value: "all" },
] as const

interface Props {
  filters: CrudFilter[] | undefined
  setFilters: (filters: CrudFilter[], behavior?: "merge" | "replace") => void
}

export default function DeletedViewToggle({ filters, setFilters }: Props) {
  const current =
    (filters ?? [])
      .filter((f) => "field" in f && String(f.field) === "deleted")
      .map((f) => ("value" in f ? String(f.value) : ""))[0] || "normal"

  return (
    <Segmented
      value={current}
      options={DELETED_VIEW_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
      onChange={(v) => {
        // normal 是默认档，从 filters 里移除而不是写 deleted=normal，
        // 这样 URL 不会因为切回默认而留下噪声
        setFilters(withFilter(filters, "deleted", v === "normal" ? "" : String(v)), "replace")
      }}
    />
  )
}
