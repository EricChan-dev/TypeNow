"use client"

import { useEffect, useState } from "react"
import { Descriptions, Card, Tag, Spin, Typography } from "antd"
import { useParams } from "next/navigation"

const { Title } = Typography

export default function UserShow() {
  const params = useParams()
  const id = params?.id as string
  const [loading, setLoading] = useState(true)
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/admin/users/${id}`)
      .then((r) => r.json())
      .then((data) => setRecord(data.data ?? null))
      .catch(() => setRecord(null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />
  if (!record) return <Title level={4}>用户不存在</Title>

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>用户详情</Title>
      <Card>
        <Descriptions bordered column={2}>
          <Descriptions.Item label="昵称">{(record.name as string) || "-"}</Descriptions.Item>
          <Descriptions.Item label="手机">{(record.phone as string) || "-"}</Descriptions.Item>
          <Descriptions.Item label="等级">{(record.level as number) || 1}</Descriptions.Item>
          <Descriptions.Item label="总分">{(record.totalScore as number) || 0}</Descriptions.Item>
          <Descriptions.Item label="会员状态">
            {record.isPro ? <Tag color="blue">PRO</Tag> : <Tag>免费用户</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="会员到期">
            {record.proExpires ? new Date(record.proExpires as string).toLocaleString("zh-CN") : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="角色">
            {record.role === "admin" ? <Tag color="purple">管理员</Tag> : <Tag>用户</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="注册时间">
            {record.createdAt ? new Date(record.createdAt as string).toLocaleString("zh-CN") : "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}
