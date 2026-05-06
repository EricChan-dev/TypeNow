"use client"

import { List, CreateButton, useTable, EditButton, DeleteButton } from "@refinedev/antd"
import { Table, Space, Tag } from "antd"

export default function SentencesList() {
  const { tableProps } = useTable({ pagination: { pageSize: 20 } })

  return (
    <List headerButtons={<CreateButton>新增句子</CreateButton>}>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="chinese" title="中文" ellipsis />
        <Table.Column dataIndex="english" title="英文" ellipsis />
        <Table.Column
          dataIndex="difficulty"
          title="难度"
          width={80}
          render={(d: number) => (
            <Tag color={d === 1 ? "green" : d === 2 ? "gold" : "red"}>
              {d === 1 ? "简单" : d === 2 ? "中等" : "较难"}
            </Tag>
          )}
        />
        <Table.Column dataIndex="category" title="分类" width={100} />
        <Table.Column
          title="操作"
          width={120}
          render={(_, record: { id: string }) => (
            <Space>
              <EditButton recordItemId={record.id} hideText size="small" />
              <DeleteButton recordItemId={record.id} hideText size="small" />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
