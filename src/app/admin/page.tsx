"use client"

import { Card, Col, Row, Statistic, Table, Typography } from "antd"
import {
  UserOutlined,
  DollarOutlined,
  CrownOutlined,
  FileTextOutlined,
} from "@ant-design/icons"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

const { Title } = Typography

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeSubs: 0,
    totalRevenue: 0,
    totalSentences: 0,
    recentPayments: [] as Array<Record<string, unknown>>,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      const supabase = createClient()
      if (!supabase) { setLoading(false); return }

      const [
        { count: userCount },
        { count: subCount },
        { count: sentenceCount },
        { data: payments },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase
          .from("subscriptions")
          .select("*", { count: "exact", head: true })
          .eq("status", "active"),
        supabase
          .from("sentences")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("payment_orders")
          .select("*, profiles(name)")
          .eq("status", "paid")
          .order("created_at", { ascending: false })
          .limit(10),
      ])

      const { data: revenueData } = await supabase
        .from("payment_orders")
        .select("amount")
        .eq("status", "paid")

      const totalRev =
        revenueData?.reduce((sum: number, p: Record<string, unknown>) => sum + ((p.amount as number) || 0), 0) || 0

      setStats({
        totalUsers: userCount || 0,
        activeSubs: subCount || 0,
        totalRevenue: totalRev / 100,
        totalSentences: sentenceCount || 0,
        recentPayments: payments || [],
      })
      setLoading(false)
    }
    fetchStats()
  }, [])

  const paymentColumns = [
    { title: "用户", dataIndex: "profiles", key: "user", render: (p: unknown) => (p as { name?: string })?.name || "-" },
    { title: "方案", dataIndex: "plan", key: "plan" },
    {
      title: "金额",
      dataIndex: "amount",
      key: "amount",
      render: (a: number) => `¥${(a / 100).toFixed(2)}`,
    },
    {
      title: "时间",
      dataIndex: "paid_at",
      key: "paid_at",
      render: (d: string) => (d ? new Date(d).toLocaleString("zh-CN") : "-"),
    },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        管理仪表盘
      </Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="注册用户"
              value={stats.totalUsers}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="活跃订阅"
              value={stats.activeSubs}
              prefix={<CrownOutlined />}
              valueStyle={{ color: "#6366F1" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="总收入"
              value={stats.totalRevenue}
              prefix={<DollarOutlined />}
              precision={2}
              valueStyle={{ color: "#22C55E" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="句子库"
              value={stats.totalSentences}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近支付" style={{ marginTop: 24 }}>
        <Table
          columns={paymentColumns}
          dataSource={stats.recentPayments as Record<string, unknown>[]}
          rowKey={(r) => r.id as string}
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  )
}
