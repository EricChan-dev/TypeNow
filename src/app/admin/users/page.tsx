"use client"

import { List, useTable, ShowButton } from "@refinedev/antd"
import { Input, Space, Table, Tag } from "antd"
import Link from "next/link"
import DrilldownBanner from "@/components/admin/DrilldownBanner"
import { drilldownBadges, withFilter, withoutDrilldown } from "@/lib/admin-drilldown"
import { formatAdminTime } from "@/lib/admin-time"
import { AdminRangePicker } from "@/components/admin/AdminRangePicker"
import { readRangeSelection } from "@/lib/admin-range-filters"
import type { RangeSelection } from "@/lib/admin-range"

/**
 * 用户管理列表。
 *
 * 列比原先丰富得多：除昵称/手机/会员/角色/注册时间外，把「这个人都干了什么」
 * 直接铺在列表里 —— 练习句数、埋点数、付费订单数、微信绑定、是否合伙人。
 * 这些原先都要点进详情才能看到，导致列表页无法一眼分辨"真在用的用户"和"注册完就没来过的"。
 */
export default function UsersList() {
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
      {/* 从仪表盘钻进来时说明口径：不说的话用户只看到"人数比指标多"，
          会以为仪表盘算错了 */}
      <DrilldownBanner
        badges={drilldownBadges(filters as never)}
        onClear={() => setFilters(withoutDrilldown(filters as never), "replace")}
      />

      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <AdminRangePicker value={rangeSelection} onChange={applyRange} />
          <Input.Search
            allowClear
            placeholder="搜索昵称 / 手机号"
            style={{ width: 320 }}
            onSearch={(value) =>
              // 只替换 q，保留钻取条件 —— 直接 setFilters([q]) 会把时间范围清掉
              setFilters(withFilter(filters as never, "q", value.trim()), "replace")
            }
          />
        </Space>
      </div>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1100 }}>
        <Table.Column
          dataIndex="name"
          title="昵称"
          ellipsis
          render={(n: string | null, r: { id: string }) => (
            <Link href={`/admin/users/${r.id}`} style={{ color: "#1677ff" }}>
              {n || "（无名）"}
            </Link>
          )}
        />
        <Table.Column dataIndex="phone" title="手机" width={130} />
        {/* 来源摘要由接口算好（describeSignupSource）—— 渠道、微信 scene 与
            首触来源的优先级只该有一份实现，前端只负责渲染 */}
        <Table.Column
          dataIndex="signupLabel"
          title="来源"
          width={190}
          ellipsis
          render={(v: string | null) => <span style={{ fontSize: 12 }}>{v || "—"}</span>}
        />
        <Table.Column
          dataIndex="hasWechat"
          title="微信"
          width={70}
          render={(w: boolean) => (w ? <Tag color="green">已绑</Tag> : <Tag>—</Tag>)}
        />
        {/* isPro 是接口按"此刻是否真的还是会员"算好的（见 lib/subscription）：
            直接读标记会把过期未回收的体验会员显示成 PRO。
            标记还在、但已经过期的行标出来 —— 那说明回收没跑到这个用户身上 */}
        <Table.Column
          dataIndex="isPro"
          title="会员"
          width={110}
          render={(p: boolean, r: { isProFlagged?: boolean }) =>
            p ? (
              <Tag color="blue">PRO</Tag>
            ) : r.isProFlagged ? (
              <Tag color="default">已过期</Tag>
            ) : (
              <Tag>免费</Tag>
            )
          }
        />
        <Table.Column
          dataIndex="isPartner"
          title="合伙人"
          width={80}
          render={(p: boolean) => (p ? <Tag color="gold">是</Tag> : <Tag>—</Tag>)}
        />
        <Table.Column
          dataIndex="role"
          title="角色"
          width={80}
          render={(r: string) =>
            r === "admin" ? <Tag color="purple">管理员</Tag> : <Tag>用户</Tag>
          }
        />
        <Table.Column
          dataIndex="practiceCount"
          title="练习句数"
          width={100}
          sorter={(a: { practiceCount: number }, b: { practiceCount: number }) =>
            a.practiceCount - b.practiceCount
          }
        />
        <Table.Column dataIndex="eventCount" title="埋点数" width={90} />
        <Table.Column dataIndex="paidOrderCount" title="已付订单" width={90} />
        <Table.Column dataIndex="diamonds" title="钻石" width={80} />
        <Table.Column
          dataIndex="referredBy"
          title="邀请人"
          width={100}
          ellipsis
          render={(v: string | null) =>
            v ? (
              <Link href={`/admin/users/${v}`} style={{ color: "#1677ff" }}>
                查看
              </Link>
            ) : (
              "—"
            )
          }
        />
        <Table.Column
          dataIndex="createdAt"
          title="注册时间"
          width={170}
          render={(d: string) => (d ? formatAdminTime(d) : "-")}
        />
        <Table.Column
          title="操作"
          width={70}
          fixed="right"
          render={(_: unknown, record: { id: string }) => (
            <Space>
              <ShowButton recordItemId={record.id} hideText size="small" />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
