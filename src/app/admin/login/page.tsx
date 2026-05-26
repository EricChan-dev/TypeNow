"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, Form, Input, Typography, Spin } from "antd"

const { Title, Text } = Typography

export default function AdminLoginPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user) {
          router.replace("/admin")
        } else {
          setChecking(false)
        }
      })
      .catch(() => setChecking(false))
  }, [router])

  async function handleLogin(values: { email: string; password: string }) {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "登录失败")
      router.replace("/admin")
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "var(--background, #0f172a)" }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "var(--background, #0f172a)", padding: 16 }}>
      <Card style={{ width: 400, maxWidth: "100%" }}>
        <Title level={3} style={{ textAlign: "center", marginBottom: 8 }}>TypeNow 管理后台</Title>
        <Text type="secondary" style={{ display: "block", textAlign: "center", marginBottom: 24 }}>
          使用管理员账号登录
        </Text>
        <Form onFinish={handleLogin} layout="vertical">
          <Form.Item name="email" label="邮箱" rules={[{ required: true }]}>
            <Input type="email" autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          {error && <p style={{ color: "red", marginBottom: 12 }}>{error}</p>}
          <Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
