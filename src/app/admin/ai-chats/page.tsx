"use client"

/**
 * 后台「AI 对话日志」页面。
 *
 * 这个页面回答的是 AI 私教上线以来一直答不了的问题：**用户问了什么、AI 答了什么、
 * 失败多不多、谁在刷免费额度**。此前对话完全不落库，只有 diamond_logs 记了
 * "扣了多少钻石"，所以用户投诉时无从查起。
 *
 * 几个刻意的设计：
 *
 * 1. **只读，没有清理入口**。与操作审计同一个理由：能在界面上删掉的审计日志
 *    不算审计，归档应当由 DBA 在库上做。
 *
 * 2. **默认落在「近一周」**。这张表只增不减（每次提问一行），默认"不限"会让
 *    第一次打开的人面对一张很长的表。
 *
 * 3. **问答全文放在展开行**里：列表里只摊问题前 60 字，一屏能扫完；
 *    要看清 AI 到底答得对不对，展开那一行即可，不跳页、不弹窗。
 *
 * 4. **汇总卡片跟着筛选走**：回答"这段时间失败率多少、平均多慢、花了多少钻石"。
 *    只看一张流水表很难看出异常，带上分母才看得出。
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd"
import { useAdminFetch } from "@/lib/admin-fetch"
import { AdminRangePicker } from "@/components/admin/AdminRangePicker"
import { formatAdminTime } from "@/lib/admin-time"
import { DEFAULT_RANGE, type StatsRange } from "@/lib/admin-range"

const { Text, Paragraph } = Typography

interface Row {
  id: string
  createdAt: string
  userId: string
  userName: string | null
  userPhone: string | null
  question: string
  answer: string | null
  model: string | null
  historyCount: number
  diamondsCost: number
  usedFreeQuota: number
  status: "ok" | "error"
  errorMessage: string | null
  latencyMs: number | null
}

interface Summary {
  total: number
  errors: number
  freeQuota: number
  diamonds: number
  avgLatency: number | null
}

interface Resp {
  data: Row[]
  total: number
  summary: Summary
  applied: { q: string; status: string | null; range: string | null; rangeLabel: string | null }
}

/** 列表里问题只显示这么多字，全文在展开行里 */
const QUESTION_PREVIEW = 60

export default function AiChatLogsPage() {
  const [status, setStatus] = useState<"" | "ok" | "error">("")
  const [range, setRange] = useState<StatsRange>(DEFAULT_RANGE)
  // 自定义区间两端（只有 range=custom 时有值）
  const [rangeFrom, setRangeFrom] = useState<string | null>(null)
  const [rangeTo, setRangeTo] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (status) p.set("status", status)
    if (range !== "all") p.set("range", range)
    if (range === "custom") {
      if (rangeFrom) p.set("from", rangeFrom)
      if (rangeTo) p.set("to", rangeTo)
    }
    if (q.trim()) p.set("q", q.trim())
    p.set("current", String(page))
    p.set("pageSize", String(pageSize))
    return p.toString()
  }, [status, range, rangeFrom, rangeTo, q, page, pageSize])

  const { data, loading } = useAdminFetch<Resp>(`/api/admin/ai-chats?${query}`)
  const summary = data?.summary

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>AI 对话日志</Typography.Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        每次进入 AI 私教的提问都会记一行（失败也记）。问答全文在展开行里；
        本页只读，不做清理。
      </Paragraph>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic title={`问答数（${data?.applied.rangeLabel ?? "—"}）`} value={summary?.total ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic
              title="失败数"
              value={summary?.errors ?? 0}
              valueStyle={(summary?.errors ?? 0) > 0 ? { color: "#cf1322" } : undefined}
            />
          </Card>
        </Col>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic title="走免费额度" value={summary?.freeQuota ?? 0} suffix="次" />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="消耗钻石" value={summary?.diamonds ?? 0} suffix="颗" />
          </Card>
        </Col>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic
              title="平均耗时"
              value={summary?.avgLatency ?? 0}
              suffix="ms"
            />
          </Card>
        </Col>
      </Row>

      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            style={{ width: 120 }}
            placeholder="状态"
            value={status || undefined}
            onChange={(v) => {
              setStatus((v as "ok" | "error") ?? "")
              setPage(1)
            }}
            options={[
              { label: "成功", value: "ok" },
              { label: "失败", value: "error" },
            ]}
          />
          <AdminRangePicker
            value={{ range, from: rangeFrom, to: rangeTo }}
            onChange={(next) => {
              setRange(next.range)
              setRangeFrom(next.from)
              setRangeTo(next.to)
              setPage(1)
            }}
          />
          <Input.Search
            allowClear
            placeholder="搜用户昵称 / 手机号 / 提问内容"
            style={{ width: 280 }}
            onSearch={(v) => {
              setQ(v)
              setPage(1)
            }}
          />
        </Space>
      </div>

      <Table<Row>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data?.data ?? []}
        expandable={{
          expandedRowRender: (r) => (
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="提问">
                <Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.question}</Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="AI 回答">
                {r.answer ? (
                  <Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.answer}</Paragraph>
                ) : (
                  <Text type="secondary">（本轮失败，没有回答）</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="用户 ID">{r.userId}</Descriptions.Item>
              <Descriptions.Item label="模型">{r.model ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="失败原因">{r.errorMessage ?? "—"}</Descriptions.Item>
            </Descriptions>
          ),
        }}
        locale={{
          emptyText: (
            <Empty
              description={
                data?.applied.q
                  ? "没有匹配的对话记录（试试换关键词或放宽时间范围）"
                  : `这段时间没有 AI 对话记录（${data?.applied.rangeLabel ?? "—"}）`
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
        columns={[
          {
            dataIndex: "createdAt",
            title: "时间",
            width: 170,
            render: (v: string) => formatAdminTime(v),
          },
          {
            dataIndex: "userName",
            title: "用户",
            width: 180,
            render: (_: unknown, r: Row) => (
              // 能点进用户详情：与其它后台列表一致，「这个人还干了什么」一次点击可达
              <Link href={`/admin/users/${r.userId}`}>
                {r.userName ?? "（未命名）"}
                {r.userPhone ? <Text type="secondary"> {r.userPhone}</Text> : null}
              </Link>
            ),
          },
          {
            dataIndex: "question",
            title: "提问",
            render: (v: string) => (
              <span title={v}>
                {v.length > QUESTION_PREVIEW ? `${v.slice(0, QUESTION_PREVIEW)}…` : v}
              </span>
            ),
          },
          {
            dataIndex: "historyCount",
            title: "上下文",
            width: 90,
            render: (v: number) => (
              <Text type="secondary">{v > 0 ? `${v} 条` : "首问"}</Text>
            ),
          },
          {
            dataIndex: "status",
            title: "状态",
            width: 90,
            render: (v: string, r: Row) =>
              v === "ok" ? (
                <Tag color="green">成功</Tag>
              ) : (
                <Tag color="red" title={r.errorMessage ?? undefined}>
                  失败
                </Tag>
              ),
          },
          {
            dataIndex: "usedFreeQuota",
            title: "消耗",
            width: 110,
            render: (v: number, r: Row) =>
              v === 1 ? <Tag color="blue">免费额度</Tag> : <span>{r.diamondsCost} 钻石</span>,
          },
          {
            dataIndex: "latencyMs",
            title: "耗时",
            width: 90,
            render: (v: number | null) => (v === null ? "—" : `${v} ms`),
          },
        ]}
      />
    </div>
  )
}
