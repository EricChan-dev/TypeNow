"use client"

import { List, useTable } from "@refinedev/antd"
import { Table, Tag } from "antd"

export default function SubscriptionsList() {
  const { tableProps } = useTable({ pagination: { pageSize: 20 } })

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="plan"
          title="方案"
          width={100}
          render={(p: string) =>
            p === "monthly" ? "月度会员" : "年度会员"
          }
        />
        <Table.Column
          dataIndex="status"
          title="状态"
          width={100}
          render={(s: string) => {
            const colors: Record<string, string> = {
              active: "green",
              cancelled: "orange",
              expired: "default",
            }
            const labels: Record<string, string> = {
              active: "有效",
              cancelled: "已取消",
              expired: "已过期",
            }
            return <Tag color={colors[s] || "default"}>{labels[s] || s}</Tag>
          }}
        />
        <Table.Column
          dataIndex="starts_at"
          title="开始时间"
          width={180}
          render={(d: string) =>
            d ? new Date(d).toLocaleString("zh-CN") : "-"
          }
        />
        <Table.Column
          dataIndex="expires_at"
          title="到期时间"
          width={180}
          render={(d: string) =>
            d ? new Date(d).toLocaleString("zh-CN") : "-"
          }
        />
        <Table.Column
          dataIndex="created_at"
          title="创建时间"
          width={180}
          render={(d: string) =>
            d ? new Date(d).toLocaleString("zh-CN") : "-"
          }
        />
      </Table>
    </List>
  )
}
