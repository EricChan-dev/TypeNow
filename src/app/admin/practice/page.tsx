"use client"

import { Input, Table, Space, Tag, Tooltip, Typography } from "antd"
import { List, useTable } from "@refinedev/antd"
import Link from "next/link"
import DrilldownBanner from "@/components/admin/DrilldownBanner"
import { drilldownBadges, withFilter, withoutDrilldown } from "@/lib/admin-drilldown"

const { Text } = Typography

/** camelCase —— API 用 Drizzle 属性名返回（写成 snake_case 会整列空白）。 */
interface PracticeRow {
  id: string
  userId: string
  sentenceId: string
  score: number | null
  mistakes: number
  isReview: number
  userInput: string | null
  createdAt: string
  userName: string | null
  userPhone: string | null
  chinese: string | null
  english: string | null
}

/** 后端返回的是不带时区的 "YYYY-MM-DD HH:MM:SS"，原样展示（Safari 解析不了带空格的形式）。 */
function fmtTime(v: string | null): string {
  return v ? String(v).replace("T", " ").slice(0, 19) : "—"
}

/**
 * 练习记录列表。
 *
 * 这一页是仪表盘「练习句数」的落点：那个数字此前点不动，无法回答
 * "这 31 条是谁练的、练的哪句、对错如何"。有了它，指标 → 记录 → 用户详情
 * 可以一路点下去。
 */
export default function PracticeRecordsList() {
  // 带 syncWithLocation：筛选条件进 URL，从仪表盘带 range 钻进来才能被 useTable 识别
  const { tableProps, filters, setFilters } = useTable({
    pagination: { pageSize: 20 },
    syncWithLocation: true,
  })

  return (
    <List
      title="练习记录"
      headerButtons={null}
      // 说明这一页的数字口径，避免和仪表盘的「练习句数」看起来是两回事
    >
      <DrilldownBanner
        badges={drilldownBadges(filters as never)}
        onClear={() => setFilters(withoutDrilldown(filters as never), "replace")}
      />

      <div style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="搜索用户昵称 / 手机号 / 句子内容"
          style={{ width: 360 }}
          onSearch={(value) =>
            // 只替换 q，保留钻取条件 —— 否则搜一下就把时间范围丢了
            setFilters(withFilter(filters as never, "q", value.trim()), "replace")
          }
        />
      </div>

      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="createdAt"
          title="练习时间"
          width={170}
          render={(v: string) => fmtTime(v)}
        />
        <Table.Column
          dataIndex="userId"
          title="用户"
          width={180}
          render={(_: string, row: PracticeRow) => (
            <Space size={4}>
              <Link href={`/admin/users/${row.userId}`}>{row.userName || "(未命名)"}</Link>
              {row.userPhone ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {row.userPhone}
                </Text>
              ) : null}
            </Space>
          )}
        />
        <Table.Column
          dataIndex="chinese"
          title="句子"
          ellipsis
          render={(_: string | null, row: PracticeRow) => {
            // 句子可能因内容下架被删：这里显示占位而不是空白，
            // 否则会让人以为"练习了空句子"
            if (!row.chinese && !row.english) {
              return <Text type="secondary">（句子已删除）</Text>
            }
            return (
              <Tooltip title={row.english ?? ""}>
                <span>{row.chinese ?? row.english}</span>
              </Tooltip>
            )
          }}
        />
        <Table.Column
          dataIndex="score"
          title="得分"
          width={90}
          render={(v: number | null) =>
            v == null ? (
              <Text type="secondary">—</Text>
            ) : (
              <Tag color={v >= 90 ? "green" : v >= 60 ? "orange" : "red"}>{v}</Tag>
            )
          }
        />
        <Table.Column dataIndex="mistakes" title="错字" width={70} />
        <Table.Column
          dataIndex="isReview"
          title="类型"
          width={80}
          render={(v: number) => (v ? <Tag color="purple">复习</Tag> : <Tag>新学</Tag>)}
        />
        <Table.Column
          dataIndex="userInput"
          title="用户输入"
          ellipsis
          render={(v: string | null) => v || <Text type="secondary">—</Text>}
        />
      </Table>
    </List>
  )
}
