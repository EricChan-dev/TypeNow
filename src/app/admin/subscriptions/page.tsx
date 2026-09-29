"use client"

import { List, useTable } from "@refinedev/antd"
import { memberTierLabel } from "@/lib/pricing"
import { Input, Space, Table, Tag } from "antd"
import Link from "next/link"
import DrilldownBanner from "@/components/admin/DrilldownBanner"
import { drilldownBadges, withFilter, withoutDrilldown } from "@/lib/admin-drilldown"
import { formatAdminTime } from "@/lib/admin-time"
import { AdminRangePicker } from "@/components/admin/AdminRangePicker"
import { readRangeSelection } from "@/lib/admin-range-filters"
import type { RangeSelection } from "@/lib/admin-range"

/**
 * 订阅管理列表。
 *
 * 与支付订单一致：带出订阅人（可点击进用户详情）+ 姓名/手机号搜索。
 * 这个页面此前整体打不开 —— 对应的 /api/admin/subscriptions 接口根本不存在。
 */
export default function SubscriptionsList() {
  const { tableProps, filters, setFilters } = useTable({
    pagination: { pageSize: 20 },
    syncWithLocation: true,
  })

  /**
   * 时间范围走 refine 的 filters（会进 URL）。此前列表页**没有任何时间控件**，
   * 只能靠从仪表盘钻取带过来的 range —— 想自己换个区间是做不到的。
   */
  const rangeSelection = readRangeSelection(filters)
  const applyRange = (next: RangeSelection) => {
    // 先写 range，再把 from/to 落成空串（withFilter 约定：空值 = 取消该条件），
    // 这样从"自定义"切回预设时不会残留旧的日期条件
    let nextFilters = withFilter(filters as never, "range", next.range)
    nextFilters = withFilter(nextFilters, "from", next.from ?? "")
    nextFilters = withFilter(nextFilters, "to", next.to ?? "")
    setFilters(nextFilters, "replace")
  }

  return (
    <List>
      <DrilldownBanner
        badges={drilldownBadges(filters as never)}
        onClear={() => setFilters(withoutDrilldown(filters as never), "replace")}
      />

      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <AdminRangePicker value={rangeSelection} onChange={applyRange} />
          <Input.Search
            allowClear
            placeholder="搜索用户姓名 / 手机号"
            style={{ width: 320 }}
            onSearch={(value) =>
              // 只替换 q，保留钻取条件（从仪表盘带进来的时间范围/状态）
              setFilters(withFilter(filters as never, "q", value.trim()), "replace")
            }
          />
        </Space>
      </div>

      <Table {...tableProps} rowKey="id"
        scroll={{ x: "max-content" }}
      >
        <Table.Column
          title="用户"
          key="user"
          width={200}
          render={(_: unknown, r: { userId: string; userName?: string | null; userPhone?: string | null }) => (
            <Link href={`/admin/users/${r.userId}`} style={{ color: "#1677ff" }}>
              {r.userName || "（无名）"}
              {r.userPhone ? ` · ${r.userPhone.slice(0, 3)}****${r.userPhone.slice(-4)}` : ""}
            </Link>
          )}
        />
        <Table.Column
          dataIndex="plan"
          title="方案"
          width={100}
          // 档位名走 lib/pricing 的唯一事实源：原先这里手写了三个分支，
          // 加季度档时会静默漏掉（显示成"合伙人"），而终端用户看不到这个页面，
          // 所以这种漂移不会被发现。终身档现在叫「终身会员」。
          render={(p: string) => memberTierLabel(p)}
        />
        {/* 用接口算好的 effectiveStatus：status 列写着 active 但已经到期的行
            标成「已过期(未清理)」。只看 status 会把它们显示成"有效"，
            而仪表盘「活跃订阅」又不算它们 —— 同一行在两个地方两种说法 */}
        <Table.Column
          dataIndex="effectiveStatus"
          title="状态"
          width={130}
          render={(s: string) => {
            const colors: Record<string, string> = {
              active: "green",
              cancelled: "orange",
              expired: "default",
              expired_stale: "red",
            }
            const labels: Record<string, string> = {
              active: "有效",
              cancelled: "已取消",
              expired: "已过期",
              expired_stale: "已过期(未清理)",
            }
            return <Tag color={colors[s] || "default"}>{labels[s] || s}</Tag>
          }}
        />
        <Table.Column
          dataIndex="startsAt"
          title="开始时间"
          width={180}
          render={(d: string) => (d ? formatAdminTime(d) : "-")}
        />
        <Table.Column
          dataIndex="expiresAt"
          title="到期时间"
          width={180}
          render={(d: string) => (d ? formatAdminTime(d) : "-")}
        />
        <Table.Column
          dataIndex="createdAt"
          title="创建时间"
          width={180}
          render={(d: string) => (d ? formatAdminTime(d) : "-")}
        />
      </Table>
    </List>
  )
}
