"use client"

import { List, useTable, ShowButton } from "@refinedev/antd"
import { Table, Tag, Space, Input } from "antd"

export default function UsersList() {
  const { tableProps, searchFormProps } = useTable({
    pagination: { pageSize: 20 },
  })

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="name" title="昵称" ellipsis />
        <Table.Column dataIndex="phone" title="手机" width={140} />
        <Table.Column
          dataIndex="is_pro"
          title="会员"
          width={80}
          render={(p: boolean) =>
            p ? <Tag color="blue">PRO</Tag> : <Tag>免费</Tag>
          }
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
          dataIndex="created_at"
          title="注册时间"
          width={180}
          render={(d: string) =>
            d ? new Date(d).toLocaleString("zh-CN") : "-"
          }
        />
        <Table.Column
          title="操作"
          width={80}
          render={(_, record: { id: string }) => (
            <Space>
              <ShowButton recordItemId={record.id} hideText size="small" />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
