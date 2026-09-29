"use client"

import { useState } from "react"
import { Card, Descriptions, Space, Spin, Table, Tag, Typography } from "antd"
import { useParams } from "next/navigation"
import Link from "next/link"
import { eventLabel } from "@/lib/analytics-events"
import { describeSignupSource } from "@/lib/signup-source"
import { useAdminFetch } from "@/lib/admin-fetch"
import { formatAdminTime } from "@/lib/admin-time"

const { Title, Text } = Typography

interface UserStats {
  practiceCount: number
  eventCount: number
  paidOrderCount: number
  revenueFen: number
  activeSubscriptions: number
  firstEventAt: string | null
  lastEventAt: string | null
}

interface EventRow {
  id: number
  eventType: string
  pageUrl: string | null
  sessionId: string | null
  properties: Record<string, unknown> | null
  createdAt: string
}

/** 事件名的中文说明。埋点是自由字符串，不翻译的话运营看不懂。 */
/**
 * 事件名的中文说明与配色。
 *
 * 中文名一律取自 src/lib/analytics-events 的 EVENT_META（单一来源）——
 * 这里以前自己维护了一份 map，结果新增 pricing_view 时漏了，页面上就直接
 * 显示原始事件名。配色只有后台用得上，留在本地。
 */
const EVENT_COLORS: Record<string, string> = {
  login_success: "green",
  course_open: "blue",
  lesson_start: "blue",
  practice_complete: "purple",
  trial_claimed: "gold",
  paywall_shown: "orange",
  click_subscribe: "orange",
  subscribe_pay_success: "green",
}

/**
 * 用户详情。
 *
 * 除了基础资料，重点是「这个人到底干了什么」：
 *   - 关键指标（练习句数 / 埋点数 / 已付订单 / 收入 / 首次与最后一次埋点时间）
 *   - 埋点时间线（倒序，可按事件类型过滤）
 *
 * firstEventAt / lastEventAt 是判断"注册完就没来过"最快的两个数：
 * 两者都为空 = 注册后一次都没上报过。
 */
