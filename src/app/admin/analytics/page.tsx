"use client"

import { useState } from "react"
import Link from "next/link"
import { Alert, Card, Col, Row, Space, Spin, Table, Tag, Typography } from "antd"
import { LineChartOutlined } from "@ant-design/icons"
import EChart from "@/components/admin/EChart"
import MetricCard from "@/components/admin/MetricCard"
import { funnelRateOption } from "@/lib/admin-chart-options"
import { DEFAULT_RANGE, rangeQueryString, type StatsRange } from "@/lib/admin-range"
import { AdminRangePicker } from "@/components/admin/AdminRangePicker"
import { eventsUrl, listUrl } from "@/lib/admin-links"
import { useAdminFetch } from "@/lib/admin-fetch"

const { Title, Text } = Typography

interface FunnelStep {
  key: string
  label: string
  source: "db" | "events" | "traffic"
  value: number
  stepRate: number | null
  overallRate: number | null
}

interface Acquisition {
  visitors: number
  converted: number
  conversionRate: number | null
  visitorShortfall: boolean
  note: string
}

interface FunnelData {
  range: StatsRange
  rangeLabel: string
  cohortSize: number
  cohortNote: string
  acquisition: Acquisition
  funnel: FunnelStep[]
  breakdown: Breakdown
  domain: {
    registered: number
    practicedUsers: number
    practiceRecords: number
    paidUsers: number
    paidOrders: number
    revenueFen: number
    subscriptions: number
    visitors: number
  }
}

/** 按来源拆解的一行。分母统一是这一行的注册数 —— 见下方口径说明。 */
interface BreakdownRow {
  key: string
  label: string
  registered: number
  practiced: number
  paid: number
  practiceRate: number | null
  payRate: number | null
}

interface Breakdown {
  bySignupChannel: BreakdownRow[]
  byReferral: BreakdownRow[]
  byUtmSource: BreakdownRow[]
  /**
   * 分渠道注册数之和与同期群总数的一致性。
   *
   * 不一致就说明两处口径漂移了（例如某一处改了时间过滤而另一处没改）。
   * 这种情况**必须显式暴露**：报表里"分渠道加起来不等于总数"会让人先怀疑
   * 数据错了，而不是怀疑口径不同，然后整页数字都不敢用。
   */
  consistency: { registeredSum: number; cohortSize: number; consistent: boolean }
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
    // 访客步骤没有对应的单一事件可筛，落点是"仅匿名"的原始记录 ——
    // 也就是「来了但没注册」那批人，正是这一步要看的东西
    case "visited":
      return eventsUrl({ range, identity: "anonymous" })
    case "course_open":
    case "lesson_start":
    case "trial_claimed":
    case "pricing_view":
      return eventsUrl({ event: step.key, range })
    case "registered":
      // 同期群口径的第一步是"这段时间注册的人"，落点必须同样按注册时间筛
      return listUrl("/admin/users", [{ field: "range", value: range }])
    case "practiced":
      return listUrl("/admin/practice", [{ field: "range", value: range }])
    case "paid":
      return listUrl("/admin/payments", [
        { field: "range", value: range },
        { field: "status", value: "paid" },
      ])
    default:
      return null
  }
}

/**
 * 步骤来源标签。三种来源的失败模式完全不同，颜色必须能一眼区分：
 *   数据库（绿）—— 权威，不依赖客户端上报
 *   埋点（蓝）  —— 某个具体事件的次数/人数
 *   推导（青）  —— 由埋点算出来的量（目前只有访客数），不对应任何单个事件
 */
const SOURCE_TAG: Record<FunnelStep["source"], { color: string; label: string }> = {
  db: { color: "green", label: "数据库" },
  events: { color: "blue", label: "埋点" },
  traffic: { color: "cyan", label: "独立访客" },
}

const SOURCE_BAR: Record<FunnelStep["source"], string> = {
  db: "linear-gradient(90deg,#52c41a,#95de64)",
  events: "linear-gradient(90deg,#1677ff,#69b1ff)",
  traffic: "linear-gradient(90deg,#13c2c2,#87e8de)",
}

/**
 * 「看明细」的文案。
 *
 * 「访问站点」必须换一个说法：它的数字是**全部**独立访客（含后来注册的人），
 * 而落点只能给未登录的原始记录 —— 没有"按访客去重"的列表页，这是数据层的
 * 事实，不是实现偷懒。文案里写清是子集，比让人点进去发现数字对不上、
 * 然后怀疑埋点丢了要好得多。
 */
function stepLinkLabel(step: FunnelStep): string {
  return step.key === "visited" ? "看未登录访客 →" : "看明细 →"
}

