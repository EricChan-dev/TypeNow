"use client"

/**
 * 列表页顶部的「当前钻取条件」提示条。
 *
 * 为什么必须有这一条：从仪表盘点「新增用户 5」落到用户列表，如果不说明
 * 列表正被时间范围筛着，看到的就是一堆历史用户 —— 使用者只会认为"仪表盘的数字
 * 是错的"。**钻取链接的落点必须自证口径**，否则闭环只闭了一半。
 *
 * 没有钻取条件时渲染 null（而不是一个空的提示框）。
 */

import { Alert, Space, Tag, Typography } from "antd"
import type { DrilldownBadge } from "@/lib/admin-drilldown"

const { Text } = Typography

interface Props {
  badges: DrilldownBadge[]
  /** 清空钻取条件（保留搜索词等其他条件） */
  onClear: () => void
  /** 这批数字的来源说明，由调用方给出 */
  source?: string
}

export default function DrilldownBanner({ badges, onClear, source = "仪表盘" }: Props) {
  if (badges.length === 0) return null

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message={
        <Space size={6} wrap>
          <Text>当前列表已按</Text>
          {badges.map((b) => (
            <Tag key={b.field} color="blue" style={{ marginInlineEnd: 0 }}>
              {b.label}
            </Tag>
          ))}
          <Text type="secondary">筛选（来自{source}）</Text>
          <a onClick={onClear}>清空</a>
        </Space>
      }
    />
  )
}
