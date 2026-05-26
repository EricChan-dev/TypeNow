"use client"

import { useRouter } from "next/navigation"
import { List, CreateButton, useTable, DeleteButton } from "@refinedev/antd"
import { Table, Space, Switch, Button, message, Avatar } from "antd"
import { EyeOutlined, EditOutlined, PictureOutlined } from "@ant-design/icons"

export default function CoursesList() {
  const router = useRouter()
  const { tableProps, tableQuery } = useTable({ pagination: { pageSize: 20 } })

  async function togglePublish(id: string, checked: boolean) {
    try {
      const res = await fetch(`/api/admin/courses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: checked ? 1 : 0 }),
      })
      if (!res.ok) throw new Error("操作失败")
      message.success(checked ? "已启用" : "已禁用")
      tableQuery.refetch()
    } catch {
      message.error("操作失败")
    }
  }

  return (
    <List headerButtons={<CreateButton>新增课程</CreateButton>}>
      <Table
        {...tableProps}
        rowKey="id"
        onRow={(record) => ({
          onClick: () => router.push(`/admin/courses/${String(record.id)}`),
          style: { cursor: "pointer" },
        })}
      >
        <Table.Column
          dataIndex="cover_url"
          title="封面"
          width={64}
          render={(url: string | null) =>
            url ? (
              <img src={url} alt="封面" style={{ width: 48, height: 27, objectFit: "cover", borderRadius: 3, display: "block" }} />
            ) : (
              <Avatar shape="square" size={48} icon={<PictureOutlined />} style={{ background: "#6366f1" }} />
            )
          }
        />
        <Table.Column dataIndex="title" title="标题" ellipsis />
        <Table.Column dataIndex="source_name" title="来源" width={80} />
        <Table.Column dataIndex="category_key" title="分类" width={100} />
        <Table.Column
          dataIndex="is_published"
          title="启用"
          width={80}
          render={(v: number, record: { id: string }) => (
            <span onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!!v}
                size="small"
                onChange={(checked) => togglePublish(record.id, checked)}
              />
            </span>
          )}
        />
        <Table.Column
          dataIndex="learner_count"
          title="学习人数"
          width={90}
        />
        <Table.Column
          title="操作"
          width={160}
          render={(_: unknown, record: { id: string; is_published: number }) => (
            <Space onClick={(e) => e.stopPropagation()}>
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => router.push(`/admin/courses/${record.id}`)}
              >
                详情
              </Button>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => router.push(`/admin/courses/${record.id}/edit`)}
              >
                编辑
              </Button>
              <DeleteButton recordItemId={record.id} hideText size="small" />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
