"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { PanelLeftClose, PanelLeft } from "lucide-react"
import { HomeSidebar } from "@/components/home/HomeSidebar"

const pageTitles: Record<string, string> = {
  "/home": "首页",
  "/home/courses": "我的课程",
  "/home/store": "课程商城",
  "/home/archive": "学习档案",
  "/home/leaderboard": "排行榜",
}

export function HomeShell({ children, isPartner }: { children: React.ReactNode; isPartner?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  const isFullPage = pathname.startsWith("/home/learn/")
  const title = pageTitles[pathname] || ""

  if (isFullPage) {
    return <div className="flex-1 min-h-0 bg-black">{children}</div>
  }

  return (
    <div className="flex flex-1 min-h-0">
      <HomeSidebar collapsed={collapsed} isPartner={!!isPartner} />

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Content header bar */}
        <header className="h-[48px] shrink-0 border-b border-border bg-card/50 flex items-center gap-3 px-4">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={collapsed ? "展开菜单" : "折叠菜单"}
          >
            {collapsed ? (
              <PanelLeft className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
          </button>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