/**
 * 首启漏斗报表。
 *
 * 口径是**混合**的，界面上用标签明确标出每一步的数从哪来（见 SOURCE_TAG）：
 *   数据库（绿）—— 注册 / 练完至少一句 / 付费。权威，不依赖客户端上报。
 *   埋点（蓝）  —— 打开课程 / 进入练习 / 领取体验 / 看过定价。
 *   独立访客（青）—— 第一步「访问站点」，按 visitor 去重，含未注册的人。
 * 标出来是为了让人不会拿「埋点少报」去误判成「用户没做」。
 *
 * 第一步与其余各步**分母不同**（全站流量 vs 同期群），所以 cohortNote 与
 * 页面文案都要写清楚，否则「访客 100 → 注册 3」会被当成可以跟
 * 「注册 3 → 付费 0」连起来读的一段。
 *
 * 这一页只回答「首启漏斗转化如何」。事件分布、趋势、页面排行、原始记录
 * 全部在【埋点分析】页 —— 同一份数据在两个页面各画一遍，迟早会改出不一致。
 */
export default function AnalyticsPage() {
  const [range, setRange] = useState<StatsRange>(DEFAULT_RANGE)
  const [rangeFrom, setRangeFrom] = useState<string | null>(null)
  const [rangeTo, setRangeTo] = useState<string | null>(null)

  const { data, loading, error } = useAdminFetch<FunnelData>(
    `/api/admin/analytics/funnel?${rangeQueryString({ range, from: rangeFrom, to: rangeTo })}`,
  )

  const rangeSegmented = (
    <AdminRangePicker
      value={{ range, from: rangeFrom, to: rangeTo }}
      onChange={(next) => {
        setRange(next.range)
        setRangeFrom(next.from)
        setRangeTo(next.to)
      }}
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
        首启漏斗 · 访问站点 → 注册 → 打开课程 → 进入练习 → 练完一句 → 领取体验 → 看定价 → 付费
      </Text>

      {/* 获客：流量 → 注册。
          这一段存在的唯一理由是回答「来了多少人、注册了多少」——
          同期群口径的第一行就是"注册"，天然答不了这个问题（没注册的人在
          cohort 之外），此前的后台因此完全没有获客顶端。 */}
      <Card title={`获客（流量 → 注册 · ${data.rangeLabel}）`} style={{ marginTop: 20 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8}>
            <MetricCard
              title="独立访客"
              value={data.acquisition.visitors}
              href={eventsUrl({ range, identity: "anonymous" })}
              drillHint="仅看未登录的原始记录"
            />
          </Col>
          <Col xs={12} md={8}>
            <MetricCard
              title="其中已归属账号"
              value={data.acquisition.converted}
            />
          </Col>
          <Col xs={12} md={8}>
            <MetricCard
              title="注册转化率"
              value={pct(data.acquisition.conversionRate)}
            />
          </Col>
        </Row>

        {data.acquisition.visitorShortfall ? (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message="访客数不完整，转化率暂不计算"
            description={data.acquisition.note}
          />
        ) : (
          <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
            「其中已归属账号」= 这批访客里后来注册/登录过的人；注册转化率 = 已归属账号 ÷ 独立访客。
            {" "}{data.acquisition.note}
          </Text>
        )}
      </Card>

      {/* 关键指标：全部走数据库权威口径，且每一项都能点进构成它的记录。
          这是「指标 → 埋点详情」闭环在漏斗页的一半 —— 另一半是下面每一步的「看明细」。 */}
      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        <Col xs={12} md={6}>
          <MetricCard
            title={`注册用户（${data.rangeLabel}）`}
            value={data.domain.registered}
            href={listUrl("/admin/users", [{ field: "range", value: range }])}
            drillHint="这段时间注册的用户"
          />
        </Col>
        <Col xs={12} md={6}>
          <MetricCard
            title="练过至少一句"
            value={data.domain.practicedUsers}
            href={listUrl("/admin/users", [
              { field: "range", value: range },
              { field: "active", value: 1 },
            ])}
            drillHint="这段时间练过的用户"
          />
        </Col>
        <Col xs={12} md={6}>
          <MetricCard
            title="付费用户"
            value={data.domain.paidUsers}
            href={listUrl("/admin/payments", [
              { field: "range", value: range },
              { field: "status", value: "paid" },
            ])}
            drillHint="已支付订单"
          />
        </Col>
        <Col xs={12} md={6}>
          <MetricCard
            title="累计收入"
            value={(data.domain.revenueFen / 100).toFixed(2)}
            prefix="¥"
            valueStyle={{ color: "#22C55E" }}
            href={listUrl("/admin/payments", [
              { field: "range", value: range },
              { field: "status", value: "paid" },
            ])}
            drillHint="已支付订单"
          />
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
            // 访客数被按注册数取下界时，条宽不能超过 100%，否则会撑破容器；
            // 数字本身仍然照实显示（差异要显式暴露，而不是靠裁掉来隐藏）
            const width = Math.min(100, Math.round((step.value / maxValue) * 100))
            const href = stepHref(step, range)
            return (
              <div key={step.key} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, minWidth: 110 }}>{step.label}</span>
                  <Tag color={SOURCE_TAG[step.source].color} style={{ marginRight: 0 }}>
                    {SOURCE_TAG[step.source].label}
                  </Tag>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{step.value.toLocaleString()}</span>
                  <span style={{ color: "#999", fontSize: 12 }}>
                    上一步转化 {pct(step.stepRate)} · 整体 {pct(step.overallRate)}
                  </span>
                  {href ? (
                    <Link href={href} style={{ fontSize: 12 }}>
                      {stepLinkLabel(step)}
                    </Link>
                  ) : null}
                </div>
                <div style={{ height: 10, background: "rgba(127,127,127,0.15)", borderRadius: 5 }}>
                  <div
                    style={{
                      width: `${width}%`,
                      height: "100%",
                      borderRadius: 5,
                      background: SOURCE_BAR[step.source],
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
          message="口径说明（两段分母不同）"
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
              或漏发，而不是用户没做。
              青色第一步按一年期 visitor cookie 去重（见 lib/visitor.ts），它含**未注册的人**，
              所以和后面各步不是同一个分母，不要跨段算比率。
              点每一步的「看明细」可以核对背后是哪些具体记录。
            </>
          }
        />
      </Card>

      {/* 按来源拆解 —— 推广期"哪条渠道值得继续投"的答案在这里。
          上面的漏斗只有一个总数，回答"整体转化如何"；这一段才回答"该投哪里"。 */}
      <Card title={`按来源拆解（${data.rangeLabel}）`} style={{ marginTop: 20 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          三个维度用的是同一个同期群（都是「{data.rangeLabel}注册的 {data.cohortSize} 人」），
          所以每一张表里的注册数之和都应当等于 {data.cohortSize}。
          「练过率」「付费率」的分母都是本行的注册数，可以横向比。
        </Text>

        {!data.breakdown.consistency.consistent ? (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message="分渠道注册数之和与同期群总数不一致，这一页的数字先不要用"
            description={
              `分渠道相加得到 ${data.breakdown.consistency.registeredSum} 人，` +
              `而同期群总数是 ${data.breakdown.consistency.cohortSize} 人。` +
              `这说明两处的时间范围过滤口径漂移了（见 funnel 路由的注释），` +
              `需要先修代码再看数。`
            }
          />
        ) : null}

        {/* 注册渠道 ≠ 用户从哪个平台看到你。
            前者是"从哪个入口建的号"（公众号扫码 / 手机号 / 开放平台），
            后者要看 UTM 来源。不写清楚一定会被误读成"微信带来的人"。 */}
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="「注册渠道」是建号入口，不是流量来源"
          description={
            <>
              注册渠道指的是用户**从哪个入口建的号**（公众号扫码 / 微信内授权 / 手机号…），
              它天然偏向微信。想知道「从哪个平台看到你的」，要看下面的 <b>UTM 来源</b> ——
              那才是小红书笔记、抖音视频带 utm_source 参数时的落点。
              「推荐关系」看的是推广体系到底有没有在起作用。
            </>
          }
        />

        <BreakdownTable title="按注册渠道" rows={data.breakdown.bySignupChannel} />
        <BreakdownTable title="按推荐关系（推广 vs 自然）" rows={data.breakdown.byReferral} />
        <BreakdownTable title="按 UTM 来源" rows={data.breakdown.byUtmSource} />

        <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
          「付费」与上方漏斗同口径：该渠道注册的人里，有多少人有过<b>已支付</b>订单。
          推广期的最低可用基线就是这里的数字 —— 拿它去告诉推广员「发一条大概能带来多少人」。
        </Text>
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

/**
 * 按来源拆解表。
 *
 * 存在的理由：上面那个漏斗只有一个总数，回答"整体转化如何"；
 * 而推广期要回答的是**"哪条渠道值得继续投"**。没有这个拆解，
 * "沉淀推广经验"就只是一句感觉，交不出数字。
 *
 * 分母统一是本行的注册数，所以「练过率」「付费率」两列可以直接横向比。
 * 不提供"占全部注册的比例"——那会诱导人把不同渠道的行当成互斥的一份总量，
 * 而它们本来就是互斥的（看 key 那一列）。
 */
function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const columns = [
    { title: "来源", dataIndex: "label", key: "label" },
    {
      title: "注册",
      dataIndex: "registered",
      key: "registered",
      align: "right" as const,
    },
    {
      title: "练过至少一句",
      dataIndex: "practiced",
      key: "practiced",
      align: "right" as const,
    },
    {
      title: "练过率",
      key: "practiceRate",
      align: "right" as const,
      render: (_: unknown, r: BreakdownRow) => pct(r.practiceRate),
    },
    {
      title: "付费",
      dataIndex: "paid",
      key: "paid",
      align: "right" as const,
    },
    {
      title: "付费率",
      key: "payRate",
      align: "right" as const,
      render: (_: unknown, r: BreakdownRow) => (
        <Text strong={r.paid > 0}>{pct(r.payRate)}</Text>
      ),
    },
  ]

  return (
    <div style={{ marginTop: 16 }}>
      <Text strong>{title}</Text>
      <Table<BreakdownRow>
        size="small"
        style={{ marginTop: 8 }}
        rowKey="key"
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: "该时间范围内没有数据" }}
      />
    </div>
  )
}
