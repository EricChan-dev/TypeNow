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
      /**
       * 单个接口失败不能拖垮整个仪表盘。
       *
       * 原先四个请求的 .json() 一起 Promise.all：只要有一个返回非 JSON
       * （例如接口不存在时 Next 返回 404 HTML），.json() 就抛错，
       * catch 把整页统计一起吞掉 —— 一个坏接口表现为"仪表盘完全打不开"。
       * 2026-09-26 就是这么发生的：/api/admin/subscriptions 整个缺失。
       * 现在逐个请求独立兜底，坏掉的那项显示 0，其余照常。
       */
      const safeJson = async <T,>(url: string, fallback: T): Promise<T> => {
        try {
          const res = await fetch(url)
          if (!res.ok) return fallback
          const text = await res.text()
          try {
            return JSON.parse(text) as T
          } catch {
            return fallback
          }
        } catch {
          return fallback
        }
      }

      const [usersData, subsData, sentencesData, paymentsData] = await Promise.all([
        safeJson<{ total?: number }>("/api/admin/users?pageSize=1", {}),
        safeJson<{ total?: number }>("/api/admin/subscriptions?pageSize=1", {}),
        safeJson<{ total?: number }>("/api/admin/sentences?pageSize=1", {}),
        safeJson<{ data?: Array<Record<string, unknown>> }>("/api/admin/payment-orders?pageSize=10", {}),
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
      setLoading(false)
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