export default function UserShow() {
  const params = useParams()
  const id = params?.id as string
  const [eventFilter, setEventFilter] = useState<string>("")

  // 两个接口各自取数（原本是 effect 里手动 fetch + 同步 setLoading，
  // 那会多一轮渲染，也被 lint 的 set-state-in-effect 规则拦住）
  const { data: userData, loading } = useAdminFetch<{ data: Record<string, unknown> | null }>(
    id ? `/api/admin/users/${id}` : null,
  )
  const { data: eventData } = useAdminFetch<{ data: EventRow[] }>(
    id
      ? `/api/admin/users/${id}/events?pageSize=30${eventFilter ? `&event=${encodeURIComponent(eventFilter)}` : ""}`
      : null,
  )

  const record = userData?.data ?? null
  const stats = (record?.stats ?? null) as UserStats | null
  const events = eventData?.data ?? []

  if (loading) return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />
  if (!record) return <Title level={4}>用户不存在</Title>

  const eventColumns = [
    {
      title: "事件",
      dataIndex: "eventType",
      key: "eventType",
      width: 130,
      render: (t: string) => (
        <Tag color={EVENT_COLORS[t] ?? "default"}>{eventLabel(t)}</Tag>
      ),
    },
    {
      title: "页面",
      dataIndex: "pageUrl",
      key: "pageUrl",
      width: 200,
      ellipsis: true,
      render: (u: string | null) => u || "—",
    },
    {
      title: "属性",
      dataIndex: "properties",
      key: "properties",
      ellipsis: true,
      render: (p: Record<string, unknown> | null) => {
        if (!p || Object.keys(p).length === 0) return <Text type="secondary">—</Text>
        const s = JSON.stringify(p)
        return <Text code style={{ fontSize: 12 }}>{s.length > 90 ? s.slice(0, 90) + "…" : s}</Text>
      },
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (d: string) => (d ? formatAdminTime(d) : "—"),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>用户详情</Title>

      {/* 关键指标 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Text type="secondary">行为概览</Text>
        <Descriptions column={4} size="small" style={{ marginTop: 8 }}>
          <Descriptions.Item label="练习句数">{stats?.practiceCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="埋点记录">{stats?.eventCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="已付订单">{stats?.paidOrderCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="累计支付">
            ¥{((stats?.revenueFen ?? 0) / 100).toFixed(2)}
          </Descriptions.Item>
          <Descriptions.Item label="有效订阅">{stats?.activeSubscriptions ?? 0}</Descriptions.Item>
          <Descriptions.Item label="首次埋点">
            {stats?.firstEventAt ? formatAdminTime(stats.firstEventAt) : "从未上报"}
          </Descriptions.Item>
          <Descriptions.Item label="最后埋点">
            {stats?.lastEventAt ? formatAdminTime(stats.lastEventAt) : "从未上报"}
          </Descriptions.Item>
          <Descriptions.Item label="订单">
            <Link href={`/admin/payments?q=${encodeURIComponent(String(record.name ?? ""))}`}>
              按姓名查订单
            </Link>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 基础资料 */}
      <Card style={{ marginBottom: 16 }}>
        <Descriptions bordered column={2}>
          <Descriptions.Item label="昵称">{(record.name as string) || "-"}</Descriptions.Item>
          <Descriptions.Item label="手机">
            {(record.phoneMasked as string) || "（未绑定）"}
          </Descriptions.Item>
          <Descriptions.Item label="等级">{(record.level as number) || 1}</Descriptions.Item>
          <Descriptions.Item label="总分">{(record.totalScore as number) || 0}</Descriptions.Item>
          <Descriptions.Item label="钻石">{(record.diamonds as number) || 0}</Descriptions.Item>
          <Descriptions.Item label="金币">{(record.coins as number) || 0}</Descriptions.Item>
          <Descriptions.Item label="邀请码">{(record.inviteCode as string) || "-"}</Descriptions.Item>
          <Descriptions.Item label="会员状态">
            {record.isPro ? (
              <Tag color="blue">PRO</Tag>
            ) : record.isProFlagged ? (
              <Tag color="default">已过期（标记未回收）</Tag>
            ) : (
              <Tag>免费用户</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="会员到期">
            {record.proExpires ? formatAdminTime(record.proExpires) : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="体验会员领取">
            {record.trialClaimedAt
              ? formatAdminTime(record.trialClaimedAt)
              : "未领取"}
          </Descriptions.Item>
          <Descriptions.Item label="微信绑定">
            {record.wechatOpenid ? <Tag color="green">已绑定</Tag> : <Tag>未绑定</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="角色">
            {record.role === "admin" ? <Tag color="purple">管理员</Tag> : <Tag>用户</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="注册时间">
            {record.createdAt ? formatAdminTime(record.createdAt) : "-"}
          </Descriptions.Item>
          {/* 注册来源：摘要是接口算好的（describeSignupSource），
              这里只把原始 JSON 折叠在下面，排查时用得上 */}
          <Descriptions.Item label="注册来源" span={2}>
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              <span>{describeSignupSource(record.signupChannel as string, record.signupSource)}</span>
              {record.signupSource ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {JSON.stringify(record.signupSource)}
                </Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  该用户注册于来源归因上线之前（迁移 00023），没有记录
                </Text>
              )}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 埋点时间线 */}
      <Card
        title={`埋点记录${eventFilter ? ` · 仅「${eventLabel(eventFilter)}」` : ""}`}
        extra={
          eventFilter ? (
            <a onClick={() => setEventFilter("")}>清除筛选</a>
          ) : null
        }
      >
        <Table
          columns={eventColumns}
          dataSource={events}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 30 }}
          locale={{ emptyText: "该用户还没有埋点记录" }}
          onRow={(r) => ({
            onClick: () => setEventFilter(r.eventType),
            style: { cursor: "pointer" },
          })}
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  )
}
