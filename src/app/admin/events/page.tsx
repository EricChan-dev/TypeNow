"use client"

import { Suspense, useCallback, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  Alert, Card, Col, Descriptions, Drawer, Empty, Input, Row, Segmented,
  Select, Space, Spin, Statistic, Table, Tag, Tooltip, Typography,
} from "antd"
import { ReloadOutlined, BookOutlined } from "@ant-design/icons"
import EChart from "@/components/admin/EChart"
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  EVENT_META,
  FUNNEL_STEPS,
  ALLOWED_EVENTS,
  eventLabel,
  eventsByCategory,
} from "@/lib/analytics-events"
import { RANGE_OPTIONS, DEFAULT_RANGE, rangeLabel, type StatsRange } from "@/lib/admin-range"
import { eventDetailUrl } from "@/lib/admin-links"
import { useAdminFetch } from "@/lib/admin-fetch"
import {
  hourlyOption,
  eventRankOption,
  pageRankOption,
  trendOption,
  type TrendPoint,
} from "@/lib/admin-chart-options"

const { Title, Text, Paragraph } = Typography

interface StatsData {
  range: StatsRange
  rangeLabel: string
  granularity: "day" | "month"
  summary: {
    events: number
    users: number
    sessions: number
    anonymous: number
    anonymousRate: number | null
    firstAt: string | null
    lastAt: string | null
  }
  series: string[]
  trend: TrendPoint[]
  byEvent: Array<{ eventType: string; events: number; users: number; lastAt: string | null }>
  pages: Array<{ page: string; count: number; users: number }>
  hourly: Array<{ hour: number; count: number }>
}

interface EventRow {
  id: string
  eventType: string
  userId: string | null
  userName: string | null
  userPhone: string | null
  userIsPro: number | null
  pageUrl: string | null
  sessionId: string | null
  properties: Record<string, unknown> | null
  createdAt: string
}

function fmtTime(v: string | null | undefined): string {
  if (!v) return "—"
  // 后端返回的是 MySQL 的 "YYYY-MM-DD HH:MM:SS"（不带时区）；
  // 直接 new Date() 在 Safari 上会解析失败（不支持带空格的形式），
  // 所以原样展示，只截到秒
  return String(v).replace("T", " ").slice(0, 19)
}

/** 事件下拉选项：按分类分组，显示中文名 + 原始事件名。 */
const EVENT_SELECT_OPTIONS = eventsByCategory().map((group) => ({
  label: group.label,
  options: group.events.map((e) => ({
    label: `${EVENT_META[e].label}（${e}）`,
    value: e,
  })),
}))

export default function EventsPage() {
  // useSearchParams 需要 Suspense 边界（Next 16 静态渲染时会在构建期报错），
  // 所以用一层壳包住真正的内容组件
  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin /></div>}>
      <EventsExplorer />
    </Suspense>
  )
}

/**
 * 埋点分析。
 *
 * 设计取向：**URL 是筛选条件的唯一来源**。
 * 这样任何一组筛选都能直接分享/收藏，仪表盘和漏斗报表也能用链接把
 * 「这个数字是由哪些记录组成的」甩过来 —— 这是「可查指标背后的埋点详情」
 * 真正落地的地方。用 useState 存筛选条件的话，钻取链接点进来还要再手动设一遍。
 */
