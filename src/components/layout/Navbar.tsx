"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BookOpen, GraduationCap, Menu, X, User, Settings, Crown, LogOut } from "lucide-react"
import { signOutAction } from "@/app/actions/auth"
import { cn } from "@/lib/utils"
import { UserActions } from "@/components/layout/UserActions"

const navLinks = [
  { href: "#hero", label: "首页", section: "hero" },
  { href: "#features", label: "功能", section: "features" },
  { href: "#pricing", label: "定价", section: "pricing" },
  { href: "#faq", label: "常见问题", section: "faq" },
]

interface UserProfile {
  name: string | null
  avatar: string | null
  is_pro: boolean
  level: number
}

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(({ user: u }) => { setUser(u); setAuthLoading(false) })
      .catch(() => setAuthLoading(false))
  }, [])

  async function handleLogout() {
    setUser(null)
    await signOutAction()
    router.push("/")
    router.refresh()
  }

  const scrollToSection = useCallback((sectionId: string) => {
    if (pathname === "/") {
      if (sectionId === "hero") {
        window.scrollTo({ top: 0, behavior: "smooth" })
      } else {
        const el = document.getElementById(sectionId)
        if (el) el.scrollIntoView({ behavior: "smooth" })
      }
    } else {
      router.push(`/?scroll=${sectionId}`)
    }
  }, [pathname, router])

  const isLoggedIn = !!user

  return (
    <header className="w-full border-b border-border bg-background">
      <div className="flex h-[72px] items-center justify-between px-5 xl:px-20">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <BookOpen className="h-6 w-6 text-accent" />
          <span className="text-xl font-bold text-accent">TypeNow·码上英语</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-8">
          {navLinks.map((link) => (
            <button
              key={link.section}
              onClick={() => scrollToSection(link.section)}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </button>
          ))}
          {isLoggedIn && (
            <Link
              href="/home"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 transition-colors"
            >
              <GraduationCap className="h-4 w-4" />
              学习中心
            </Link>
          )}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          <UserActions variant="public" />
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="lg:hidden p-1.5 text-muted-foreground hover:text-foreground" aria-label="菜单">
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-border bg-background px-5 py-4 space-y-3">
          {navLinks.map((link) => (
            <button key={link.section} onClick={() => { scrollToSection(link.section); setMobileMenuOpen(false) }}
              className="block text-sm text-muted-foreground py-1.5 w-full text-left">{link.label}</button>
          ))}
          {authLoading ? (
            <div className="py-2 text-sm text-muted-foreground">加载中...</div>
          ) : isLoggedIn ? (
            <>
              <Link href="/home" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 text-sm text-foreground py-1.5"><User className="h-4 w-4" /> 个人主页</Link>
              <Link href="/home/settings" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 text-sm text-foreground py-1.5"><Settings className="h-4 w-4" /> 设置</Link>
              {!user.is_pro && <Link href="/pricing" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 text-sm text-foreground py-1.5"><Crown className="h-4 w-4 text-amber-500" /> 升级会员</Link>}
              <div className="pt-2 border-t border-border">
                <div className="flex items-center gap-3 py-2">
                  <div className={cn("flex items-center justify-center h-8 w-8 rounded-full text-xs font-bold", user.avatar ? "" : "bg-accent text-white")}>{(user.name || "U")[0].toUpperCase()}</div>
                  <div><p className="text-sm font-medium text-foreground">{user.name || "用户"}</p><p className="text-xs text-muted-foreground">Lv.{user.level} · {user.is_pro ? "PRO 会员" : "普通会员"}</p></div>
                </div>
                <button onClick={() => { handleLogout(); setMobileMenuOpen(false) }} className="flex items-center gap-2 text-sm text-muted-foreground py-1.5 w-full"><LogOut className="h-4 w-4" /> 退出登录</button>
              </div>
            </>
          ) : (
            <div className="pt-2">
              <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="block text-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">登录</Link>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
