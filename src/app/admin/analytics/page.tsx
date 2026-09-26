"use client"

import { useEffect, useState } from "react"
import { Alert, Card, Col, Row, Segmented, Spin, Statistic, Table, Tag, Typography } from "antd"

const { Title, Text } = Typography

interface FunnelStep {
  key: string
  label: string
  source: "db" | "events"
  value: number
  stepRate: number | null
  overallRate: number | null
}

interface FunnelData {
  funnel: FunnelStep[]
  domain: {
    registered: number
    practicedUsers: number
    practiceRecords: number
    paidUsers: number
    paidOrders: number
    revenueFen: number
    subscriptions: number
  }
  events: Array<{ eventType: string; events: number; users: number }>
  daily: Array<{ date: string; events: number; users: number }>
  topPages: Array<{ page: string; count: number }>
}

function pct(v: number | null): string {
  if (v === null) return "—"
  return `${(v * 100).toFixed(1)}%`
}

/**
 * 首启漏斗报表。
 *
 * 口径是**混合**的，界面上用标签明确标出每一步的数从哪来：
 *   数据库（绿）—— 注册 / 练完至少一句 / 付费。权威，不依赖客户端上报。
 *   埋点（蓝）  —— 打开课程 / 进入练习 / 领取体验 / 看过定价。
 * 标出来是为了让人不会拿「埋点少报」去误判成「用户没做」。
 *
 * 这个页面此前只有「今日事件数 / 本周事件数 / 热门页面」三项，而热门页面依赖
 * page_view —— 那个事件从写下 helper 那天起就没有任何调用点，所以线上一直是空表。
 */
export default function AnalyticsPage() {
  const [data, setData] = useState<FunnelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trend, setTrend] = useState<"daily" | "events">("daily")

  useEffect(() => {
    fetch("/api/admin/analytics/funnel")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
        <Spin />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <Title level={3}>数据分析</Title>
        <Alert type="error" showIcon message="加载失败" description={error ?? "无数据"} />
      </div>
    )
  }

  const top = data.funnel[0]?.value ?? 0
  const maxValue = Math.max(top, 1)

  const eventCols = [
    { title: "事件", dataIndex: "eventType", key: "eventType" },
    { title: "上报次数", dataIndex: "events", key: "events", width: 110 },
    { title: "去重人数", dataIndex: "users", key: "users", width: 110 },
  ]

  const dailyCols = [
    { title: "日期", dataIndex: "date", key: "date" },
    { title: "事件数", dataIndex: "events", key: "events", width: 110 },
    { title: "去重人数", dataIndex: "users", key: "users", width: 110 },
  ]

  const pageCols = [
    { title: "页面", dataIndex: "page", key: "page" },
    { title: "浏览量", dataIndex: "count", key: "count", width: 110 },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        数据分析
      </Title>
      <Text type="secondary">
        首启漏斗 · 注册 → 打开课程 → 进入练习 → 练完一句 → 领取体验 → 看定价 → 付费
      </Text>

      {/* 关键指标：全部走数据库权威口径 */}
      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="注册用户" value={data.domain.registered} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="练过至少一句"
              value={data.domain.practicedUsers}
              suffix={`/ ${data.domain.registered}`}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="付费用户" value={data.domain.paidUsers} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="累计收入"
              value={(data.domain.revenueFen / 100).toFixed(2)}
              prefix="¥"
            />
          </Card>
        </Col>
      </Row>

      {/* 漏斗 */}
      <Card title="首启漏斗" style={{ marginTop: 20 }}>
        {data.funnel.map((step) => {
          const width = Math.round((step.value / maxValue) * 100)
          return (
            <div key={step.key} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, minWidth: 110 }}>{step.label}</span>
                <Tag color={step.source === "db" ? "green" : "blue"} style={{ marginRight: 0 }}>
                  {step.source === "db" ? "数据库" : "埋点"}
                </Tag>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{step.value.toLocaleString()}</span>
                <span style={{ color: "#999", fontSize: 12 }}>
                  上一步转化 {pct(step.stepRate)} · 整体 {pct(step.overallRate)}
                </span>
              </div>
              <div style={{ height: 10, background: "rgba(127,127,127,0.15)", borderRadius: 5 }}>
                <div
                  style={{
                    width: `${width}%`,
                    height: "100%",
                    borderRadius: 5,
                    background:
                      step.source === "db"
                        ? "linear-gradient(90deg,#52c41a,#95de64)"
                        : "linear-gradient(90deg,#1677ff,#69b1ff)",
                  }}
                />
              </div>
            </div>
          )
        })}

        <Alert
          style={{ marginTop: 8 }}
          type="info"
          showIcon
          message="口径说明"
          description={
            <>
              绿色步骤取自数据库（注册 / 练完至少一句 / 付费），不受客户端上报影响；
              蓝色步骤只有埋点能回答。因此蓝色数字明显偏低时，通常是埋点被广告拦截器挡掉
              或漏发，而不是用户没做。付费口径含测试单（历史上有两笔 1 分钱测试订单）。
            </>
          }
        />
      </Card>

      {/* 事件分布 + 趋势 */}
      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        <Col xs={24} lg={12}>
          <Card title="事件分布（全部历史）">
            <Table
              columns={eventCols}
              dataSource={data.events}
              rowKey="eventType"
              size="small"
              pagination={false}
              locale={{ emptyText: "还没有任何埋点上报" }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title="近 14 天趋势"
            extra={
              <Segmented
                size="small"
                value={trend}
                onChange={(v) => setTrend(v as "daily" | "events")}
                options={[
                  { label: "按天", value: "daily" },
                  { label: "事件", value: "events" },
                ]}
              />
            }
          >
            {trend === "daily" ? (
              <Table
                columns={dailyCols}
                dataSource={data.daily}
                rowKey="date"
                size="small"
                pagination={false}
                locale={{ emptyText: "近 14 天没有埋点上报" }}
              />
            ) : (
              <Table
                columns={eventCols}
                dataSource={data.events}
                rowKey="eventType"
                size="small"
                pagination={{ pageSize: 8, size: "small" }}
                locale={{ emptyText: "还没有任何埋点上报" }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="热门页面（page_view）" style={{ marginTop: 20 }}>
        <Table
          columns={pageCols}
          dataSource={data.topPages}
          rowKey="page"
          size="small"
          pagination={false}
          locale={{ emptyText: "还没有 page_view 上报" }}
        />
      </Card>
    </div>
  )
}
