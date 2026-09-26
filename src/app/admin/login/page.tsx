"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button, Card, Typography, Spin } from "antd"

const { Title, Text, Paragraph } = Typography

type State = "checking" | "not-logged-in" | "not-admin"

/**
 * 管理端入口页。
 *
 * 这个页面此前是一个 **email + 密码** 表单，但它**永远登不进去**：
 * `/api/admin/auth/login` 按 email 查用户，而生产库 `users.email` 一条都没有
 * （所有人都是手机号或微信注册）。所以它是一个纯死路。
 *
 * 更糟的是它在挂载时只判断 `data?.user` 是否存在就把人送去 /admin，
 * **没有校验角色**。于是「已登录但不是管理员」的人会被送到 /admin，
 * 再被 src/proxy.ts 的 isAdmin 分支重定向到首页 —— 表现为「点后台就跳回首页」，
 * 完全看不出原因。这个症状真实发生过。
 *
 * 现在的行为：
 *   已登录且是管理员 → 直接进 /admin
 *   已登录但不是管理员 → 明确告知当前账号不是管理员，并给出换号入口
 *   未登录           → 说明管理端用的是主站账号（手机号/微信），引导去 /login
 *
 * 管理身份来自 users.role='admin'（或环境变量 ADMIN_PHONES 里的手机号），
 * 见 src/lib/admin-auth.ts 与 src/proxy.ts。
 */
export default function AdminLoginPage() {
  const router = useRouter()
  const [state, setState] = useState<State>("checking")
  const [currentName, setCurrentName] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        const user = data?.user
        // /api/auth/me 会把管理员统一返回成 role:"admin"（含 ADMIN_PHONES 命中者）
        if (user?.role === "admin") {
          router.replace("/admin")
          return
        }
        setCurrentName(user?.name ?? null)
        setState(user ? "not-admin" : "not-logged-in")
      })
      .catch(() => setState("not-logged-in"))
  }, [router])

  if (state === "checking") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        padding: 16,
      }}
    >
      <Card style={{ width: 440, maxWidth: "100%" }}>
        <Title level={3} style={{ textAlign: "center", marginBottom: 8 }}>
          TypeNow 管理后台
        </Title>

        {state === "not-admin" ? (
          <>
            <Text type="secondary" style={{ display: "block", textAlign: "center", marginBottom: 20 }}>
              当前账号不是管理员
            </Text>
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              你正以{currentName ? `「${currentName}」` : "某个账号"}登录，但该账号没有管理权限。
              管理权限由账号角色决定（<code>users.role = &apos;admin&apos;</code>）。
            </Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              请切换到管理员账号 —— 最简单的方式是用管理员手机号或微信重新登录。
            </Paragraph>
          </>
        ) : (
          <>
            <Text type="secondary" style={{ display: "block", textAlign: "center", marginBottom: 20 }}>
              管理后台使用主站账号登录
            </Text>
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              管理端与主站共用同一个登录状态，没有独立的账号密码。
              请先用管理员手机号或微信登录主站，再回到这个页面。
            </Paragraph>
          </>
        )}

        <Link href="/login?redirect=%2Fadmin">
          <Button type="primary" size="large" block>
            {state === "not-admin" ? "换管理员账号登录" : "去登录"}
          </Button>
        </Link>
      </Card>
    </div>
  )
}
