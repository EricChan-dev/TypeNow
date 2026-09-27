"use client"

import { List, CreateButton, useTable, EditButton, DeleteButton } from "@refinedev/antd"
import { Input, Table, Space } from "antd"

export default function LessonsList() {
  const { tableProps, setFilters } = useTable({
    pagination: { pageSize: 50 },
    syncWithLocation: true,
  })

  return (
    <List headerButtons={<CreateButton>新增课时</CreateButton>}>
      <div style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="搜索课时名称 / 简介"
          style={{ width: 320 }}
          onSearch={(value) =>
            setFilters([{ field: "q", operator: "eq", value }], "replace")
          }
        />
      </div>

      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="title" title="课时名称" ellipsis />
        <Table.Column dataIndex="courseId" title="课程ID" width={200} ellipsis />
        <Table.Column dataIndex="sortOrder" title="排序" width={80} />
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
