"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { List, CreateButton, useTable, EditButton } from "@refinedev/antd"
import { Alert, Input, Select, Space, Spin, Table, Tag, Typography } from "antd"
import DeleteRestoreButton from "@/components/admin/DeleteRestoreButton"
import { formatAdminTime } from "@/lib/admin-time"

const { Text } = Typography

interface LessonOption {
  id: string
  title: string | null
  courseId: string | null
}

/**
 * 句子管理列表。
 *
 * 这一页原本是"全局按 sort_order 排序的 46 万行表"——排序语义是错的
 * （sort_order 是课内顺序，全局排会把 16,891 个课时的第 1 句混在一起），
 * 而且没有可用索引，每次首屏都要全表 filesort（实测 0.9s，冷缓存 5.3s）。
 *
 * 现在两条路各有分工：
 *   - **选了课时** → 该课时的句子按课内顺序列出来（平均 27 行，毫秒级），
 *     搜索在这个课时内做精确子串匹配，并额外显示课内序号列。
 *   - **没选课时** → 显示"最近添加的句子"（唯一在全局意义上有效的顺序），
 *     搜索走**全文索引**做全库模糊匹配（见 db/migrations/00031）。
 *
 * 全库搜索此前是被**拒绝**的（接口 400）：`chinese LIKE '%词%'` 要扫 46 万行 /
 * 2.9GB，2026-09-29 生产实测 5.67~12.41 秒。加了 FULLTEXT ngram 索引之后才开放。
 * 它有两个硬限制（分词长度=2），所以搜索框下方的提示与空结果文案都由
 * lib/sentence-search.ts 生成 —— 与接口共用同一个纯函数，不重复一份规则。
 *
 * 为什么是「可搜索的课时下拉」而不是课程 → 课时两级联动：课程 775 个、
 * 课时 16,891 个，两级都要服务端搜索才可用；而按课时标题搜索一次就能定位，
 * 少一层点击。下拉的候选走 /api/admin/lessons?q=，接口本来就支持。
 */
