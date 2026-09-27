"use client"

import { Card, Col, Row, Segmented, Statistic, Table, Tag, Typography } from "antd"
import {
  UserOutlined,
  DollarOutlined,
  CrownOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { RANGE_OPTIONS, DEFAULT_RANGE, type StatsRange } from "@/lib/admin-range"

const { Title, Text } = Typography

interface DashboardData {
  range: StatsRange
  rangeLabel: string
  activity: {
    newUsers: number
    activeUsers: number
    practiceRecords: number
    events: number
    paidOrders: number
    revenueFen: number
    trialClaims: number
  }
  totals: {
    users: number
    activeSubscriptions: number
    sentences: number | null
    courses: number | null
    lessons: number | null
  }
  daily: Array<{ date: string; newUsers: number; practice: number; events: number; revenueFen: number }>
}

interface OrderRow {
  id: string
  userId: string
  userName: string | null
  userPhone: string | null
  plan: string
  amount: number
  status: string
  outTradeNo: string
  paidAt: string | null
  createdAt: string
}

export default function AdminDashboard() {
  const [range, setRange] = useState<StatsRange>(DEFAULT_RANGE)
  const [data, setData] = useState<DashboardData | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (r: StatsRange) => {
    setLoading(true)
    try {
      // 单个接口失败不拖垮整页（此前一个 404 让整页 Promise.all 抛错）
      const [dashRes, orderRes] = await Promise.all([
        fetch(`/api/admin/dashboard?range=${r}`),
        fetch("/api/admin/payment-orders?pageSize=10"),
      ])
      if (dashRes.ok) setData((await dashRes.json()) as DashboardData)
      if (orderRes.ok) setOrders(((await orderRes.json()).data ?? []) as OrderRow[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(range)
  }, [range, load])

  const a = data?.activity
  const t = data?.totals

  const orderColumns = [
    {
      title: "用户",
      key: "user",
      render: (_: unknown, r: OrderRow) => (
        <Link href={`/admin/users/${r.userId}`} style={{ color: "#1677ff" }}>
          {r.userName || "（无名）"}
          {r.userPhone ? ` · ${r.userPhone.slice(0, 3)}****${r.userPhone.slice(-4)}` : ""}
        </Link>
      ),
    },
    { title: "方案", dataIndex: "plan", key: "plan", width: 90 },
    {
      title: "金额",
      dataIndex: "amount",
      key: "amount",
      width: 100,
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (s: string) => (
        <Tag color={s === "paid" ? "green" : s === "pending" ? "orange" : "default"}>
          {s === "paid" ? "已支付" : s === "pending" ? "待支付" : s}
        </Tag>
      ),
    },
    {
      title: "支付时间",
      dataIndex: "paidAt",
      key: "paidAt",
      width: 170,
      render: (d: string | null) => (d ? new Date(d).toLocaleString("zh-CN") : "—"),
    },
  ]

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <Title level={3} style={{ margin: 0 }}>管理仪表盘</Title>
        <Segmented
          value={range}
          onChange={(v) => setRange(v as StatsRange)}
          options={RANGE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
        />
      </div>

      {/* ── 行为指标：随上方时间范围变化 ── */}
      <Text type="secondary" style={{ display: "block", margin: "16px 0 8px" }}>
        <ThunderboltOutlined /> 行为指标 · {data?.rangeLabel ?? "—"}
      </Text>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="新增用户" value={a?.newUsers ?? 0} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="活跃用户（有练习）" value={a?.activeUsers ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="练习句数" value={a?.practiceRecords ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="埋点事件" value={a?.events ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="付费订单" value={a?.paidOrders ?? 0} prefix={<DollarOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="收入"
              value={((a?.revenueFen ?? 0) / 100).toFixed(2)}
              prefix="¥"
              valueStyle={{ color: "#22C55E" }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="领取体验会员" value={a?.trialClaims ?? 0} />
          </Card>
        </Col>
      </Row>

      {/* ── 内容总量：不随时间筛选 ── */}
      <Text type="secondary" style={{ display: "block", margin: "24px 0 8px" }}>
        <FileTextOutlined /> 内容总量 · 全部（不受上方时间范围影响）
      </Text>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="用户总数" value={t?.users ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="活跃订阅" value={t?.activeSubscriptions ?? 0} prefix={<CrownOutlined />} valueStyle={{ color: "#6366F1" }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="课程 / 课时" value={t ? `${t.courses ?? "—"} / ${t.lessons ?? "—"}` : "—"} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            {/* 句子库走 10 分钟缓存：46 万行的 COUNT(*) 实测 104~356ms，不该每次打开后台都跑 */}
            <Statistic title="句子库（缓存 10 分钟）" value={t?.sentences ?? "—"} />
          </Card>
        </Col>
      </Row>

      <Card title="最近支付" style={{ marginTop: 24 }}>
        <Table
          columns={orderColumns}
          dataSource={orders}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: "暂无订单" }}
        />
      </Card>
    </div>
  )
}
