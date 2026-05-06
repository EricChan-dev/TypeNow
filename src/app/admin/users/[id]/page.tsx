"use client"

import { useEffect, useState } from "react"
import { Descriptions, Card, Tag, Spin, Typography } from "antd"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

const { Title } = Typography

export default function UserShow() {
  const params = useParams()
  const id = params?.id as string
  const [loading, setLoading] = useState(true)
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    async function fetch() {
      if (!id) return
      const supabase = createClient()
      if (!supabase) { setLoading(false); return }
      const { data } = await supabase.from("profiles").select("*").eq("id", id).single()
      setRecord(data)
      setLoading(false)
    }
    fetch()
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
          <Descriptions.Item label="总分">{(record.total_score as number) || 0}</Descriptions.Item>
          <Descriptions.Item label="会员状态">
            {record.is_pro ? <Tag color="blue">PRO</Tag> : <Tag>免费用户</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="会员到期">
            {record.pro_expires
              ? new Date(record.pro_expires as string).toLocaleString("zh-CN")
              : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="角色">
            {record.role === "admin" ? <Tag color="purple">管理员</Tag> : <Tag>用户</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="注册时间">
            {record.created_at
              ? new Date(record.created_at as string).toLocaleString("zh-CN")
              : "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}
