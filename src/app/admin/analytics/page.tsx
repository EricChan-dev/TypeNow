"use client"

import { useEffect, useState } from "react"
import { Card, Col, Row, Statistic, Table, Typography, Spin } from "antd"
import { createClient } from "@/lib/supabase/client"

const { Title } = Typography

interface EventStats {
  page_view: number
  click_subscribe: number
  subscribe_pay_success: number
  login_success: number
  theme_dark: number
  theme_light: number
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [todayEvents, setTodayEvents] = useState(0)
  const [weekEvents, setWeekEvents] = useState(0)
  const [conversion, setConversion] = useState({ clicks: 0, success: 0 })
  const [topPages, setTopPages] = useState<Array<{ page: string; count: number }>>([])

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient()
      if (!supabase) { setLoading(false); return }

      const today = new Date().toISOString().split("T")[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [{ count: todayCount }, { count: weekCount }, clickRes, successRes] =
        await Promise.all([
          supabase.from("analytics_events").select("*", { count: "exact", head: true }).gte("created_at", today),
          supabase.from("analytics_events").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
          supabase.from("analytics_events").select("*", { count: "exact", head: true }).eq("event_type", "click_subscribe"),
          supabase.from("analytics_events").select("*", { count: "exact", head: true }).eq("event_type", "subscribe_pay_success"),
        ])

      const clickCount = clickRes?.count ?? 0
      const successCount = successRes?.count ?? 0

      const { data: pages } = await supabase
        .from("analytics_events")
        .select("properties")
        .eq("event_type", "page_view")
        .gte("created_at", weekAgo)
        .limit(1000)

      const pageCounts: Record<string, number> = {}
      ;(pages as Array<{ properties: Record<string, string> }> | null)?.forEach((p) => {
        const pv = p.properties?.page || "/"
        pageCounts[pv] = (pageCounts[pv] || 0) + 1
      })
      setTopPages(
        Object.entries(pageCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([p, c]) => ({ page: p, count: c }))
      )

      setTodayEvents(todayCount || 0)
      setWeekEvents(weekCount || 0)
      setConversion({ clicks: clickCount, success: successCount })
      setLoading(false)
    }
    fetchData()
  }, [])

  const pageCols = [
    { title: "页面", dataIndex: "page", key: "page" },
    { title: "浏览量", dataIndex: "count", key: "count" },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>数据分析</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card loading={loading}>
            <Statistic title="今日事件" value={todayEvents} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card loading={loading}>
            <Statistic title="本周事件" value={weekEvents} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card loading={loading}>
            <Statistic
              title="订阅转化率"
              value={conversion.clicks > 0 ? ((conversion.success / conversion.clicks) * 100).toFixed(1) : 0}
              suffix="%"
              valueStyle={{ color: "#22C55E" }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="热门页面（本周）" style={{ marginTop: 24 }}>
        <Table
          columns={pageCols}
          dataSource={topPages}
          rowKey="page"
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  )
}
