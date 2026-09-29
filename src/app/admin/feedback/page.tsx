"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Alert, App, Badge, Button, Card, Col, Empty, Input, Modal, Row,
  Segmented, Select, Space, Statistic, Table, Tag, Tooltip, Typography,
} from "antd"
import { useAdminFetch } from "@/lib/admin-fetch"
import { RANGE_OPTIONS, type StatsRange } from "@/lib/admin-range"
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_COLORS,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_SOURCE_LABELS,
  FEEDBACK_STATUS_COLORS,
  FEEDBACK_STATUS_LABELS,
  isFeedbackSource,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/lib/feedback"

const { Title, Text, Paragraph } = Typography

interface Row {
  id: string
  userId: string
  category: FeedbackCategory
  source: string
  status: FeedbackStatus
  content: string
  adminNote: string | null
  handledBy: string | null
  handledAt: string | null
  createdAt: string
  userName: string | null
  userPhone: string | null
  userIsPro: number | null
}

interface ListBody {
  data: Row[]
  total: number
  summary: { byStatus: Record<string, number>; unfinished: number }
}

function fmtTime(v: string | null): string {
  return v ? String(v).replace("T", " ").slice(0, 19) : "—"
}

/**
 * 反馈管理。
 *
 * 这个页面补的是**从上线起就缺的一环**：反馈一直只以一条微信客服消息的形式
 * 推给管理员，消息滚过去就找不回来了 —— 线上实测已经积了 8 条没人看过。
 *
 * 三个刻意的设计：
 *   1. **按状态分档**（待处理/处理中/已解决/已忽略/全部），默认落在"待处理"。
 *      没有状态分档的话，列表就只是一堆按时间排的文本，用不了几天又没人看了。
 *   2. 各档的**条数常显**（不随当前筛选变化），这样"还剩多少没处理"始终看得见。
 *   3. 处理动作直接做在行上（接手/解决/忽略），只有写备注才开弹窗 ——
 *      多一次弹窗就多一次放弃处理的理由。
 *
 * 筛选条件走 refine 的 filters 机制之外的一条轻量路径：这一页不是 refine 的
 * useTable（它是自建的图表/统计页风格），所以直接用 URL 无关的本地 state，
 * 由 useAdminFetch 按 key 派生 loading。
 */
