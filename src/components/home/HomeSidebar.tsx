"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { LayoutDashboard, BookOpen, ShoppingBag, Trophy, Sparkles, TrendingUp, BookMarked, BookText, FileText } from "lucide-react"
import { cn } from "@/lib/utils"

interface HomeSidebarProps {
  collapsed: boolean
  isPartner?: boolean
}

export function HomeSidebar({ collapsed, isPartner }: HomeSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [dueCount, setDueCount] = useState(0)

  useEffect(() => {
    fetch("/api/review/list?status=due&pageSize=1")
      .then((r) => r.json())
      .then((d) => setDueCount(d.dueCount ?? 0))
      .catch(() => {})
  }, [])

  const baseItems = [
    { key: "/home", label: "首页", icon: LayoutDashboard },
    { key: "/home/courses", label: "我的课程", icon: BookOpen },
    { key: "/home/wordbook", label: "单词本", icon: BookText },
    { key: "/home/notes", label: "笔记本", icon: FileText },
    { key: "/home/review", label: "复习本", icon: BookMarked, badge: dueCount > 0 ? dueCount : null },
    { key: "/home/store", label: "课程广场", icon: ShoppingBag },
    { key: "/home/leaderboard", label: "排行榜", icon: Trophy },
  ]

  const isPartnerActive = pathname.startsWith("/home/partner")

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
        {baseItems.map((item) => {
          const isActive = pathname === item.key || (item.key !== "/home" && pathname.startsWith(item.key))

          return (
            <button
              key={item.key}
              onClick={() => router.push(item.key)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 w-full rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap",
                collapsed ? "justify-center px-0 py-3" : "px-3 py-3",
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
                "transition-opacity duration-200 flex-1 flex items-center justify-between",
                collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
              )}>
                {item.label}
                {"badge" in item && item.badge ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 leading-none">
                    {item.badge}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}

        {/* 合伙人入口 — 合伙人显示"推广中心"，非合伙人显示"加入合伙人" */}
        <button
          onClick={() => router.push("/home/partner")}
          title={collapsed ? (isPartner ? "推广中心" : "加入合伙人") : undefined}
          className={cn(
            "relative flex items-center gap-3 w-full rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap",
            collapsed ? "justify-center px-0 py-3.5 mt-2" : "px-3 py-3.5 mt-2",
            isPartnerActive
              ? "bg-amber-500/15 text-amber-600"
              : "bg-amber-500/[0.07] text-amber-600 hover:bg-amber-500/15 hover:text-amber-500"
          )}
          style={{
            border: "1px solid",
            borderColor: isPartnerActive ? "rgba(217,119,6,0.5)" : "rgba(217,119,6,0.35)",
          }}
        >
          {isPartner
            ? <TrendingUp className="h-[18px] w-[18px] shrink-0 text-amber-500" />
            : <Sparkles className="h-[18px] w-[18px] shrink-0 text-amber-500" />
          }
          <span className={cn(
            "transition-opacity duration-200 flex items-center gap-2",
            collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
          )}>
            {isPartner ? "推广中心" : "加入合伙人"}
            {!isPartner && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/25 text-amber-700 leading-none">
                NEW
              </span>
            )}
          </span>
        </button>
      </nav>
    </aside>
  )
}
