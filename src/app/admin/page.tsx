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
import { useState } from "react"
import EChart from "@/components/admin/EChart"
import { multiLineOption } from "@/lib/admin-chart-options"
import { eventsUrl } from "@/lib/admin-links"
import { useAdminFetch } from "@/lib/admin-fetch"
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

/**
 * 可点击的指标卡。
 *
 * 「可查指标背后的埋点详情」在仪表盘上的落点：每个行为指标都要能一步走到
 * 构成它的明细。没有 drills 的指标（比如练习句数，后台没有逐条列表页）
 * 就渲染成普通卡片，**不做**假链接 —— 点了没反应比没有链接更消耗信任。
 */
function MetricCard({
  title,
  value,
  prefix,
  valueStyle,
  loading,
  href,
  drillHint,
}: {
  title: string
  value: string | number
  prefix?: React.ReactNode
  valueStyle?: React.CSSProperties
  loading?: boolean
  href?: string
  drillHint?: string
}) {
  const card = (
    <Card loading={loading} hoverable={Boolean(href)}>
      <Statistic title={title} value={value} prefix={prefix} valueStyle={valueStyle} />
      {href && drillHint ? (
        <div style={{ fontSize: 12, color: "#1677ff", marginTop: 4 }}>{drillHint} →</div>
      ) : null}
    </Card>
  )
  return href ? (
    <Link href={href} style={{ display: "block" }}>
      {card}
    </Link>
  ) : (
    card
  )
}

export default function AdminDashboard() {
  const [range, setRange] = useState<StatsRange>(DEFAULT_RANGE)

  // 两个接口各自独立取数：任何一个挂掉都不影响另一半渲染。
  // 早前是 Promise.all 一起 await，一个 404 会让整页指标全空。
  const { data, loading } = useAdminFetch<DashboardData>(`/api/admin/dashboard?range=${range}`)
  const { data: orderData } = useAdminFetch<{ data: OrderRow[] }>(
    "/api/admin/payment-orders?pageSize=10",
  )
  const orders = orderData?.data ?? []

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

      {/* ── 行为指标：随上方时间范围变化，且每个都能钻到明细 ── */}
      <Text type="secondary" style={{ display: "block", margin: "16px 0 8px" }}>
        <ThunderboltOutlined /> 行为指标 · {data?.rangeLabel ?? "—"} · 点卡片可看明细
      </Text>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <MetricCard
            title="新增用户"
            value={a?.newUsers ?? 0}
            prefix={<UserOutlined />}
            loading={loading}
            href="/admin/users"
            drillHint="用户列表"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="活跃用户（有练习）"
            value={a?.activeUsers ?? 0}
            loading={loading}
            href="/admin/users"
            drillHint="用户列表"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard title="练习句数" value={a?.practiceRecords ?? 0} loading={loading} />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="埋点事件"
            value={a?.events ?? 0}
            loading={loading}
            href={eventsUrl({ range })}
            drillHint="埋点分析"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="付费订单"
            value={a?.paidOrders ?? 0}
            prefix={<DollarOutlined />}
            loading={loading}
            href="/admin/payments"
            drillHint="支付订单"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="收入"
            value={((a?.revenueFen ?? 0) / 100).toFixed(2)}
            prefix="¥"
            valueStyle={{ color: "#22C55E" }}
            loading={loading}
            href="/admin/payments"
            drillHint="支付订单"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="领取体验会员"
            value={a?.trialClaims ?? 0}
            loading={loading}
            href={eventsUrl({ event: "trial_claimed", range })}
            drillHint="埋点明细"
          />
        </Col>
      </Row>

      <Card
        size="small"
        title={`行为趋势（${data?.rangeLabel ?? "—"}）`}
        style={{ marginTop: 16 }}
        extra={<Link href={eventsUrl({ range })}>埋点分析 →</Link>}
      >
        <EChart
          option={multiLineOption(
            (data?.daily ?? []) as unknown as Record<string, string | number>[],
            "date",
            [
              { key: "newUsers", label: "新增用户" },
              { key: "practice", label: "练习句数" },
              { key: "events", label: "埋点事件" },
            ],
          )}
          height={260}
          loading={loading}
          empty={!loading && (data?.daily?.length ?? 0) === 0}
          emptyText="该时间范围内没有行为数据"
        />
      </Card>

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
