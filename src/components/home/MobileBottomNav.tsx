"use client"

import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, BookOpen, ShoppingBag, BookText, BookMarked, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

const tabs = [
  { key: "/home", label: "首页", icon: LayoutDashboard },
  { key: "/home/courses", label: "课程", icon: BookOpen },
  { key: "/home/store", label: "广场", icon: ShoppingBag },
  { key: "/home/wordbook", label: "单词本", icon: BookText },
  { key: "/home/review", label: "复习", icon: BookMarked },
  { key: "/home/partner", label: "合伙人", icon: TrendingUp },
]

export function MobileBottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  // Hide on learn page and partner page (full-screen experiences)
  if (pathname.startsWith("/home/learn/") || pathname.startsWith("/home/partner")) return null

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const isActive = pathname === tab.key || (tab.key !== "/home" && pathname.startsWith(tab.key))
          return (
            <button
              key={tab.key}
              onClick={() => router.push(tab.key)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                isActive ? "text-accent" : "text-muted-foreground"
              )}
            >
              <tab.icon className={cn("h-5 w-5", isActive ? "text-accent" : "")} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
