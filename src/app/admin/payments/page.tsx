"use client"

import { List, useTable } from "@refinedev/antd"
import { Input, Space, Table, Tag } from "antd"
import Link from "next/link"

/**
 * 支付订单列表。
 *
 * 增强点（让订单「能追溯到人」）：
 *   - 新增「用户」列：显示姓名 + 脱敏手机号，点击进入该用户详情
 *   - 顶部搜索：订单号 / 姓名 / 手机号（后端 `q` 参数）
 *
 * 搜索用的是 refine 的 setFilters：dataProvider 会把 filter 的 field 直接当作
 * query 参数名发出去，所以这里 field 必须与后端读的参数名一致（q）。
 */
export default function PaymentsList() {
  const { tableProps, setFilters } = useTable({
    pagination: { pageSize: 20 },
    syncWithLocation: true,
  })

  return (
    <List>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Input.Search
            allowClear
            placeholder="搜索订单号 / 用户姓名 / 手机号"
            style={{ width: 320 }}
            onSearch={(value) =>
              setFilters([{ field: "q", operator: "eq", value }], "replace")
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
        <Table.Column dataIndex="outTradeNo" title="订单号" ellipsis width={200} />
        <Table.Column
          dataIndex="plan"
          title="方案"
          width={100}
          render={(p: string) =>
            p === "monthly" ? "月度会员" : p === "yearly" ? "年度会员" : "合伙人"
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
          dataIndex="paidAt"
          title="支付时间"
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