export default function FeedbackPage() {
  const { message, modal } = App.useApp()

  const [status, setStatus] = useState<FeedbackStatus | "unfinished" | "all">("unfinished")
  const [category, setCategory] = useState<FeedbackCategory | "">("")
  const [range, setRange] = useState<StatsRange>("all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [detail, setDetail] = useState<Row | null>(null)
  const [noteDraft, setNoteDraft] = useState("")
  const [saving, setSaving] = useState(false)

  /**
   * 默认落在"未结束"（待处理 + 处理中）而不是"待处理"：
   * 「处理中」也是没做完的事，只显示 open 会让接手过的反馈从视野里消失。
   */
  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (status !== "all") p.set("status", status)
    if (category) p.set("category", category)
    if (range !== "all") p.set("range", range)
    if (q.trim()) p.set("q", q.trim())
    p.set("current", String(page))
    p.set("pageSize", String(pageSize))
    return p.toString()
  }, [status, category, range, q, page, pageSize])

  const { data, loading, error, refetch } = useAdminFetch<ListBody>(`/api/admin/feedback?${query}`)

  const rows = data?.data ?? []
  const summary = data?.summary

  async function patch(id: string, body: { status?: FeedbackStatus; adminNote?: string }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        message.error(json?.error ?? "更新失败")
        return false
      }
      message.success(json?.unchanged ? "没有需要更新的内容" : "已更新")
      refetch()
      return true
    } catch {
      message.error("更新失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  function openDetail(row: Row) {
    setDetail(row)
    setNoteDraft(row.adminNote ?? "")
  }

  async function saveDetail(nextStatus?: FeedbackStatus) {
    if (!detail) return
    const body: { status?: FeedbackStatus; adminNote?: string } = { adminNote: noteDraft }
    if (nextStatus) body.status = nextStatus
    const ok = await patch(detail.id, body)
    if (ok) setDetail(null)
  }

  const columns = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 165,
      render: (v: string) => fmtTime(v),
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 110,
      render: (v: FeedbackCategory) => (
        <Tag color={FEEDBACK_CATEGORY_COLORS[v]}>{FEEDBACK_CATEGORY_LABELS[v]}</Tag>
      ),
    },
    {
      title: "来源",
      dataIndex: "source",
      width: 110,
      render: (v: string) =>
        isFeedbackSource(v) ? (
          <Text type="secondary">{FEEDBACK_SOURCE_LABELS[v]}</Text>
        ) : (
          <Text type="secondary">{v}</Text>
        ),
    },
    {
      title: "用户",
      dataIndex: "userId",
      width: 160,
      render: (_: string, r: Row) => (
        <Space size={4}>
          <Link href={`/admin/users/${r.userId}`}>{r.userName || "(未命名)"}</Link>
          {r.userPhone ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.userPhone}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "反馈内容",
      dataIndex: "content",
      render: (v: string, r: Row) => (
        <div>
          {/* 内容可能很长，列表里截断，点开看全文 */}
          <Paragraph
            style={{ marginBottom: 0, whiteSpace: "pre-wrap", cursor: "pointer" }}
            ellipsis={{ rows: 2, expandable: false }}
            onClick={() => openDetail(r)}
          >
            {v}
          </Paragraph>
          {r.adminNote ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              备注：{r.adminNote}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: FeedbackStatus, r: Row) => (
        <Tooltip title={r.handledAt ? `处理于 ${fmtTime(r.handledAt)}` : undefined}>
          <Tag color={FEEDBACK_STATUS_COLORS[v]}>{FEEDBACK_STATUS_LABELS[v]}</Tag>
        </Tooltip>
      ),
    },
    {
      title: "操作",
      fixed: "right" as const,
      key: "actions",
      width: 210,
      render: (_: unknown, r: Row) => (
        <Space size={4}>
          {r.status === "open" ? (
            <Button size="small" loading={saving} onClick={() => patch(r.id, { status: "in_progress" })}>
              接手
            </Button>
          ) : null}
          {r.status !== "resolved" ? (
            <Button
              size="small"
              type="primary"
              loading={saving}
              onClick={() => patch(r.id, { status: "resolved" })}
            >
              解决
            </Button>
          ) : null}
          <Button size="small" onClick={() => openDetail(r)}>
            处理…
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            反馈管理
            {summary?.unfinished ? (
              <Badge
                count={summary.unfinished}
                style={{ marginLeft: 10, backgroundColor: "#fa8c16" }}
              />
            ) : null}
          </Title>
          <Text type="secondary">门户端与学习中心提交的用户反馈，按状态流转处理</Text>
        </div>
        <Space>
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder="按分类"
            value={category || undefined}
            onChange={(v) => {
              setCategory((v as FeedbackCategory) ?? "")
              setPage(1)
            }}
            options={FEEDBACK_CATEGORIES.map((c) => ({
              label: FEEDBACK_CATEGORY_LABELS[c],
              value: c,
            }))}
          />
          <Select
            style={{ width: 130 }}
            value={range}
            onChange={(v) => {
              setRange(v as StatsRange)
              setPage(1)
            }}
            options={[
              { label: "不限时间", value: "all" },
              ...RANGE_OPTIONS.filter((o) => o.value !== "all").map((o) => ({
                label: o.label,
                value: o.value,
              })),
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜内容 / 昵称 / 手机号"
            style={{ width: 240 }}
            onSearch={(v) => {
              setQ(v)
              setPage(1)
            }}
          />
        </Space>
      </div>

      {/* 各状态条数常显，且**不随当前筛选变化** —— 要能随时回答"还剩多少没处理" */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {(["open", "in_progress", "resolved", "ignored"] as FeedbackStatus[]).map((s) => (
          <Col xs={12} md={6} key={s}>
            <Card
              size="small"
              hoverable
              onClick={() => {
                setStatus(s)
                setPage(1)
              }}
              style={status === s ? { borderColor: "#6366F1" } : undefined}
            >
              <Statistic
                title={FEEDBACK_STATUS_LABELS[s]}
                value={summary?.byStatus?.[s] ?? 0}
                valueStyle={s === "open" && (summary?.byStatus?.open ?? 0) > 0 ? { color: "#fa8c16" } : undefined}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ marginTop: 16 }}>
        <Segmented
          value={status === "all" ? "all" : status === "unfinished" ? "unfinished" : status}
          onChange={(v) => {
            setStatus(v as FeedbackStatus | "unfinished" | "all")
            setPage(1)
          }}
          options={[
            { label: `未结束（${summary?.unfinished ?? 0}）`, value: "unfinished" },
            { label: "待处理", value: "open" },
            { label: "处理中", value: "in_progress" },
            { label: "已解决", value: "resolved" },
            { label: "已忽略", value: "ignored" },
            { label: "全部", value: "all" },
          ]}
        />
      </div>

      {error ? (
        <Alert style={{ marginTop: 16 }} type="error" showIcon message="加载失败" description={error} />
      ) : null}

      <Table
        style={{ marginTop: 16 }}
        columns={columns}
        dataSource={rows}
        rowKey="id"
        size="small"
        loading={loading}
        locale={{
          emptyText: (
            <Empty
              description={
                status === "unfinished" ? "没有待处理的反馈 🎉" : "当前筛选下没有反馈"
              }
            />
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: ["20", "50", "100"],
          showTotal: (t, r) => `第 ${r[0]}-${r[1]} 条 / 共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          },
        }}
        scroll={{ x: "max-content" }}
      />

      <Modal
        open={Boolean(detail)}
        title="处理反馈"
        onCancel={() => setDetail(null)}
        width={640}
        footer={null}
        destroyOnHidden
      >
        {detail ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space wrap size={6}>
              <Tag color={FEEDBACK_CATEGORY_COLORS[detail.category]}>
                {FEEDBACK_CATEGORY_LABELS[detail.category]}
              </Tag>
              {isFeedbackSource(detail.source) ? (
                <Tag>{FEEDBACK_SOURCE_LABELS[detail.source]}</Tag>
              ) : null}
              <Tag color={FEEDBACK_STATUS_COLORS[detail.status]}>
                {FEEDBACK_STATUS_LABELS[detail.status]}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {fmtTime(detail.createdAt)}
              </Text>
            </Space>

            <Card size="small" styles={{ body: { padding: 12 } }}>
              <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                {detail.content}
              </Paragraph>
            </Card>

            <Space size={6}>
              <Text type="secondary">提交人：</Text>
              <Link href={`/admin/users/${detail.userId}`}>
                {detail.userName || "(未命名)"}
              </Link>
              {detail.userPhone ? <Text type="secondary">{detail.userPhone}</Text> : null}
              {detail.userIsPro ? <Tag color="gold">会员</Tag> : null}
            </Space>

            {detail.handledAt ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                上次处理：{fmtTime(detail.handledAt)}
              </Text>
            ) : null}

            <div>
              <Text>处理备注（用户看不到，仅内部记录）</Text>
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="例如：已定位，下个版本修复"
                style={{ marginTop: 6 }}
              />
            </div>

            <Space wrap>
              <Button onClick={() => saveDetail()} loading={saving}>
                仅保存备注
              </Button>
              <Button
                onClick={() => {
                  modal.confirm({
                    title: "标记为处理中？",
                    content: "表示已接手但尚未完成；它仍会算在「未结束」里。",
                    onOk: () => saveDetail("in_progress"),
                  })
                  return undefined
                }}
                loading={saving}
              >
                处理中
              </Button>
              <Button type="primary" onClick={() => saveDetail("resolved")} loading={saving}>
                标记已解决
              </Button>
              <Button
                danger
                onClick={() => {
                  modal.confirm({
                    title: "忽略这条反馈？",
                    content: "用于明确表示不打算处理；它会从「未结束」里移出，但记录仍然保留。",
                    okText: "忽略",
                    okButtonProps: { danger: true },
                    onOk: () => saveDetail("ignored"),
                  })
                  return undefined
                }}
                loading={saving}
              >
                忽略
              </Button>
              {detail.status !== "open" ? (
                <Button onClick={() => saveDetail("open")} loading={saving}>
                  退回待处理
                </Button>
              ) : null}
            </Space>

            <Text type="secondary" style={{ fontSize: 12 }}>
              快捷筛选：
              {FEEDBACK_CATEGORIES.map((c) => (
                <a
                  key={c}
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    setCategory(c)
                    setDetail(null)
                    setPage(1)
                  }}
                >
                  {FEEDBACK_CATEGORY_LABELS[c]}
                </a>
              ))}
            </Text>
          </Space>
        ) : null}
      </Modal>
    </div>
  )
}
