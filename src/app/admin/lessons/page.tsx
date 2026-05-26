"use client"

import { List, CreateButton, useTable, EditButton, DeleteButton } from "@refinedev/antd"
import { Table, Space } from "antd"

export default function LessonsList() {
  const { tableProps } = useTable({ pagination: { pageSize: 50 } })

  return (
    <List headerButtons={<CreateButton>新增课时</CreateButton>}>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="title" title="课时名称" ellipsis />
        <Table.Column dataIndex="course_id" title="课程ID" width={200} ellipsis />
        <Table.Column dataIndex="sort_order" title="排序" width={80} />
        <Table.Column dataIndex="summary" title="简介" ellipsis />
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
