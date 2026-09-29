"use client"

import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  Alert, Button, Card, Descriptions, Space, Spin, Table, Tag, Typography,
} from "antd"
import { ArrowLeftOutlined } from "@ant-design/icons"
import { EVENT_META, eventLabel } from "@/lib/analytics-events"
import { eventsUrl } from "@/lib/admin-links"
import { useAdminFetch } from "@/lib/admin-fetch"

const { Title, Text, Paragraph } = Typography

interface ContextRow {
  id: string
  eventType: string
  pageUrl: string | null
  properties: Record<string, unknown> | null
  createdAt: string
  userId: string | null
  isCurrent?: boolean
}

interface Detail {
  id: string
  eventType: string
  userId: string | null
  visitorId: string | null
  pageUrl: string | null
  sessionId: string | null
  properties: Record<string, unknown> | null
  createdAt: string
  context: ContextRow[]
  user: {
    id: string
    name: string | null
    phone: string | null
    isPro: number
    createdAt: string
    referredBy: string | null
    eventCount: number
  } | null
  contextScope: "user" | "visitor" | "session" | "none"
}

function fmtTime(v: string | null | undefined): string {
  if (!v) return "—"
  return String(v).replace("T", " ").slice(0, 19)
}

/**
 * 埋点详情。
 *
 * 单看一条 `click` 是没有信息量的 —— 排查「用户为什么没付费」时真正需要的是
 * 它前后发生了什么：先看了定价页、点了购买、然后什么都没有。所以这一页的
 * 主体不是那条记录本身，而是**围绕它的上下文时间线**（同一用户前后各 15 条，
 * 匿名时优先按 visitor 归并 —— 一年不变，能看到跨访问的完整轨迹；
 * 没有 visitor 才退化成同一 session，那条线在第二次访问处会断开）。
 *
 * 当前记录混在时间线里高亮，而不是单独摆在上面：只有放进序列里才能看出
 * 「这一步之前/之后」的关系。
 */
