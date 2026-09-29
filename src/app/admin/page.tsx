"use client"

import { Card, Col, Row, Segmented, Table, Tag, Typography } from "antd"
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
import MetricCard from "@/components/admin/MetricCard"
import { multiLineOption } from "@/lib/admin-chart-options"
import { eventsUrl, listUrl } from "@/lib/admin-links"
import { useAdminFetch } from "@/lib/admin-fetch"
import { RANGE_OPTIONS, DEFAULT_RANGE, type StatsRange } from "@/lib/admin-range"
import { formatAdminTime } from "@/lib/admin-time"

const { Title, Text } = Typography

interface DashboardData {
  range: StatsRange
  rangeLabel: string
  activity: {
    newUsers: number
    activeUsers: number
    practiceRecords: number
    events: number
    /** 独立访客（含未登录的人，见 lib/visitor.ts）。与 newUsers 并排看就是注册转化率 */
    visitors: number
    /** 未登录事件占比（0~1）；没有事件时为 null，界面显示「—」 */
    anonymousRate: number | null
    paidOrders: number
    revenueFen: number
    trialClaims: number
  }
  /** 待处理反馈（待办，不随时间范围变化） */
  pendingFeedback: number
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
      render: (d: string | null) => (d ? formatAdminTime(d) : "—"),
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

      {/* ── 行为指标：随上方时间范围变化，且**每一个都**能点进明细 ──
          链接一律带上当前 range：不带的话落点是全量列表，条数比卡片上的数字多，
          看起来就像仪表盘算错了。 */}
      <Text type="secondary" style={{ display: "block", margin: "16px 0 8px" }}>
        <ThunderboltOutlined /> 行为指标 · {data?.rangeLabel ?? "—"} · 点卡片看构成这些数的记录
      </Text>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          {/* 放在「新增用户」前面：访客 → 注册 是漏斗顺序，
              两个数并排就自然读出注册转化率（此前仪表盘只有事件总数，看不出人数） */}
          <MetricCard
            title="独立访客"
            value={a?.visitors ?? 0}
            loading={loading}
            href={eventsUrl({ range, identity: "anonymous" })}
            drillHint="仅看未登录的原始记录"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="新增用户"
            value={a?.newUsers ?? 0}
            prefix={<UserOutlined />}
            loading={loading}
            href={listUrl("/admin/users", [{ field: "range", value: range }])}
            drillHint="这段时间注册的用户"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="活跃用户（有练习）"
            value={a?.activeUsers ?? 0}
            loading={loading}
            href={listUrl("/admin/users", [
              { field: "range", value: range },
              { field: "active", value: 1 },
            ])}
            drillHint="这段时间练过的用户"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="练习句数"
            value={a?.practiceRecords ?? 0}
            loading={loading}
            href={listUrl("/admin/practice", [{ field: "range", value: range }])}
            drillHint="逐条练习记录"
          />
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
            // status=paid：指标只统计已支付订单，不带状态条数会对不上
            href={listUrl("/admin/payments", [
              { field: "range", value: range },
              { field: "status", value: "paid" },
            ])}
            drillHint="已支付订单"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="收入"
            value={((a?.revenueFen ?? 0) / 100).toFixed(2)}
            prefix="¥"
            valueStyle={{ color: "#22C55E" }}
            loading={loading}
            href={listUrl("/admin/payments", [
              { field: "range", value: range },
              { field: "status", value: "paid" },
            ])}
            drillHint="已支付订单"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="领取体验会员"
            value={a?.trialClaims ?? 0}
            loading={loading}
            // 领取记录就是 users.trial_claimed_at（没有独立表，见 00012 迁移），
            // 所以落点是"这段时间领过的用户"而不是某张事件表
            href={listUrl("/admin/users", [
              { field: "range", value: range },
              { field: "trial", value: 1 },
            ])}
            drillHint="这段时间领取的用户"
          />
        </Col>
      </Row>

      {/* 未登录占比单独写一行文字而不是再加一张卡片：
          它的作用是解释「独立访客 vs 新增用户」的差值，不是又一个独立的 KPI。
          这个数很高说明流量多数没转化到账号 —— 是获客问题，不是产品功能问题。 */}
      <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
        {a?.anonymousRate === null || a?.anonymousRate === undefined
          ? "未登录事件占比：—（这段时间没有埋点事件）"
          : `未登录事件占比：${(a.anonymousRate * 100).toFixed(1)}%`}
        {" · "}独立访客按一年期 typ_vid cookie 去重（lib/visitor.ts），缺失时退回按会话计，
        因此这个数只会偏大、可当下界看；它含未注册的人，所以「独立访客 − 新增用户」
        大致就是来了但没注册的规模。
      </Text>

      {/* 行为趋势：卡片回答"多少"，这张图回答"什么时候、在涨还是在跌" */}
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

      {/* ── 内容总量：不随时间筛选，但每一项都要能点到它自己的列表 ── */}
      <Text type="secondary" style={{ display: "block", margin: "24px 0 8px" }}>
        <FileTextOutlined /> 内容与存量 · 全部（不受上方时间范围影响）
      </Text>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <MetricCard
            title="用户总数"
            value={t?.users ?? 0}
            loading={loading}
            href="/admin/users"
            drillHint="全部用户"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="活跃订阅"
            value={t?.activeSubscriptions ?? 0}
            prefix={<CrownOutlined />}
            valueStyle={{ color: "#6366F1" }}
            loading={loading}
            // 与接口同口径（status=active），否则列表条数和这个数对不上
            href={listUrl("/admin/subscriptions", [{ field: "status", value: "active" }])}
            drillHint="生效中的订阅"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="课程"
            value={t?.courses ?? "—"}
            loading={loading}
            href="/admin/courses"
            drillHint="课程管理"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="课时"
            value={t?.lessons ?? "—"}
            loading={loading}
            href="/admin/lessons"
            drillHint="课时管理"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="句子库（缓存 10 分钟）"
            value={t?.sentences ?? "—"}
            loading={loading}
            href="/admin/sentences"
            drillHint="句子管理"
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="待处理反馈"
            // 没有待办时不着重标记；有待办时用橙色，扫一眼就知道要去做事
            value={data?.pendingFeedback ?? 0}
            valueStyle={
              (data?.pendingFeedback ?? 0) > 0 ? { color: "#FA8C16" } : undefined
            }
            loading={loading}
            // 与反馈页「未结束」同口径（待处理 + 处理中）
            href="/admin/feedback"
            drillHint="去处理"
          />
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
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  )
}
