"use client"

import { List, useTable } from "@refinedev/antd"
import { Table, Tag } from "antd"

export default function PaymentsList() {
  const { tableProps } = useTable({ pagination: { pageSize: 20 } })

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="out_trade_no" title="订单号" ellipsis width={200} />
        <Table.Column
          dataIndex="plan"
          title="方案"
          width={100}
          render={(p: string) =>
            p === "monthly" ? "月度会员" : "年度会员"
          }
        />
        <Table.Column
          dataIndex="amount"
          title="金额"
          width={100}
          render={(a: number) => `¥${(a / 100).toFixed(2)}`}
        />
        <Table.Column
          dataIndex="status"
          title="状态"
          width={100}
          render={(s: string) => {
            const colors: Record<string, string> = {
              pending: "orange",
              paid: "green",
              expired: "default",
              cancelled: "red",
            }
            const labels: Record<string, string> = {
              pending: "待支付",
              paid: "已支付",
              expired: "已过期",
              cancelled: "已取消",
            }
            return <Tag color={colors[s] || "default"}>{labels[s] || s}</Tag>
          }}
        />
        <Table.Column
          dataIndex="paid_at"
          title="支付时间"
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
