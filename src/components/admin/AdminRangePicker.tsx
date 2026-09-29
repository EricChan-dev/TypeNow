"use client"

import { Segmented, Space } from "antd"
import {
  RANGE_OPTIONS,
  defaultCustomRange,
  type RangeSelection,
  type StatsRange,
} from "@/lib/admin-range"

interface AdminRangePickerProps {
  value: RangeSelection
  onChange: (next: RangeSelection) => void
  /** 裁剪选项（例如反馈页不需要「不限」） */
  allowed?: readonly StatsRange[]
}

/**
 * 后台统一的时间范围选择器：预设 + 自定义区间。
 *
 * 两处刻意的取舍：
 *
 * 1. **自定义日期用原生 `input[type=date]`，不用 Ant Design 的 RangePicker。**
 *    antd 的日期组件要传 dayjs 对象，而 dayjs 不是本项目的直接依赖 ——
 *    pnpm 的严格 node_modules 下不能直接 import 传递依赖。
 *    手工加进 package.json 而不更新 lockfile 会让 CI 的
 *    `pnpm install --frozen-lockfile` 直接失败；为两个日期框改依赖不值得。
 *    原生控件还自带移动端的日期选择器。
 *
 * 2. **切到「自定义」时立刻给出默认区间（近 7 天）**，而不是先发一个
 *    `range=custom` 却缺 from/to 的请求 —— 后端会把它回落到近一周并标注
 *    "自定义日期不完整"，那是给手改 URL 兜底的路径，不该被正常操作撞上。
 *
 * 所有页面的 range/from/to 都从这里出，避免各页各写一套导致口径漂移。
 */
export function AdminRangePicker({ value, onChange, allowed }: AdminRangePickerProps) {
  const options = RANGE_OPTIONS.filter((o) => !allowed || allowed.includes(o.value))
  const today = defaultCustomRange().to

  return (
    <Space size={8} wrap>
      <Segmented
        size="small"
        value={value.range}
        options={options.map((o) => ({ label: o.label, value: o.value }))}
        onChange={(next) => {
          const range = next as StatsRange
          if (range === "custom") {
            const fallback = defaultCustomRange()
            onChange({
              range: "custom",
              from: value.from ?? fallback.from,
              to: value.to ?? fallback.to,
            })
            return
          }
          // 预设窗口是"从现在往回数"，不带上界 —— 清掉 from/to，避免残留旧区间
          onChange({ range, from: null, to: null })
        }}
      />

      {value.range === "custom" ? (
        <Space size={4}>
          <input
            type="date"
            aria-label="开始日期"
            value={value.from ?? ""}
            max={value.to ?? today}
            onChange={(e) => onChange({ ...value, from: e.target.value || null })}
            className="rounded-md border px-2 py-1 text-[13px]"
            style={{
              background: "var(--ant-color-bg-container, #fff)",
              borderColor: "var(--ant-color-border, #d9d9d9)",
              color: "inherit",
            }}
          />
          <span style={{ opacity: 0.5 }}>~</span>
          <input
            type="date"
            aria-label="结束日期"
            value={value.to ?? ""}
            min={value.from ?? undefined}
            max={today}
            onChange={(e) => onChange({ ...value, to: e.target.value || null })}
            className="rounded-md border px-2 py-1 text-[13px]"
            style={{
              background: "var(--ant-color-bg-container, #fff)",
              borderColor: "var(--ant-color-border, #d9d9d9)",
              color: "inherit",
            }}
          />
        </Space>
      ) : null}
    </Space>
  )
}
