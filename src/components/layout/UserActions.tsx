"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { Moon, Sun, User, Settings, Crown, LogOut, ChevronRight } from "lucide-react"
import { trackThemeToggle } from "@/lib/analytics"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

interface UserProfile {
  name: string | null
  avatar: string | null
  is_pro: boolean
  level: number
}

export interface ServerUser {
  name: string | null
  avatar: string | null
  email: string | null
  is_pro: boolean
  level: number
}

interface UserActionsProps {
  serverUser?: ServerUser | null
  variant?: "public" | "home"
}

export function UserActions({ serverUser, variant = "public" }: UserActionsProps) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState<UserProfile | null>(() => {
    if (serverUser) {
      return {
        name: serverUser.name,
        avatar: serverUser.avatar,
        is_pro: serverUser.is_pro,
        level: serverUser.level,
      }
    }
    return null
  })
  const [loading, setLoading] = useState(!serverUser)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const supabase = createClient()
    if (!supabase) {
      setLoading(false)
      return
    }

    let cancelled = false
    async function refresh() {
      if (!supabase) return
      try {
        const { data: { user: authUser }, error } = await supabase.auth.getUser()
        if (cancelled) return
        if (error || !authUser) {
          if (!cancelled) {
            if (serverUser) {
              setUser({ name: serverUser.name, avatar: serverUser.avatar, is_pro: serverUser.is_pro, level: serverUser.level })
            } else {
              setUser(null)
            }
            setLoading(false)
          }
          return
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("name, avatar, is_pro, level")
          .maybeSingle()

        if (!cancelled) {
          setUser({
            name: profile?.name || serverUser?.name || null,
            avatar: profile?.avatar || serverUser?.avatar || null,
            is_pro: profile?.is_pro || serverUser?.is_pro || false,
            level: profile?.level || serverUser?.level || 1,
          })
        }
      } catch {
        if (!cancelled) {
          if (serverUser) {
            setUser({ name: serverUser.name, avatar: serverUser.avatar, is_pro: serverUser.is_pro, level: serverUser.level })
          } else {
            setUser(null)
          }
        }
      }
      if (!cancelled) setLoading(false)
    }

    refresh()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => refresh())
    return () => { cancelled = true; subscription?.unsubscribe() }
  }, [serverUser])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function handleLogout() {
    const supabase = createClient()
    if (supabase) await supabase.auth.signOut()
    setUser(null)
    setDropdownOpen(false)
    router.push("/")
  }

  const isLoggedIn = !!user

  return (
    <div className="flex items-center gap-3">
      {/* Theme toggle pill */}
      <div className="hidden sm:flex items-center relative rounded-[24px] border border-border bg-muted p-[3px]">
        <div
          className={cn(
            "absolute top-[3px] h-[28px] w-[56px] rounded-[20px] transition-all duration-300 ease-out",
            !mounted && "left-[3px] bg-background",
            mounted && theme === "dark" && "left-[3px] bg-background",
            mounted && theme === "light" && "left-[59px] bg-card shadow-sm"
          )}
        />
        <button
          onClick={() => { setTheme("dark"); trackThemeToggle("dark") }}
          className={cn(
            "relative z-10 flex items-center justify-center gap-1 rounded-[20px] w-[56px] py-[5px] text-[13px] font-medium transition-colors duration-300",
            mounted && theme === "dark" ? "text-foreground" : "text-muted-foreground"
          )}
          aria-label="深色模式"
        >
          <Moon className="h-3.5 w-3.5" />深色
        </button>
        <button
          onClick={() => { setTheme("light"); trackThemeToggle("light") }}
          className={cn(
            "relative z-10 flex items-center justify-center gap-1 rounded-[20px] w-[56px] py-[5px] text-[13px] font-medium transition-colors duration-300",
            mounted && theme === "light" ? "text-card-foreground" : mounted && theme === "dark" ? "text-white/80" : "text-muted-foreground"
          )}
          aria-label="浅色模式"
        >
          <Sun className="h-3.5 w-3.5" />浅色
        </button>
      </div>

      {/* Auth section */}
      {loading ? (
        <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
      ) : isLoggedIn ? (
        <>
          {variant === "home" && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                Lv.{user.level}
              </span>
              {user.is_pro && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  PRO
                </span>
              )}
            </div>
          )}

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={cn(
                "flex items-center justify-center h-9 w-9 rounded-full text-sm font-bold shrink-0 transition-opacity hover:opacity-80",
                user.avatar ? "" : "bg-accent text-white"
              )}
            >
              {user.avatar ? (
                <img src={user.avatar} alt={user.name || "用户"} className="h-9 w-9 rounded-full object-cover" />
              ) : (
                (user.name || "U")[0].toUpperCase()
              )}
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-card border border-border shadow-xl z-50 py-2">
                <div className="px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex items-center justify-center h-10 w-10 rounded-full text-sm font-bold shrink-0", user.avatar ? "" : "bg-accent text-white")}>
                      {user.avatar ? <img src={user.avatar} alt="" className="h-10 w-10 rounded-full object-cover" /> : (user.name || "U")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{user.name || "用户"}</p>
                      <p className="text-xs text-muted-foreground">
                        Lv.{user.level}
                        {user.is_pro
                          ? <span className="ml-1.5 inline-flex items-center rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">PRO</span>
                          : variant === "public" && <span className="ml-1.5 text-[11px]">普通会员</span>
                        }
                      </p>
                    </div>
                  </div>
                </div>
                <div className="py-1">
                  <Link href="/home" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors">
                    <span className="flex items-center gap-3"><User className="h-4 w-4 text-muted-foreground" />个人主页</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link href="/home/settings" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors">
                    <span className="flex items-center gap-3"><Settings className="h-4 w-4 text-muted-foreground" />设置</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  {!user.is_pro && (
                    <Link href="/pricing" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors">
                      <span className="flex items-center gap-3"><Crown className="h-4 w-4 text-amber-500" />升级会员</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  )}
                </div>
                <div className="border-t border-border pt-1">
                  <button onClick={handleLogout} className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
                    <LogOut className="h-4 w-4" />退出登录
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : variant === "home" ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
            Lv.1
          </span>
          <div className="flex items-center justify-center h-9 w-9 rounded-full bg-accent text-white text-sm font-bold">
            {serverUser?.name?.[0]?.toUpperCase() || "U"}
          </div>
        </div>
      ) : (
        <Link href="/login" className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
          登录
        </Link>
      )}
    </div>
  )
}
