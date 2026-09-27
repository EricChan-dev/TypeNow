"use client"

/**
 * 可点击的指标卡（仪表盘与数据分析页共用）。
 *
 * 「指标 → 明细」的闭环靠它落地：每个数字都要能一步走到构成它的记录。
 * 没有 href 的指标渲染成普通卡片，**不做**假链接 —— 点了没反应的链接
 * 比没有链接更消耗信任（使用者会怀疑整个后台的链接都不可靠）。
 *
 * drillHint 写的是"点进去会看到什么"（"这段时间注册的用户"），
 * 而不是"点这里"—— 落点往往与卡片标题不同名（比如「收入」落到已支付订单列表），
 * 提前说清楚能省掉一次"为什么点进去是订单"的困惑。
 */

import { Card, Statistic } from "antd"
import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"

interface Props {
  title: string
  value: string | number
  prefix?: ReactNode
  valueStyle?: CSSProperties
  loading?: boolean
  /** 有值时可点；不传则是纯展示卡片 */
  href?: string
  /** 落点说明，例如"这段时间练过的用户" */
  drillHint?: string
}

export default function MetricCard({
  title,
  value,
  prefix,
  valueStyle,
  loading,
  href,
  drillHint,
}: Props) {
  const card = (
    <Card loading={loading} hoverable={Boolean(href)} size="small">
      <Statistic title={title} value={value} prefix={prefix} valueStyle={valueStyle} />
      {href && drillHint ? (
        <div style={{ fontSize: 12, color: "#1677ff", marginTop: 4 }}>{drillHint} →</div>
      ) : null}
    </Card>
  )

  return href ? (
    <Link href={href} style={{ display: "block" }}>
      {card}
    </Link>
  ) : (
    card
  )
}