export default function EventDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()

  const { data, loading, error } = useAdminFetch<{ data: Detail }>(
    id ? `/api/admin/events/${id}` : null,
  )
  const detail = data?.data

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
        <Spin />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <Title level={3}>埋点详情</Title>
        <Alert type="error" showIcon message="加载失败" description={error ?? "记录不存在"} />
        <Link href="/admin/events" style={{ display: "inline-block", marginTop: 16 }}>
          <Button icon={<ArrowLeftOutlined />}>回到埋点分析</Button>
        </Link>
      </div>
    )
  }

  const meta = EVENT_META[detail.eventType as keyof typeof EVENT_META]

  // 时间线 = 上下文 + 当前记录，按 id 数值排序（bigint 转字符串后字典序是错的）
  const timeline: ContextRow[] = [
    ...detail.context,
    {
      id: detail.id,
      eventType: detail.eventType,
      pageUrl: detail.pageUrl,
      properties: detail.properties,
      createdAt: detail.createdAt,
      userId: detail.userId,
      isCurrent: true,
    },
  ].sort((a, b) => Number(a.id) - Number(b.id))

  const columns = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (v: string, row: ContextRow) =>
        row.isCurrent ? <Text strong>{fmtTime(v)}</Text> : <Link href={`/admin/events/${row.id}`}>{fmtTime(v)}</Link>,
    },
    {
      title: "事件",
      dataIndex: "eventType",
      width: 140,
      render: (v: string, row: ContextRow) => (
        <Tag color={row.isCurrent ? "gold" : v in EVENT_META ? "blue" : "default"}>
          {eventLabel(v)}
          {row.isCurrent ? " ← 当前" : ""}
        </Tag>
      ),
    },
    {
      title: "页面",
      dataIndex: "pageUrl",
      ellipsis: true,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: "属性",
      dataIndex: "properties",
      ellipsis: true,
      render: (v: Record<string, unknown> | null) =>
        v && Object.keys(v).length > 0 ? (
          <Text code style={{ fontSize: 12 }}>{JSON.stringify(v)}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Link href={eventsUrl({ userId: detail.userId ?? undefined, event: detail.eventType })}>
          <Button icon={<ArrowLeftOutlined />} size="small">回到埋点分析</Button>
        </Link>
      </Space>

      <Title level={3} style={{ marginTop: 0 }}>
        {eventLabel(detail.eventType)}{" "}
        <Text code style={{ fontSize: 14, fontWeight: 400 }}>{detail.eventType}</Text>
      </Title>

      <Card size="small">
        <Descriptions
          size="small"
          column={{ xs: 1, md: 2 }}
          items={[
            { key: "id", label: "记录 ID", children: <Text code>{detail.id}</Text> },
            { key: "time", label: "发生时间", children: fmtTime(detail.createdAt) },
            {
              key: "user",
              label: "用户",
              children: detail.user ? (
                <Space size={6}>
                  <Link href={`/admin/users/${detail.user.id}`}>{detail.user.name || "(未命名)"}</Link>
                  {detail.user.phone ? <Text type="secondary">{detail.user.phone}</Text> : null}
                  {detail.user.isPro ? <Tag color="gold">会员</Tag> : null}
                </Space>
              ) : (
                <Tag>匿名（未登录）</Tag>
              ),
            },
            {
              key: "page",
              label: "页面",
              children: detail.pageUrl ? (
                <a onClick={() => router.push(eventsUrl({ pageUrl: detail.pageUrl }))}>{detail.pageUrl}</a>
              ) : (
                "—"
              ),
            },
            {
              key: "visitor",
              label: "访客",
              children: detail.visitorId ? (
                // 一年期的匿名访客身份：跨标签页、跨访问都不变（见 lib/visitor.ts）。
                // 点它可以筛出这个访客的全部轨迹 —— 包括注册前那几条匿名记录
                <a onClick={() => router.push(eventsUrl({ q: detail.visitorId ?? undefined }))}>
                  <Text code style={{ fontSize: 12 }}>{detail.visitorId}</Text>
                </a>
              ) : (
                <Text type="secondary">未记录（2026-09-28 前的存量数据没有此字段）</Text>
              ),
            },
            {
              key: "session",
              label: "会话",
              children: detail.sessionId ? (
                <Text code style={{ fontSize: 12 }}>{detail.sessionId}</Text>
              ) : (
                "—"
              ),
            },
            {
              key: "userMeta",
              label: "该用户埋点总数",
              children: detail.user ? `${detail.user.eventCount} 条` : "—",
            },
          ]}
        />

        {meta ? (
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            <Text strong>{meta.label}</Text>：{meta.description}
          </Paragraph>
        ) : (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message="未登记的事件名"
            description={
              <>
                这个事件名不在白名单里（可能是早期版本上报的，或白名单后来删掉了）。
                白名单在 <Text code>src/lib/analytics-events.ts</Text>。
              </>
            }
          />
        )}
      </Card>

      <Card
        size="small"
        title="properties"
        style={{ marginTop: 16 }}
      >
        {detail.properties && Object.keys(detail.properties).length > 0 ? (
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "rgba(127,127,127,0.08)",
              borderRadius: 6,
              fontSize: 12,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(detail.properties, null, 2)}
          </pre>
        ) : (
          <Text type="secondary">这条记录没有属性</Text>
        )}
      </Card>

      <Card
        size="small"
        title={
          detail.contextScope === "user"
            ? "该用户的行为上下文（前后各 15 条）"
            : detail.contextScope === "visitor"
              ? "该访客的行为上下文（前后各 15 条，跨访问）"
              : "该会话的行为上下文（前后各 15 条）"
        }
        style={{ marginTop: 16 }}
        extra={
          detail.contextScope === "none" ? (
            <Text type="secondary" style={{ fontSize: 12 }}>无用户 / 访客 / 会话信息，无法回溯上下文</Text>
          ) : detail.contextScope === "session" ? (
            <Text type="secondary" style={{ fontSize: 12 }}>这条记录没有访客身份，只能按会话回溯（跨访问会断开）</Text>
          ) : null
        }
      >
        {detail.contextScope === "none" ? (
          <Text type="secondary">这条记录既没有 user_id 也没有 visitor_id / session_id，只能看它自身。</Text>
        ) : (
          <Table
            columns={columns}
            dataSource={timeline}
            rowKey="id"
            size="small"
            pagination={false}
            rowClassName={(row) => (row.isCurrent ? "ant-table-row-selected" : "")}
            scroll={{ x: "max-content" }}
          />
        )}
      </Card>
    </div>
  )
}