export default function SentencesList() {
  const { tableProps, tableQuery, filters, setFilters } = useTable({
    pagination: { pageSize: 20 },
    syncWithLocation: true,
  })

  // 当前课时来自 refine 的 filters（URL 里带着它，刷新/分享都还在）
  const lessonId = useMemo(() => {
    const f = (filters ?? []).find((x) => "field" in x && String(x.field) === "lessonId")
    return f && "value" in f ? String(f.value ?? "") : ""
  }, [filters])

  const searchTerm = useMemo(() => {
    const f = (filters ?? []).find((x) => "field" in x && String(x.field) === "q")
    return f && "value" in f ? String(f.value ?? "") : ""
  }, [filters])

  const [options, setOptions] = useState<LessonOption[]>([])
  const [searching, setSearching] = useState(false)
  // 防抖 + 竞态保护：快速输入时只认最后一次请求的结果
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清掉待触发的防抖，避免在已卸载组件上 setState
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  /**
   * 直接带着 lessonId 打开这一页时（从课程→课时页跳过来、或分享链接），
   * 下拉的候选列表是空的，antd 会把原始 UUID 当标签显示出来 —— 那等于没告诉
   * 使用者现在看的是哪一课。所以这里按 id 补一次标题。
   */
  useEffect(() => {
    if (!lessonId) return
    let cancelled = false
    const known = options.some((o) => o.id === lessonId)
    if (known) return
    fetch(`/api/admin/lessons/${lessonId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: LessonOption } | null) => {
        const lesson = json?.data
        if (!cancelled && lesson?.id) {
          setOptions((prev) => (prev.some((o) => o.id === lesson.id) ? prev : [lesson, ...prev]))
        }
      })
      .catch(() => {
        /* 拿不到标题就退回显示 id，不影响列表本身能用 */
      })
    return () => {
      cancelled = true
    }
    // options 刻意不进依赖：这里只在"当前课时的标题还不知道"时补一次，
    // 跟着 options 变化会变成每次搜索都重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId])

  const searchLessons = useCallback((keyword: string) => {
    if (timer.current) clearTimeout(timer.current)
    if (!keyword.trim()) {
      setOptions([])
      return
    }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current
      setSearching(true)
      try {
        const res = await fetch(
          `/api/admin/lessons?q=${encodeURIComponent(keyword.trim())}&pageSize=20`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: LessonOption[] }
        if (mine !== seq.current) return // 已有更新的请求，丢弃这次结果
        setOptions(json.data ?? [])
      } catch {
        if (mine === seq.current) setOptions([])
      } finally {
        if (mine === seq.current) setSearching(false)
      }
    }, 300)
  }, [])

  /** 只替换一个筛选条件，保留其他 —— 搜索时不能把课时范围丢掉。 */
  const setOne = (field: string, value: string) => {
    const rest = (filters ?? []).filter(
      (x) => !("field" in x) || String(x.field) !== field,
    )
    setFilters(value ? [...rest, { field, operator: "eq", value }] : rest, "replace")
  }

  // 接口以 400 拒绝"无课时范围的全库搜索"；手工拼 URL 能触发，把原因显示出来
  const error = tableQuery?.error as { message?: string } | null | undefined

  return (
    <List headerButtons={<CreateButton>新增句子</CreateButton>}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          showSearch
          allowClear
          style={{ width: 380 }}
          placeholder="输入课时标题，先选课时"
          value={lessonId || undefined}
          // 服务端搜索：16,891 个课时不可能一次性塞进下拉
          filterOption={false}
          onSearch={searchLessons}
          notFoundContent={searching ? <Spin size="small" /> : null}
          onChange={(v) => setOne("lessonId", v ?? "")}
          options={options.map((o) => ({ value: o.id, label: o.title || "(无标题)" }))}
        />
        <Input.Search
          allowClear
          // 带课时 → 精确子串（走索引，2.7 毫秒）；不带课时 → 全库全文索引。
          defaultValue={searchTerm}
          placeholder={lessonId ? "在本课时内搜索中文或英文" : "全库搜索（中文 ≥2 字 / 英文 ≥3 字母）"}
          style={{ width: 320 }}
          onSearch={(value) => setOne("q", value.trim())}
        />
      </Space>

      {error?.message ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message="查询失败"
          description={error.message}
        />
      ) : null}

      {!lessonId ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={
            searchTerm
              ? "全库搜索结果（不限课时）"
              : "当前显示「最近添加的句子」"
          }
          description={
            <Space direction="vertical" size={2}>
              <Text>
                句子的 <Text code>sort_order</Text> 是课内顺序，不是全局序号，
                所以全局按它排序没有意义（会把每一课的第 1 句混在一起）。
                <Text strong>按课内顺序浏览请先在上方选择课时。</Text>
              </Text>
              <Text>
                不选课时可以搜索<Text strong>纯中文</Text>关键词（走全文索引{" "}
                <Text code>ft_sentences_search</Text>，中文至少 2 个字）。
              </Text>
              <Text type="secondary">
                英文、以及中英混合的关键词请先选课时再搜：实测全文索引对英文
                既会多匹配也会少匹配，返回不可靠的结果比拒绝更糟；
                课时内用的是精确匹配，中英文都准确。
              </Text>
            </Space>
          }
        />
      ) : null}

      <Table
        {...tableProps}
        rowKey="id"
        // 列多时不再挤压：x 取 max-content 让每列按内容所需宽度展开，
        // 超宽由表格自己横向滚动（配合下方操作列的 fixed="right"）。
        scroll={{ x: "max-content" }}
        locale={{
          emptyText: lessonId
            ? "该课时下没有匹配的句子"
            : searchTerm
              ? "全库没有匹配的句子"
              : "暂无句子",
        }}
      >
        {lessonId ? (
          <Table.Column dataIndex="sortOrder" title="课内序号" width={90} />
        ) : (
          <Table.Column
            dataIndex="createdAt"
            title="添加时间"
            width={170}
            render={(v: string) => formatAdminTime(v)}
          />
        )}
        <Table.Column dataIndex="chinese" title="中文" ellipsis />
        <Table.Column dataIndex="english" title="英文" ellipsis />
        <Table.Column
          dataIndex="difficulty"
          title="难度"
          width={80}
          render={(d: number) => (
            <Tag color={d === 1 ? "green" : d === 2 ? "gold" : "red"}>
              {d === 1 ? "简单" : d === 2 ? "中等" : "较难"}
            </Tag>
          )}
        />
        <Table.Column dataIndex="category" title="分类" width={100} />
        <Table.Column
          title="操作"
          width={120}
          // 横向滚动时操作列固定在右侧，始终点得到
          fixed="right"
          render={(_, record: { id: string; deletedAt?: string | null }) => (
            <Space>
              <EditButton recordItemId={record.id} hideText size="small" />
              <DeleteRestoreButton
                basePath="/api/admin/sentences"
                id={record.id}
                isDeleted={record.deletedAt != null}
                onDone={() => tableQuery.refetch()}
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
