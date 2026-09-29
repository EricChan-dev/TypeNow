"use client"

/**
 * 后台「操作审计」页面。
 *
 * 这个页面回答的是**后台从上线起就答不了的那类问题**：谁给谁开的会员、
 * 谁删了那门课、谁把某人提成了管理员。业务表只留最终状态，改动过程一律查不到。
 *
 * 几个刻意的设计：
 *
 * 1. **只读，且没有任何"清理日志"入口**。能在界面上删掉的审计日志不算审计 ——
 *    清理只能由 DBA 在库上做（且应当是归档）。
 *
 * 2. **默认落在「近一周」**。审计日志只增不减，默认"不限"会让第一次打开的人
 *    面对一张很长的表；而有明确怀疑对象时，用搜索比翻页快。
 *
 * 3. **变化用 `字段: 旧 → 新` 直接摊在行里**，不藏在弹窗后面。
 *    审计页最高频的动作就是"扫一眼看看谁动了什么"，多一次点击就少看十条。
 *
 * 4. detail 里的 JSON 是**服务端脱敏后**才落库的（见 lib/admin-audit.ts），
 *    这里只负责渲染 —— 页面不再做第二遍脱敏，否则会给人"页面能看到的库里有"
 *    的错觉。
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { Alert, Card, Descriptions, Empty, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd"
import { useAdminFetch } from "@/lib/admin-fetch"
import { type StatsRange } from "@/lib/admin-range"
import { AdminRangePicker } from "@/components/admin/AdminRangePicker"
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_TARGET_OPTIONS,
  auditActionLabel,
  auditTargetLabel,
} from "@/lib/admin-audit-labels"
import { formatAdminTime } from "@/lib/admin-time"

const { Title, Text } = Typography

interface Row {
  id: string
  adminId: string | null
  adminLabel: string | null
  action: string
  targetType: string
  targetId: string | null
  targetLabel: string | null
  detail: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

interface ListBody {
  data: Row[]
  total: number
  actors: Array<{ id: string; label: string }>
}

function fmtTime(v: string | null): string {
  return formatAdminTime(v)
}

/** 目标对象的详情页链接：能跳的尽量跳，跳不了就只显示文本 */
const TARGET_HREF: Record<string, (id: string) => string> = {
  user: (id) => `/admin/users/${id}`,
  course: (id) => `/admin/courses/${id}/edit`,
  lesson: (id) => `/admin/lessons/${id}/edit`,
  sentence: (id) => `/admin/sentences/${id}/edit`,
}

/**
 * 把 detail 渲染成一组「字段: 旧 → 新」。
 *
 * 三种形态都要能读：
 *   - `{ from, to }`  —— diffAuditFields 产出的变更（编辑类动作）
 *   - 标量 / 数组     —— 新建、上传、导入时的字段快照
 *   - 其它对象        —— 原样 JSON（例如 delete 的 impact 影响面）
 */
