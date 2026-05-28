"use client"

import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, BookOpen, ShoppingBag, FolderOpen, Trophy, Handshake, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface HomeSidebarProps {
  collapsed: boolean
  isPartner?: boolean
}

export function HomeSidebar({ collapsed, isPartner }: HomeSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const baseItems = [
    { key: "/home", label: "首页", icon: LayoutDashboard },
    { key: "/home/courses", label: "我的课程", icon: BookOpen },
    { key: "/home/store", label: "课程商城", icon: ShoppingBag },
    { key: "/home/archive", label: "学习档案", icon: FolderOpen },
    { key: "/home/leaderboard", label: "排行榜", icon: Trophy },
  ]

  // Partners see their dashboard; non-partners see the join page
  const partnerItem = isPartner
    ? { key: "/home/partner", label: "推广中心", icon: TrendingUp }
    : { key: "/home/partner", label: "合伙人中心", icon: Handshake }

  const menuItems = [...baseItems, partnerItem]

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-border bg-card flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
        collapsed ? "w-[60px]" : "w-[220px]"
      )}
    >
      <nav className={cn(
        "flex-1 space-y-1 py-4",
        collapsed ? "px-2" : "px-3"
      )}>
        {menuItems.map((item) => {
          const isActive = pathname === item.key || (item.key !== "/home" && pathname.startsWith(item.key))

          return (
            <button
              key={item.key}
              onClick={() => router.push(item.key)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 w-full rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap",
                collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  isActive ? "text-accent" : ""
                )}
              />
              <span className={cn(
                "transition-opacity duration-200",
                collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
              )}>
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
