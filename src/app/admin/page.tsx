"use client"

import { Card, Col, Row, Statistic, Table, Typography } from "antd"
import {
  UserOutlined,
  DollarOutlined,
  CrownOutlined,
  FileTextOutlined,
} from "@ant-design/icons"
import { useEffect, useState } from "react"

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
      try {
        const [usersRes, subsRes, sentencesRes, paymentsRes] = await Promise.all([
          fetch("/api/admin/users?pageSize=1"),
          fetch("/api/admin/subscriptions?pageSize=1"),
          fetch("/api/admin/sentences?pageSize=1"),
          fetch("/api/admin/payment-orders?pageSize=10"),
        ])
        const [usersData, subsData, sentencesData, paymentsData] = await Promise.all([
          usersRes.json(), subsRes.json(), sentencesRes.json(), paymentsRes.json(),
        ])
        const payments: Array<Record<string, unknown>> = paymentsData.data ?? []
        const totalRev = payments
          .filter((p) => p.status === "paid")
          .reduce((sum, p) => sum + ((p.amount as number) || 0), 0)

        setStats({
          totalUsers: usersData.total ?? 0,
          activeSubs: subsData.total ?? 0,
          totalRevenue: totalRev / 100,
          totalSentences: sentencesData.total ?? 0,
          recentPayments: payments,
        })
      } catch {
        // no-op
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  const paymentColumns = [
    { title: "用户ID", dataIndex: "user_id", key: "user_id", ellipsis: true },
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
      <Title level={3} style={{ marginBottom: 24 }}>管理仪表盘</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="注册用户" value={stats.totalUsers} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="活跃订阅" value={stats.activeSubs} prefix={<CrownOutlined />} valueStyle={{ color: "#6366F1" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="总收入" value={stats.totalRevenue} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: "#22C55E" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="句子库" value={stats.totalSentences} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card title="最近支付" style={{ marginTop: 24 }}>
        <Table
          columns={paymentColumns}
          dataSource={stats.recentPayments}
          rowKey={(r) => r.id as string}
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  )
}
