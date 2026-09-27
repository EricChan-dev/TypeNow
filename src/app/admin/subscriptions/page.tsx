"use client"

import { List, useTable } from "@refinedev/antd"
import { Input, Space, Table, Tag } from "antd"
import Link from "next/link"
import DrilldownBanner from "@/components/admin/DrilldownBanner"
import { drilldownBadges, withFilter, withoutDrilldown } from "@/lib/admin-drilldown"

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

  return (
    <List>
      <DrilldownBanner
        badges={drilldownBadges(filters as never)}
        onClear={() => setFilters(withoutDrilldown(filters as never), "replace")}
      />

      <div style={{ marginBottom: 16 }}>
        <Space>
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

      <Table {...tableProps} rowKey="id">
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
          render={(p: string) =>
            p === "monthly" ? "月度会员" : p === "yearly" ? "年度会员" : "合伙人"
          }
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
          render={(d: string) => (d ? new Date(d).toLocaleString("zh-CN") : "-")}
        />
        <Table.Column
          dataIndex="expiresAt"
          title="到期时间"
          width={180}
          render={(d: string) => (d ? new Date(d).toLocaleString("zh-CN") : "-")}
        />
        <Table.Column
          dataIndex="createdAt"
          title="创建时间"
          width={180}
          render={(d: string) => (d ? new Date(d).toLocaleString("zh-CN") : "-")}
        />
      </Table>
    </List>
  )
}
