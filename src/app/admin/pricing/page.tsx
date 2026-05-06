"use client"

import { useEffect, useState } from "react"
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Typography,
  Spin,
  message,
  Tabs,
} from "antd"
import { SaveOutlined } from "@ant-design/icons"
import { createClient } from "@/lib/supabase/client"

const { Title } = Typography

interface PlanData {
  name: string
  price: number
  period: string
  description: string
  originalPrice?: string
  subPeriod?: string
  badge?: string
  saveBadge?: string
  features: string[]
  ctaText: string
  variant: string
}

export default function PricingConfig() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [plans, setPlans] = useState<Record<string, PlanData>>({})
  const [activeTab, setActiveTab] = useState("free")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      if (!supabase) { setLoading(false); return }
      const { data } = await supabase
        .from("site_config")
        .select("value")
        .eq("key", "pricing")
        .single()
      if (data?.value?.plans) {
        setPlans(data.value.plans)
      }
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    const supabase = createClient()
    if (!supabase) { message.error("服务未配置"); return }
    setSaving(true)
    const { error } = await supabase
      .from("site_config")
      .upsert({ key: "pricing", value: { plans }, updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) message.error("保存失败")
    else message.success("已保存")
  }

  function updatePlan(key: string, values: Partial<PlanData>) {
    setPlans((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...values },
    }))
  }

  if (loading) return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>定价配置</Title>
        <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>
          保存
        </Button>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        {Object.entries(plans).map(([key, plan]) => (
          <Tabs.TabPane tab={plan.name} key={key}>
            <Card>
              <Form layout="vertical">
                <Form.Item label="方案名称">
                  <Input
                    value={plan.name}
                    onChange={(e) => updatePlan(key, { name: e.target.value })}
                  />
                </Form.Item>
                <Form.Item label="价格（元）">
                  <InputNumber
                    value={plan.price}
                    onChange={(v) => updatePlan(key, { price: v || 0 })}
                    min={0}
                  />
                </Form.Item>
                <Form.Item label="周期文案">
                  <Input
                    value={plan.period}
                    onChange={(e) => updatePlan(key, { period: e.target.value })}
                  />
                </Form.Item>
                <Form.Item label="描述">
                  <Input.TextArea
                    value={plan.description}
                    onChange={(e) => updatePlan(key, { description: e.target.value })}
                    rows={2}
                  />
                </Form.Item>
                <Form.Item label="功能列表（每行一项）">
                  <Input.TextArea
                    value={plan.features.join("\n")}
                    onChange={(e) =>
                      updatePlan(key, { features: e.target.value.split("\n").filter(Boolean) })
                    }
                    rows={6}
                  />
                </Form.Item>
                <Form.Item label="按钮文案">
                  <Input
                    value={plan.ctaText}
                    onChange={(e) => updatePlan(key, { ctaText: e.target.value })}
                  />
                </Form.Item>
                <Form.Item label="卡片样式">
                  <Input
                    value={plan.variant}
                    onChange={(e) => updatePlan(key, { variant: e.target.value })}
                  />
                </Form.Item>
                {plan.badge !== undefined && (
                  <Form.Item label="角标">
                    <Input
                      value={plan.badge}
                      onChange={(e) => updatePlan(key, { badge: e.target.value })}
                    />
                  </Form.Item>
                )}
                {plan.saveBadge !== undefined && (
                  <Form.Item label="优惠标签">
                    <Input
                      value={plan.saveBadge}
                      onChange={(e) => updatePlan(key, { saveBadge: e.target.value })}
                    />
                  </Form.Item>
                )}
              </Form>
            </Card>
          </Tabs.TabPane>
        ))}
      </Tabs>
    </div>
  )
}
