"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { List, CreateButton, useTable, EditButton } from "@refinedev/antd"
import { Input, Select, Space, Spin, Table, Tag } from "antd"
import DeleteRestoreButton from "@/components/admin/DeleteRestoreButton"
import DeletedViewToggle from "@/components/admin/DeletedViewToggle"
import { withFilter } from "@/lib/admin-drilldown"

interface CourseOption {
  id: string
  title: string | null
}

/**
 * 课时列表。
 *
 * 课时有 16,891 条，此前只有"按标题/简介模糊搜索"一条路，而且「课程ID」列
 * 显示的是原始 UUID —— 想找某一课下的课时，只能先知道课程的 UUID 再肉眼比对。
 * 接口本来支持 `courseId`，只是前端从来没发过。
 *
 * 现在补上"按课程筛"：课程 775 条，用可搜索下拉（服务端搜索，见 /api/admin/courses?q=）。
 */
export default function LessonsList() {
  const { tableProps, tableQuery, filters, setFilters } = useTable({
    pagination: { pageSize: 50 },
    syncWithLocation: true,
  })

  const courseId =
    (filters ?? [])
      .filter((f) => "field" in f && String(f.field) === "courseId")
      .map((f) => ("value" in f ? String(f.value) : ""))[0] || ""

  const [options, setOptions] = useState<CourseOption[]>([])
  const [searching, setSearching] = useState(false)
  // 防抖 + 竞态保护：快速输入时只认最后一次请求
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const searchCourses = useCallback((keyword: string) => {
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
          `/api/admin/courses?q=${encodeURIComponent(keyword.trim())}&pageSize=20`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: CourseOption[] }
        if (mine !== seq.current) return
        setOptions(json.data ?? [])
      } catch {
        if (mine === seq.current) setOptions([])
      } finally {
        if (mine === seq.current) setSearching(false)
      }
    }, 300)
  }, [])

  // 直接带 courseId 打开时（从课程详情跳过来）下拉没有候选，补一次标题，
  // 否则 antd 会把原始 UUID 当标签显示出来
  useEffect(() => {
    if (!courseId || options.some((o) => o.id === courseId)) return
    let cancelled = false
    fetch(`/api/admin/courses/${courseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: CourseOption } | null) => {
        const course = json?.data
        if (!cancelled && course?.id) {
          setOptions((prev) => (prev.some((o) => o.id === course.id) ? prev : [course, ...prev]))
        }
      })
      .catch(() => {
        /* 拿不到标题就退回显示 id，不影响列表 */
      })
    return () => {
      cancelled = true
    }
    // options 刻意不进依赖：只在"当前课程的标题还不知道"时补一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  return (
    <List headerButtons={<CreateButton>新增课时</CreateButton>}>
      <Space style={{ marginBottom: 16 }} wrap>
        <DeletedViewToggle filters={filters as never} setFilters={setFilters as never} />
        <Select
          showSearch
          allowClear
          style={{ width: 320 }}
          placeholder="按课程筛选（输入课程标题）"
          value={courseId || undefined}
          filterOption={false}
          onSearch={searchCourses}
          notFoundContent={searching ? <Spin size="small" /> : null}
          onChange={(v) =>
            // 只替换 courseId，保留删除视图等其他条件
            setFilters(withFilter(filters as never, "courseId", v ?? ""), "replace")
          }
          options={options.map((o) => ({ value: o.id, label: o.title || "(无标题)" }))}
        />
        <Input.Search
          allowClear
          placeholder="搜索课时名称 / 简介"
          style={{ width: 300 }}
          onSearch={(value) =>
            // 只替换 q，保留课程筛选与删除视图
            setFilters(withFilter(filters as never, "q", value.trim()), "replace")
          }
        />
      </Space>

      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="title"
          title="课时名称"
          ellipsis
          render={(v: string, r: { deletedAt?: string | null }) =>
            r.deletedAt ? (
              <Space size={6}>
                <Tag color="red">已删除</Tag>
                <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{v}</span>
              </Space>
            ) : (
              v
            )
          }
        />
        <Table.Column
          dataIndex="courseTitle"
          title="所属课程"
          width={220}
          ellipsis
          // 接口已 LEFT JOIN 出 courseTitle；拿不到时退回显示 UUID，
          // 但那种情况本身就该被看见（说明课程的 join 断了）
          render={(v: string | null, r: { courseId: string }) => v || r.courseId}
        />
        <Table.Column dataIndex="sortOrder" title="排序" width={80} />
        <Table.Column dataIndex="summary" title="简介" ellipsis />
        <Table.Column
          title="操作"
          width={160}
          render={(_, record: { id: string; deletedAt?: string | null }) => (
            <Space>
              <EditButton recordItemId={record.id} hideText size="small" />
              <DeleteRestoreButton
                basePath="/api/admin/lessons"
                id={record.id}
                isDeleted={record.deletedAt != null}
                hasChildren
                onDone={() => tableQuery.refetch()}
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
