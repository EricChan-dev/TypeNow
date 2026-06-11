"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { PanelLeftClose, PanelLeft, Menu, X } from "lucide-react"
import { HomeSidebar } from "@/components/home/HomeSidebar"
import { MobileBottomNav } from "@/components/home/MobileBottomNav"

const pageTitles: Record<string, string> = {
  "/home": "首页",
  "/home/courses": "我的课程",
  "/home/store": "课程广场",
  "/home/feed": "动态广场",
  "/home/archive": "学习档案",
  "/home/leaderboard": "排行榜",
}

export function HomeShell({ children, isPartner }: { children: React.ReactNode; isPartner?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()

  const isFullPage = pathname.startsWith("/home/learn/")
  const title = pageTitles[pathname] || ""

  if (isFullPage) {
    return <div className="flex-1 min-h-0 bg-background">{children}</div>
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <HomeSidebar collapsed={collapsed} isPartner={!!isPartner} />
      </div>

      {/* Mobile slide-over sidebar */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-[240px] h-full">
            <HomeSidebar collapsed={false} isPartner={!!isPartner} />
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0 pb-14 lg:pb-0">
        {/* Content header bar */}
        <header className="h-[48px] shrink-0 border-b border-border bg-card/50 flex items-center gap-3 px-3 sm:px-4">
          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={collapsed ? "展开菜单" : "折叠菜单"}
          >
            {collapsed ? (
              <PanelLeft className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="菜单"
          >
            {mobileMenuOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>

          <span className="text-sm font-semibold text-foreground">{title}</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
    </div>
  )
}
