"use client"

import { useState } from "react"
import Link from "next/link"
import { Alert, Card, Col, Row, Segmented, Space, Spin, Statistic, Tag, Typography } from "antd"
import { LineChartOutlined } from "@ant-design/icons"
import EChart from "@/components/admin/EChart"
import { funnelRateOption } from "@/lib/admin-chart-options"
import { RANGE_OPTIONS, DEFAULT_RANGE, type StatsRange } from "@/lib/admin-range"
import { eventsUrl } from "@/lib/admin-links"
import { useAdminFetch } from "@/lib/admin-fetch"

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
  range: StatsRange
  rangeLabel: string
  cohortSize: number
  cohortNote: string
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
}

function pct(v: number | null): string {
  if (v === null) return "—"
  return `${(v * 100).toFixed(1)}%`
}

/**
 * 每个漏斗步骤点进去看什么。
 *
 * 「可查指标背后的埋点详情」在这里落地：**埋点口径的步骤**直接钻到
 * /admin/events 的原始记录（并且带着当前时间范围，否则点过去看到的是全量，
 * 和报表上的数字对不上，会让人以为埋点丢了）；**数据库口径的步骤**没有
 * 对应的埋点可查，就送到权威列表页（用户 / 支付订单）。
 *
 * 不给出链接的步骤一律显示成纯文本，而不是"点了没反应"的假链接 ——
 * 假链接比没有链接更消耗信任。
 */
function stepHref(step: FunnelStep, range: StatsRange): string | null {
  switch (step.key) {
    case "course_open":
    case "lesson_start":
    case "trial_claimed":
    case "pricing_view":
      return eventsUrl({ event: step.key, range })
    case "registered":
      return "/admin/users"
    case "paid":
      return "/admin/payments"
    default:
      return null
  }
}

/**
 * 首启漏斗报表。
 *
 * 口径是**混合**的，界面上用标签明确标出每一步的数从哪来：
 *   数据库（绿）—— 注册 / 练完至少一句 / 付费。权威，不依赖客户端上报。
 *   埋点（蓝）  —— 打开课程 / 进入练习 / 领取体验 / 看过定价。
 * 标出来是为了让人不会拿「埋点少报」去误判成「用户没做」。
 *
 * 这一页只回答「首启漏斗转化如何」。事件分布、趋势、页面排行、原始记录
 * 全部在【埋点分析】页 —— 同一份数据在两个页面各画一遍，迟早会改出不一致。
 */
export default function AnalyticsPage() {
  const [range, setRange] = useState<StatsRange>(DEFAULT_RANGE)

  const { data, loading, error } = useAdminFetch<FunnelData>(
    `/api/admin/analytics/funnel?range=${range}`,
  )

  const rangeSegmented = (
    <Segmented
      value={range}
      onChange={(v) => setRange(v as StatsRange)}
      options={RANGE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
    />
  )

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <Title level={3} style={{ margin: 0 }}>数据分析</Title>
          {rangeSegmented}
        </div>
        <Alert style={{ marginTop: 16 }} type="error" showIcon message="加载失败" description={error ?? "无数据"} />
      </div>
    )
  }

  const top = data.funnel[0]?.value ?? 0
  const maxValue = Math.max(top, 1)
  // 漏斗全为 0 时不要画一张空图 —— 新站点这才是常态，直接说明比空图好
  const funnelEmpty = data.funnel.every((s) => s.value === 0)

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <Title level={3} style={{ margin: 0 }}>数据分析</Title>
        {rangeSegmented}
      </div>
      <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
        首启漏斗 · 注册 → 打开课程 → 进入练习 → 练完一句 → 领取体验 → 看定价 → 付费
      </Text>

      {/* 关键指标：全部走数据库权威口径 */}
      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={`注册用户（${data.rangeLabel}）`} value={data.domain.registered} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="练过至少一句"
              value={data.domain.practicedUsers}
              suffix={`/ ${data.domain.registered}`}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="付费用户" value={data.domain.paidUsers} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="累计收入"
              value={(data.domain.revenueFen / 100).toFixed(2)}
              prefix="¥"
            />
          </Card>
        </Col>
      </Row>
      <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
        注册 / 练过至少一句 / 付费 三个数取自数据库，不受客户端埋点是否被拦截影响。
        付费口径含测试单（历史上有两笔 1 分钱测试订单）。
      </Text>

      {/* 漏斗 */}
      <Card title={`首启漏斗（${data.rangeLabel}）`} style={{ marginTop: 20 }}>
        <EChart
          option={funnelRateOption(
            data.funnel.map((s) => ({ label: s.label, value: s.value, stepRate: s.stepRate })),
          )}
          height={Math.max(220, data.funnel.length * 40)}
          empty={funnelEmpty}
          emptyText="该时间范围内没有任何漏斗数据"
        />

        <div style={{ marginTop: 16 }}>
          {data.funnel.map((step) => {
            const width = Math.round((step.value / maxValue) * 100)
            const href = stepHref(step, range)
            return (
              <div key={step.key} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, minWidth: 110 }}>{step.label}</span>
                  <Tag color={step.source === "db" ? "green" : "blue"} style={{ marginRight: 0 }}>
                    {step.source === "db" ? "数据库" : "埋点"}
                  </Tag>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{step.value.toLocaleString()}</span>
                  <span style={{ color: "#999", fontSize: 12 }}>
                    上一步转化 {pct(step.stepRate)} · 整体 {pct(step.overallRate)}
                  </span>
                  {href ? (
                    <Link href={href} style={{ fontSize: 12 }}>
                      看明细 →
                    </Link>
                  ) : null}
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
        </div>

        <Alert
          style={{ marginTop: 8 }}
          type="warning"
          showIcon
          message="同期群口径"
          description={data.cohortNote}
        />

        <Alert
          style={{ marginTop: 8 }}
          type="info"
          showIcon
          message="数据来源说明"
          description={
            <>
              绿色步骤取自数据库（注册 / 练完至少一句 / 付费），不受客户端上报影响；
              蓝色步骤只有埋点能回答。因此蓝色数字明显偏低时，通常是埋点被广告拦截器挡掉
              或漏发，而不是用户没做。点每一步的「看明细」可以核对背后是哪些具体记录。
            </>
          }
        />
      </Card>

      <Card size="small" style={{ marginTop: 20 }}>
        <Space>
          <LineChartOutlined />
          <Text>
            事件分布、趋势、页面排行、24 小时分布与原始记录都在{" "}
            <Link href={eventsUrl({ range })}>埋点分析</Link> 页，可按事件 / 身份 / 页面 / 关键词筛。
          </Text>
        </Space>
      </Card>
    </div>
  )
}
