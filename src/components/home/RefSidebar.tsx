"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard, BookOpen, ShoppingBag, GraduationCap,
  BookText, BookMarked, FileText, Newspaper, Trophy,
  Crown, TrendingUp, Settings, LogOut, MessageSquarePlus,
  PanelLeftClose, PanelLeft, Menu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BRAND } from "@/lib/brand"
import { memberTierLabel, type MemberTier } from "@/lib/pricing"
import { signOutAction } from "@/app/actions/auth"
import { GlobalSettingsModal } from "@/components/home/GlobalSettingsModal"
import { FeedbackModal } from "@/components/home/FeedbackModal"
import { CoinRulesModal } from "@/components/home/CoinRulesModal"
import type { ServerUser } from "@/components/layout/UserActions"

interface NavItem {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

/**
 * 侧边栏导航：**四条分组**，没有分组标题 —— 分隔靠 `ul::after` 的渐变细线。
 * 分组形状对齐参考页（参考页是 6/2/1/3 共四组），条目本身仍是我们的路由：
 * 参考页的「课程向导 / 查单词 / 音标语法」我们没有对应页面，不硬凑。
 */
const NAV_GROUPS: NavItem[][] = [
  [
    { key: "/home", label: "首页", icon: LayoutDashboard },
    { key: "/home/courses", label: "我的课程", icon: BookOpen },
    { key: "/home/store", label: "课程广场", icon: ShoppingBag },
    { key: "/home/textbook", label: "教材同步", icon: GraduationCap },
  ],
  [
    { key: "/home/wordbook", label: "单词本", icon: BookText },
    { key: "/home/review", label: "错题本", icon: BookMarked },
    { key: "/home/notes", label: "笔记本", icon: FileText },
  ],
  [
    { key: "/home/feed", label: "动态广场", icon: Newspaper },
    { key: "/home/leaderboard", label: "排行榜", icon: Trophy },
  ],
  [
    { key: "/home/membership", label: "会员中心", icon: Crown },
    { key: "/home/partner", label: "推广中心", icon: TrendingUp },
  ],
]

interface RefSidebarProps {
  serverUser: ServerUser | null
  collapsed: boolean
  onToggleCollapsed: () => void
  drawerOpen: boolean
  onToggleDrawer: () => void
  onCloseDrawer: () => void
}

export function RefSidebar({
  serverUser,
  collapsed,
  onToggleCollapsed,
  drawerOpen,
  onToggleDrawer,
  onCloseDrawer,
}: RefSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const [dueCount, setDueCount] = useState(0)
  const [userboxOpen, setUserboxOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [coinRulesOpen, setCoinRulesOpen] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)

  const userboxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/review/list?status=due&pageSize=1")
      .then((r) => r.json())
      .then((d) => setDueCount(d.dueCount ?? 0))
      .catch(() => {})
  }, [])

  // 弹出面板由点击开合（参考页也是点击驱动，不是 hover），点外部收起
  useEffect(() => {
    if (!userboxOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (userboxRef.current && !userboxRef.current.contains(e.target as Node)) {
        setUserboxOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [userboxOpen])

  async function handleLogout() {
    setUserboxOpen(false)
    try {
      await signOutAction()
    } catch {
      // 忽略：无论如何都跳走
    }
    window.location.href = "/"
  }

  function navigate(key: string) {
    onCloseDrawer()
    router.push(key)
  }

  const tier: MemberTier = serverUser?.member_tier ?? "free"
  const displayName = serverUser?.name || "同学"
  const avatar = serverUser?.avatar || null

  // 三个弹窗必须渲染在 <aside> **外面**：
  // .ref-sidebar 是 position:fixed + z-index:30，自己构成层叠上下文，
  // 挂在它内部的弹窗（z-50）只能在它内部比较，整棵子树被压在 30 这一层 ——
  // 结果就是 z-40 的 AiChatWidget 会盖在弹窗遮罩上，而侧边栏本身又盖不住。
  // 放到同级（都在 .home-ref-shell 下）后，50 > 40 > 30 恢复正常。
  return (
    <>
      <aside
        className={cn("ref-sidebar", collapsed && "is-collapsed", drawerOpen && "is-drawer-open")}
        aria-label="主导航"
      >
      {/* Logo —— 参考页在 `.on` 折叠态会切成 small 图形，但那只是同一个 mark 的
          两个尺寸；我们直接让 /brand/icon.png 随侧边栏宽度缩放即可，不必准备两张图。
          字标在折叠态隐藏（文字会被 is-collapsed 规则连同导航标签一起收起）。 */}
      <div className="ref-logo">
        {/* 与落地页同款结构（m00699）：icon.png 原比例 + font-brand 字标。
            gap 10px；侧栏 200px（m00826）内容宽 168px，90+10+64≈164 放得下。 */}
        <Link href="/home" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {/* 侧边栏 logo 在首屏内，且是 Next 判定出的 LCP 元素。默认 lazy
              会让它晚一步才请求，既拖慢 LCP 也会触发
              「Image ... detected as the Largest Contentful Paint (LCP)」警告，
              故显式 eager。m00858：源图换成紧裁版（同
              brand/web-logo/png/icon-tight.png，512×343）——旧方形图上下 39%
              是空白，72px 盒里猫只有 ~44px 高；现在 60px 盒高即 60px 猫高，
              宽 90 = 60×1.494 跟随源图宽高比（属性比≈实际比，防拉伸）。 */}
          <Image src="/brand/icon.png" alt={BRAND.nameZh} width={90} height={60} loading="eager" />
          {/* 字标与落地页同款排版：leading-none + tracking-tight（站酷快乐体）。
              字号固定在 22px 落地页档 —— m00784 用户纠正：连着两轮「大点」
              只该放大图标，字标不跟着涨。颜色沿用侧栏主题变量，不硬编码。 */}
          {!collapsed && (
            <span
              className="whitespace-nowrap font-brand text-[22px] leading-none tracking-tight"
              style={{ color: "var(--ref-bodyT)" }}
            >
              {BRAND.lockup}
            </span>
          )}
        </Link>
      </div>

      {/* 移动端抽屉开关：参考页没有（它靠 .display-switch 在平板态切抽屉） */}
      <button
        type="button"
        className="ref-mobile-toggle"
        onClick={drawerOpen ? onCloseDrawer : onToggleDrawer}
        aria-label={drawerOpen ? "收起菜单" : "展开菜单"}
      >
        {drawerOpen ? <PanelLeftClose /> : <Menu />}
      </button>

      <nav className="ref-nav">
        {NAV_GROUPS.map((group, gi) => (
          <ul key={gi}>
            {group.map((item) => {
              const isActive =
                pathname === item.key ||
                (item.key !== "/home" && pathname.startsWith(item.key))
              return (
                <li key={item.key} className={cn(isActive && "is-active")}>
                  <button
                    type="button"
                    onClick={() => navigate(item.key)}
                    title={collapsed ? item.label : undefined}
                    className={cn("ref-nav-item", isActive && "is-active")}
                  >
                    <item.icon className="ref-nav-icon" />
                    <span className="ref-nav-label">{item.label}</span>
                    {item.key === "/home/review" && dueCount > 0 && (
                      <span className="ref-nav-badge">{dueCount > 99 ? "99+" : dueCount}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ))}
      </nav>

      {/* 底部用户区 —— 参考页把用户信息放在这里（我们原来放在 64px 顶栏） */}
      {serverUser && (
        <div className="ref-userinfo" ref={userboxRef}>
          <button
            type="button"
            className="ref-userinfo-trigger"
            onClick={() => setUserboxOpen((v) => !v)}
            aria-expanded={userboxOpen}
            aria-label="账号菜单"
          >
            {avatar && !avatarFailed ? (
              <Image
                src={avatar}
                alt=""
                width={28}
                height={28}
                className="ref-userinfo-avatar"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span
                className="ref-userinfo-avatar"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {displayName[0].toUpperCase()}
              </span>
            )}
            <span className="ref-userinfo-text">
              <b className="ref-userinfo-name">{displayName}</b>
              <i className="ref-userinfo-tier">
                {memberTierLabel(tier)}
                {(serverUser.coins ?? 0) > 0 ? ` · 🪙${serverUser.coins}` : ""}
                {(serverUser.diamonds ?? 0) > 0 ? ` · 💎${serverUser.diamonds}` : ""}
              </i>
            </span>
          </button>

          {userboxOpen && (
            <div className="ref-userbox">
              <div className="ref-userbox-actions">
                <button
                  type="button"
                  onClick={() => { setUserboxOpen(false); setSettingsOpen(true) }}
                >
                  <Settings className="ref-userbox-icon" />
                  <span className="ref-userbox-label">个人设置</span>
                </button>
                <Link href="/home/membership" onClick={() => setUserboxOpen(false)}>
                  <Crown className="ref-userbox-icon" />
                  <span className="ref-userbox-label">VIP会员权益</span>
                </Link>
                <button
                  type="button"
                  onClick={() => { setUserboxOpen(false); setCoinRulesOpen(true) }}
                >
                  <span className="ref-userbox-icon" style={{ textAlign: "center", lineHeight: "16px" }}>🪙</span>
                  <span className="ref-userbox-label">金币与钻石</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setUserboxOpen(false); setFeedbackOpen(true) }}
                >
                  <MessageSquarePlus className="ref-userbox-icon" />
                  <span className="ref-userbox-label">问题反馈</span>
                </button>
                <button type="button" className="is-danger" onClick={handleLogout}>
                  <LogOut className="ref-userbox-icon" />
                  <span className="ref-userbox-label">退出登录</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </aside>

      <GlobalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialGoal={serverUser?.check_in_goal ?? 50}
        onSaved={() => router.refresh()}
      />
      <CoinRulesModal open={coinRulesOpen} onClose={() => setCoinRulesOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  )
}