function renderDetailValue(key: string, value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value) && "from" in (value as object) && "to" in (value as object)) {
    const v = value as { from: unknown; to: unknown }
    return (
      <Space size={4} key={key}>
        <Text type="secondary">{key}</Text>
        <Text delete type="secondary">
          {formatScalar(v.from)}
        </Text>
        <Text>→</Text>
        <Text strong>{formatScalar(v.to)}</Text>
      </Space>
    )
  }
  return (
    <Space size={4} key={key}>
      <Text type="secondary">{key}</Text>
      <Text>{formatScalar(value)}</Text>
    </Space>
  )
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export default function AuditLogsPage() {
  const [action, setAction] = useState<string>("")
  const [targetType, setTargetType] = useState<string>("")
  const [adminId, setAdminId] = useState<string>("")
  const [range, setRange] = useState<StatsRange>("week")
  // 自定义区间两端（只有 range=custom 时有值）
  const [rangeFrom, setRangeFrom] = useState<string | null>(null)
  const [rangeTo, setRangeTo] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (action) p.set("action", action)
    if (targetType) p.set("targetType", targetType)
    if (adminId) p.set("adminId", adminId)
    if (range !== "all") p.set("range", range)
    if (q.trim()) p.set("q", q.trim())
    p.set("current", String(page))
    p.set("pageSize", String(pageSize))
    return p.toString()
  }, [action, targetType, adminId, range, q, page, pageSize])

  const { data, loading, error } = useAdminFetch<ListBody>(`/api/admin/audit-logs?${query}`)

  const rows = data?.data ?? []
  const actors = data?.actors ?? []

  const columns = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 165,
      render: (v: string) => fmtTime(v),
    },
    {
      title: "操作人",
      dataIndex: "adminLabel",
      width: 170,
      render: (v: string | null, r: Row) => (
        <Tooltip title={r.adminId ?? undefined}>
          <Text>{v ?? "(未知)"}</Text>
        </Tooltip>
      ),
    },
    {
      title: "动作",
      dataIndex: "action",
      width: 150,
      render: (v: string, r: Row) => (
        <Space size={4}>
          <Tag color="blue">{auditActionLabel(v)}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {auditTargetLabel(r.targetType)}
          </Text>
        </Space>
      ),
    },
    {
      title: "对象",
      dataIndex: "targetLabel",
      width: 260,
      render: (v: string | null, r: Row) => {
        const build = r.targetId ? TARGET_HREF[r.targetType] : undefined
        const text = v ?? (r.targetId ? r.targetId.slice(0, 8) : "—")
        return build && r.targetId ? (
          <Link href={build(r.targetId)}>{text}</Link>
        ) : (
          <Text>{text}</Text>
        )
      },
    },
    {
      title: "变更内容",
      dataIndex: "detail",
      render: (v: Record<string, unknown> | null) => {
        if (!v || Object.keys(v).length === 0) return <Text type="secondary">—</Text>
        return (
          <Space direction="vertical" size={0}>
            {Object.entries(v)
              // undefined 的字段是调用方按条件塞进来的（例如只有改了状态才记 status），
              // 渲染成 "—" 反而像"改成了空"，直接不显示
              .filter(([, val]) => val !== undefined && val !== null)
              .map(([key, val]) => renderDetailValue(key, val))}
          </Space>
        )
      },
    },
    {
      title: "来源 IP",
      dataIndex: "ip",
      width: 130,
      render: (v: string | null) => (
        <Tooltip title={undefined}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {v ?? "—"}
          </Text>
        </Tooltip>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            操作审计
          </Title>
          <Text type="secondary">
            后台的写操作留痕：谁、什么时候、对哪个对象、把什么改成了什么
          </Text>
        </div>
        <Space wrap>
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder="按动作"
            value={action || undefined}
            onChange={(v) => {
              setAction((v as string) ?? "")
              setPage(1)
            }}
            options={AUDIT_ACTION_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          />
          <Select
            allowClear
            style={{ width: 130 }}
            placeholder="按对象"
            value={targetType || undefined}
            onChange={(v) => {
              setTargetType((v as string) ?? "")
              setPage(1)
            }}
            options={AUDIT_TARGET_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          />
          <Select
            allowClear
            style={{ width: 170 }}
            placeholder="按操作人"
            value={adminId || undefined}
            onChange={(v) => {
              setAdminId((v as string) ?? "")
              setPage(1)
            }}
            // 选项来自日志里**实际出现过**的操作人，而不是 users 表里现在的管理员：
            // 已经卸任的管理员，他做过的事仍然要能查到
            options={actors.map((a) => ({ label: a.label, value: a.id }))}
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
            placeholder="搜操作人 / 对象名称"
            style={{ width: 220 }}
            onSearch={(v) => {
              setQ(v)
              setPage(1)
            }}
          />
        </Space>
      </div>

      <Card size="small" style={{ marginTop: 16 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          日志只增不减，页面不提供删除入口。变更内容里的敏感字段（token / 密码 / openid 等）
          在写入时就已被服务端丢弃，库里不存在这些值。
        </Text>
      </Card>

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
        expandable={{
          // 完整 detail 放进展开行：列表里只摊开一屏放得下的部分
          expandedRowRender: (r: Row) => (
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="日志 ID">{r.id}</Descriptions.Item>
              <Descriptions.Item label="操作人 ID">{r.adminId ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="对象 ID">{r.targetId ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="User-Agent">{r.userAgent ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="detail">
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
                  {r.detail ? JSON.stringify(r.detail, null, 2) : "—"}
                </pre>
              </Descriptions.Item>
            </Descriptions>
          ),
        }}
        locale={{
          emptyText: (
            <Empty
              description="这段时间没有后台写操作记录（或都被筛掉了）"
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
    </div>
  )
}
