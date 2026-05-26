"use client"

import { List, CreateButton, useTable, EditButton, DeleteButton } from "@refinedev/antd"
import { Table, Space, Tag } from "antd"

export default function CoursesList() {
  const { tableProps } = useTable({ pagination: { pageSize: 20 } })

  return (
    <List headerButtons={<CreateButton>新增课程</CreateButton>}>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="title" title="标题" ellipsis />
        <Table.Column dataIndex="source_name" title="来源" width={100} />
        <Table.Column dataIndex="category_key" title="分类" width={100} />
        <Table.Column
          dataIndex="is_published"
          title="状态"
          width={80}
          render={(v: number) => (
            <Tag color={v ? "green" : "default"}>{v ? "已发布" : "草稿"}</Tag>
          )}
        />
        <Table.Column dataIndex="learner_count" title="学习人数" width={100} />
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
