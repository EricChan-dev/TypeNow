"use client"

import { useEffect, useState } from "react"
import { Card, Col, Row, Statistic, Table, Typography, Spin } from "antd"

const { Title } = Typography

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [todayEvents, setTodayEvents] = useState(0)
  const [weekEvents, setWeekEvents] = useState(0)
  const [topPages, setTopPages] = useState<Array<{ page: string; count: number }>>([])

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then((r) => r.json())
      .then((data) => {
        setTodayEvents(data.todayEvents ?? 0)
        setWeekEvents(data.weekEvents ?? 0)
        setTopPages(data.topPages ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const pageCols = [
    { title: "页面", dataIndex: "page", key: "page" },
    { title: "浏览量", dataIndex: "count", key: "count" },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>数据分析</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Card loading={loading}>
            <Statistic title="今日事件" value={todayEvents} />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card loading={loading}>
            <Statistic title="本周事件" value={weekEvents} />
          </Card>
        </Col>
      </Row>

      <Card title="热门页面（本周）" style={{ marginTop: 24 }}>
        <Table columns={pageCols} dataSource={topPages} rowKey="page" pagination={false} size="small" />
      </Card>
    </div>
  )
}