function EventsExplorer() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL → 筛选条件（派生，不额外存 state，避免两份状态不同步）
  const event = searchParams.get("event") ?? ""
  const category = searchParams.get("category") ?? ""
  const identity = searchParams.get("identity") ?? "all"
  const pageUrl = searchParams.get("pageUrl") ?? ""
  const q = searchParams.get("q") ?? ""
  const userId = searchParams.get("userId") ?? ""
  const rangeParam = searchParams.get("range")
  const range = (RANGE_OPTIONS.some((o) => o.value === rangeParam)
    ? (rangeParam as StatsRange)
    : DEFAULT_RANGE)
  const current = Number(searchParams.get("current") ?? "1") || 1
  const pageSize = Number(searchParams.get("pageSize") ?? "20") || 20

  const [dictionaryOpen, setDictionaryOpen] = useState(false)

  // 图表和表格共用同一串 query，保证「图上看到的」和「表里翻到的」是同一批数据
  const filterQuery = useMemo(() => {
    const p = new URLSearchParams()
    if (event) p.set("event", event)
    if (category) p.set("category", category)
    if (identity !== "all") p.set("identity", identity)
    if (pageUrl) p.set("pageUrl", pageUrl)
    if (q) p.set("q", q)
    if (userId) p.set("userId", userId)
    p.set("range", range)
    return p.toString()
  }, [event, category, identity, pageUrl, q, userId, range])

  const listQuery = useMemo(() => {
    const p = new URLSearchParams(filterQuery)
    p.set("current", String(current))
    p.set("pageSize", String(pageSize))
    return p.toString()
  }, [filterQuery, current, pageSize])

  const {
    data: stats,
    loading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useAdminFetch<StatsData>(`/api/admin/events/stats?${filterQuery}`)

  const {
    data: listData,
    loading: listLoading,
    error: listError,
    refetch: refetchList,
  } = useAdminFetch<{ data: EventRow[]; total: number }>(`/api/admin/events?${listQuery}`)

  const rows = listData?.data ?? []
  const total = listData?.total ?? 0
  const error = statsError ?? listError

  /** 改 URL 即改筛选。replace 而不是 push：筛选条件变化不该在历史里堆几十条记录。 */
  const setParam = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const p = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (!value) p.delete(key)
        else p.set(key, value)
      }
      // 任何筛选变化都要回到第一页：留在第 7 页而新筛选只有 2 页数据，
      // 界面会显示"暂无数据"，看起来像筛错了
      if (resetPage) p.delete("current")
      router.replace(`/admin/events?${p.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const summary = stats?.summary
  const hasData = (summary?.events ?? 0) > 0

  const columns = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 165,
      render: (v: string, row: EventRow) => (
        <Link href={eventDetailUrl(row.id)}>{fmtTime(v)}</Link>
      ),
    },
    {
      title: "事件",
      dataIndex: "eventType",
      width: 130,
      render: (v: string) => (
        <Tooltip title={`${v} — ${EVENT_META[v as keyof typeof EVENT_META]?.description ?? ""}`}>
          <Space size={4}>
            <Tag color={v in EVENT_META ? "blue" : "default"}>{eventLabel(v)}</Tag>
          </Space>
        </Tooltip>
      ),
    },
    {
      title: "用户",
      dataIndex: "userId",
      width: 160,
      render: (_: string | null, row: EventRow) => {
        if (!row.userId) return <Tag>匿名</Tag>
        return (
          <Space size={4}>
            <Link href={`/admin/users/${row.userId}`}>{row.userName || "(未命名)"}</Link>
            {row.userPhone ? <Text type="secondary" style={{ fontSize: 12 }}>{row.userPhone}</Text> : null}
          </Space>
        )
      },
    },
    {
      title: "页面",
      dataIndex: "pageUrl",
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          // 点页面路径 = 按这个页面筛，比手动复制粘贴快得多
          <a onClick={() => setParam({ pageUrl: v })}>{v}</a>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "属性",
      dataIndex: "properties",
      ellipsis: true,
      render: (v: Record<string, unknown> | null) => {
        if (!v || Object.keys(v).length === 0) return <Text type="secondary">—</Text>
        const text = JSON.stringify(v)
        return (
          <Tooltip title={<pre style={{ margin: 0, maxWidth: 420, whiteSpace: "pre-wrap" }}>{JSON.stringify(v, null, 2)}</pre>}>
            <Text code style={{ fontSize: 12 }}>{text}</Text>
          </Tooltip>
        )
      },
    },
    {
      title: "",
      key: "actions",
      width: 70,
      render: (_: unknown, row: EventRow) => <Link href={eventDetailUrl(row.id)}>详情</Link>,
    },
  ]

  // 有筛选时给一个"清空"的出口；没有出口的话用户只能手动删 URL
  const hasFilter = Boolean(event || category || pageUrl || q || userId || identity !== "all")

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>埋点分析</Title>
          <Text type="secondary">每一条上报的原始记录，以及它聚合出来的趋势</Text>
        </div>
        <Space>
          <Segmented
            value={range}
            onChange={(v) => setParam({ range: String(v) })}
            options={RANGE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          />
          <Tooltip title="把当前筛选重新拉一遍">
            <a
              onClick={() => {
                refetchStats()
                refetchList()
              }}
            >
              <ReloadOutlined /> 刷新
            </a>
          </Tooltip>
          <a onClick={() => setDictionaryOpen(true)}>
            <BookOutlined /> 事件字典
          </a>
        </Space>
      </div>

      {error ? (
        <Alert style={{ marginTop: 16 }} type="error" showIcon message="加载失败" description={error} />
      ) : null}

      {/* ── 筛选条 ── */}
      <Card size="small" style={{ marginTop: 16 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8} lg={6}>
            <Select
              allowClear
              showSearch
              style={{ width: "100%" }}
              placeholder="按事件筛"
              value={event || undefined}
              onChange={(v) => setParam({ event: v ?? null })}
              options={EVENT_SELECT_OPTIONS}
              optionFilterProp="label"
            />
          </Col>
          <Col xs={12} md={4} lg={3}>
            <Select
              allowClear
              style={{ width: "100%" }}
              placeholder="分类"
              value={category || undefined}
              onChange={(v) => setParam({ category: v ?? null })}
              options={EVENT_CATEGORIES.map((c) => ({ label: EVENT_CATEGORY_LABELS[c], value: c }))}
            />
          </Col>
          <Col xs={12} md={4} lg={3}>
            <Select
              style={{ width: "100%" }}
              value={identity}
              onChange={(v) => setParam({ identity: v === "all" ? null : v })}
              options={[
                { label: "全部身份", value: "all" },
                { label: "仅匿名", value: "anonymous" },
                { label: "仅登录", value: "registered" },
              ]}
            />
          </Col>
          <Col xs={24} md={8} lg={5}>
            <Input
              allowClear
              placeholder="页面路径包含…"
              defaultValue={pageUrl}
              // 受控 + onChange 会让每敲一个字就发一次请求，所以用失焦/回车提交
              onBlur={(e) => setParam({ pageUrl: e.target.value.trim() || null })}
              onPressEnter={(e) => setParam({ pageUrl: (e.target as HTMLInputElement).value.trim() || null })}
            />
          </Col>
          <Col xs={24} md={8} lg={5}>
            <Input.Search
              allowClear
              placeholder="关键词：页面 / 属性内容"
              defaultValue={q}
              onSearch={(v) => setParam({ q: v.trim() || null })}
            />
          </Col>
          <Col xs={24} lg={2}>
            {hasFilter ? <a onClick={() => router.replace("/admin/events", { scroll: false })}>清空筛选</a> : null}
          </Col>
        </Row>

        {/* 被钻取链接带进来的用户筛选，单独显示成一条可撤销的标签 */}
        {userId ? (
          <div style={{ marginTop: 12 }}>
            <Space>
              <Text type="secondary">已限定用户：</Text>
              <Tag closable onClose={() => setParam({ userId: null })}>
                <Link href={`/admin/users/${userId}`}>{userId}</Link>
              </Tag>
            </Space>
          </div>
        ) : null}

        {/* 从漏斗某一步跳进来时，把这一步的口径讲清楚，避免误读数字 */}
        {event && EVENT_META[event as keyof typeof EVENT_META] ? (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message={`${EVENT_META[event as keyof typeof EVENT_META].label}（${event}）`}
            description={EVENT_META[event as keyof typeof EVENT_META].description}
          />
        ) : null}
      </Card>

      {/* ── 汇总 ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={`事件总数（${rangeLabel(range)}）`}
              value={summary?.events ?? 0}
              loading={statsLoading}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="独立用户" value={summary?.users ?? 0} loading={statsLoading} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="会话数" value={summary?.sessions ?? 0} loading={statsLoading} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="匿名占比"
              value={summary?.anonymousRate === null || summary?.anonymousRate === undefined
                ? "—"
                : (summary.anonymousRate * 100).toFixed(1)}
              suffix={summary?.anonymousRate === null || summary?.anonymousRate === undefined ? "" : "%"}
              loading={statsLoading}
            />
          </Card>
        </Col>
      </Row>

      {summary?.firstAt ? (
        <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          最早一条：{fmtTime(summary.firstAt)} · 最新一条：{fmtTime(summary.lastAt)}
        </Text>
      ) : null}

      {/* ── 图表 ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card
            size="small"
            title={`事件趋势（按${stats?.granularity === "month" ? "月" : "天"}，堆叠）`}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>只画次数最多的 {stats?.series.length ?? 0} 个事件</Text>}
          >
            <EChart
              option={trendOption(stats?.trend ?? [], stats?.series ?? [], stats?.granularity ?? "day")}
              height={300}
              loading={statsLoading}
              empty={!statsLoading && !hasData}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="24 小时分布">
            <EChart
              option={hourlyOption(stats?.hourly ?? [])}
              height={300}
              loading={statsLoading}
              empty={!statsLoading && !hasData}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="事件排行（次数 vs 独立用户）">
            <EChart
              option={eventRankOption(stats?.byEvent ?? [])}
              height={Math.max(240, (stats?.byEvent.length ?? 0) * 34)}
              loading={statsLoading}
              empty={!statsLoading && (stats?.byEvent.length ?? 0) === 0}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="页面排行">
            <EChart
              option={pageRankOption(stats?.pages ?? [])}
              height={Math.max(240, (stats?.pages.length ?? 0) * 34)}
              loading={statsLoading}
              empty={!statsLoading && (stats?.pages.length ?? 0) === 0}
            />
          </Card>
        </Col>
      </Row>

      {/* ── 明细 ── */}
      <Card
        size="small"
        title="明细记录"
        style={{ marginTop: 16 }}
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            点任意一行看上下文（同一用户前后各 15 条）
          </Text>
        }
      >
        <Table
          columns={columns}
          dataSource={rows}
          rowKey="id"
          size="small"
          loading={listLoading}
          locale={{ emptyText: <Empty description={hasFilter ? "当前筛选下没有记录" : "还没有任何埋点上报"} /> }}
          pagination={{
            current,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ["20", "50", "100"],
            showTotal: (t, r) => `第 ${r[0]}-${r[1]} 条 / 共 ${t} 条`,
            onChange: (page, size) => setParam({ current: String(page), pageSize: String(size) }, false),
          }}
          onRow={(row) => ({
            onClick: () => router.push(eventDetailUrl(row.id)),
            style: { cursor: "pointer" },
          })}
        />
      </Card>

      {/* ── 事件字典抽屉 ── */}
      <Drawer
        title="事件字典"
        width={560}
        open={dictionaryOpen}
        onClose={() => setDictionaryOpen(false)}
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          共 {ALLOWED_EVENTS.length} 个事件。这里是与后端白名单（
          <Text code>src/lib/analytics-events.ts</Text>）同源的清单 ——
          往白名单加事件却忘了写说明，TypeScript 会直接报错。
        </Paragraph>

        {eventsByCategory().map((group) => (
          <Card
            key={group.category}
            size="small"
            title={group.label}
            style={{ marginBottom: 12 }}
            styles={{ body: { padding: 12 } }}
          >
            {group.events.map((e) => (
              <div key={e} style={{ marginBottom: 12 }}>
                <Space size={6} wrap>
                  <Text strong>{EVENT_META[e].label}</Text>
                  <Text code style={{ fontSize: 12 }}>{e}</Text>
                  {FUNNEL_STEPS.some((s) => s.key === e) ? <Tag color="blue">漏斗步骤</Tag> : null}
                  <a style={{ fontSize: 12 }} onClick={() => { setParam({ event: e, category: null }); setDictionaryOpen(false) }}>
                    看记录
                  </a>
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{EVENT_META[e].description}</Text>
                </div>
                {EVENT_META[e].props.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      properties：{EVENT_META[e].props.map((p) => <Text key={p} code style={{ fontSize: 11 }}>{p}</Text>)}
                    </Text>
                  </div>
                ) : null}
              </div>
            ))}
          </Card>
        ))}

        <Descriptions
          size="small"
          column={1}
          title="漏斗步骤取数口径"
          items={FUNNEL_STEPS.map((s) => ({
            key: s.key,
            label: s.label,
            children: s.source === "db"
              ? <Tag color="green">数据库（权威）</Tag>
              : <Tag color="blue">埋点（可能被拦截器挡掉）</Tag>,
          }))}
        />
      </Drawer>
    </div>
  )
}
