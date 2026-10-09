"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { PanelLeftClose, PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { isImmersivePracticeRoute } from "@/lib/immersive-route"
import { RefSidebar } from "@/components/home/RefSidebar"
import { ExpiryBanner } from "@/components/home/ExpiryBanner"
import type { ServerUser } from "@/components/layout/UserActions"

/**
 * 站内外框（参考页的 `.container-fuild` + `.sidebar-wrapper` + `.main-wrapper`）。
 *
 * 与旧版 HomeShell 的差别（不是微调，是换了一套外框）：
 *   · 删掉 64px 顶栏和 48px 内容标题栏 —— 参考页两者都没有，右侧直接是
 *     main-wrapper/mainBox 通到底。顶栏上的用户区移进侧边栏底部。
 *   · 删掉移动端底部 tab 栏（MobileBottomNav）—— 参考页移动端用的是
 *     64px 图标栏 + 抽屉，不是底部 tab。
 *   · 页面标题原来靠 48px 标题栏显示，现在不再有标题栏。原本自带 `<h1>` 的
 *     页面（leaderboard、membership）不受影响；其余页面的标题改由内容区首屏
 *     区块自己承担 —— 参考页也是这样做的。
 */
export function HomeShell({
  serverUser,
  children,
}: {
  serverUser: ServerUser | null
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()

  // 沉浸式练习页（/home/learn/*、/home/review/session）：外框整体让位。
  // 这些页面是 fixed inset-0 的全屏界面，留着侧边栏会盖在题目上。
  const isImmersive = isImmersivePracticeRoute(pathname)

  // 路由一变就收起抽屉，否则点完菜单抽屉还压在新页面上
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  if (isImmersive) {
    return <div className="home-ref-shell is-immersive">{children}</div>
  }

  return (
    <div className={cn("home-ref-shell", collapsed && "is-collapsed")}>
      <RefSidebar
        serverUser={serverUser}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        onCloseDrawer={() => setDrawerOpen(false)}
      />

      {drawerOpen && (
        <div className="ref-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
      )}

      {/* 悬浮折叠圆钮（参考页 .display-switch 的重建） */}
      <button
        type="button"
        className="ref-display-switch"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? "展开菜单" : "折叠菜单"}
      >
        {collapsed ? <PanelLeft /> : <PanelLeftClose />}
      </button>

      <div className="ref-main">
        {serverUser && (
          <ExpiryBanner
            memberTier={serverUser.member_tier ?? "free"}
            proExpires={serverUser.pro_expires ?? null}
          />
        )}
        <div className="ref-mainbox">{children}</div>
      </div>
    </div>
  )
}
