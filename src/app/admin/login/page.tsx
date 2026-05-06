"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, Typography, Spin, Result } from "antd"
import { createClient } from "@/lib/supabase/client"

const { Title, Text } = Typography

export default function AdminLoginPage() {
  const router = useRouter()
  const [state, setState] = useState<"checking" | "not_logged_in" | "not_admin" | "redirecting">("checking")

  useEffect(() => {
    async function check() {
      const supabase = createClient()
      if (!supabase) {
        // Dev mode: skip auth, go straight to admin
        setState("redirecting")
        router.replace("/admin")
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setState("not_logged_in")
        return
      }

      // Check admin role
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .single()

      if (profile?.role !== "admin") {
        setState("not_admin")
        return
      }

      setState("redirecting")
      router.replace("/admin")
    }
    check()
  }, [router])

  if (state === "checking") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "var(--background, #0f172a)" }}>
        <Spin size="large" />
      </div>
    )
  }

  if (state === "not_logged_in") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "var(--background, #0f172a)", padding: 16 }}>
        <Card style={{ width: 400, maxWidth: "100%", textAlign: "center" }}>
          <Title level={3} style={{ marginBottom: 8 }}>TypeNow 管理后台</Title>
          <Text type="secondary" style={{ display: "block", marginBottom: 24 }}>
            请先登录你的账号
          </Text>
          <Button
            type="primary"
            size="large"
            block
            onClick={() => router.push("/login?redirect=/admin")}
          >
            前往登录
          </Button>
        </Card>
      </div>
    )
  }

  if (state === "not_admin") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "var(--background, #0f172a)", padding: 16 }}>
        <Card style={{ width: 400, maxWidth: "100%" }}>
          <Result
            status="error"
            title="无管理员权限"
            subTitle="当前账号不是管理员，如需开通请联系网站管理员。"
            extra={
              <Button type="primary" onClick={() => router.push("/home")}>
                返回首页
              </Button>
            }
          />
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              管理员请在 Supabase SQL Editor 执行：
            </Text>
            <pre style={{ marginTop: 8, padding: 8, background: "var(--muted, #1e293b)", borderRadius: 6, fontSize: 11, textAlign: "left" }}>
              UPDATE public.profiles SET role = 'admin' WHERE phone = '你的手机号';
            </pre>
          </div>
        </Card>
      </div>
    )
  }

  return null
}
