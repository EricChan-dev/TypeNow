"use client"

import { Refine } from "@refinedev/core"
import routerProvider from "@refinedev/nextjs-router"
import { ThemedLayout } from "@refinedev/antd"
import { App, ConfigProvider, theme as antdTheme, Spin } from "antd"
import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { authProvider } from "@/lib/refine/auth-provider"
import { dataProvider } from "@/lib/refine/data-provider"
import { resources } from "@/lib/refine/resources"
import "@refinedev/antd/dist/reset.css"

function isDevMode() {
  return process.env.NODE_ENV === "development"
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [status, setStatus] = useState<"checking" | "ok" | "nope">("checking")

  useEffect(() => {
    if (pathname === "/admin/login") {
      setStatus("nope")
      return
    }

    // Dev mode: skip auth check
    if (isDevMode()) {
      setStatus("ok")
      return
    }

    authProvider.check?.().then((res) => {
      if (res.authenticated) {
        setStatus("ok")
      } else {
        setStatus("nope")
        router.replace("/admin/login")
      }
    }).catch(() => {
      setStatus("nope")
      router.replace("/admin/login")
    })
  }, [pathname, router])

  if (status === "checking") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" />
      </div>
    )
  }

  if (status === "nope") return null

  return <>{children}</>
}

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const isLoginPage = pathname === "/admin/login"

  return (
    <ConfigProvider
      theme={{
        // 深浅色切换已在 2026-10 移除，后台固定用 antd 的浅色算法。
        // 保留显式 algorithm 是为了记录这个决定，避免以后有人以为漏写了跟随逻辑。
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#6366F1",
          borderRadius: 8,
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
        },
      }}
    >
      <App>
        <Refine
          routerProvider={routerProvider}
          authProvider={authProvider}
          dataProvider={dataProvider}
          resources={resources}
          options={{ syncWithLocation: true, warnWhenUnsavedChanges: false }}
        >
          {isLoginPage ? (
            children
          ) : (
            <AuthGate>
              <ThemedLayout>{children}</ThemedLayout>
            </AuthGate>
          )}
        </Refine>
      </App>
    </ConfigProvider>
  )
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-root">
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </div>
  )
}
