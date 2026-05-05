"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { BookOpen, Moon, Sun, Menu, X } from "lucide-react"

const navLinks = [
  { href: "/", label: "首页" },
  { href: "/learn-path", label: "学习路径" },
  { href: "/pricing", label: "定价" },
  { href: "/help", label: "帮助中心" },
]

export function Navbar() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="w-full border-b border-border bg-background">
      <div className="flex h-[72px] items-center justify-between px-5 xl:px-20">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <BookOpen className="h-6 w-6 text-accent" />
          <span className="text-xl font-bold text-accent">
            TypeNow·码上英语
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-5">
          {/* Theme toggle pill */}
          <div className="hidden sm:flex items-center rounded-[24px] border border-border bg-muted p-[3px]">
            <button
              onClick={() => setTheme("dark")}
              className={`flex items-center gap-1 rounded-[20px] px-2.5 py-[5px] text-[13px] font-medium transition-colors ${
                theme === "dark"
                  ? "bg-background text-foreground"
                  : "text-muted-foreground"
              }`}
              aria-label="深色模式"
            >
              <Moon className="h-3.5 w-3.5" />
              深色
            </button>
            <button
              onClick={() => setTheme("light")}
              className={`flex items-center gap-1 rounded-[20px] px-2.5 py-[5px] text-[13px] font-medium transition-colors ${
                theme === "light"
                  ? "bg-card text-card-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
              aria-label="浅色模式"
            >
              <Sun className="h-3.5 w-3.5" />
              浅色
            </button>
          </div>

          {/* Desktop auth */}
          <div className="hidden lg:flex items-center gap-5">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              免费开始
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              登录
            </Link>
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="菜单"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-border bg-background px-5 py-4 space-y-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm text-muted-foreground py-1.5"
            >
              {link.label}
            </Link>
          ))}
          <div className="flex gap-3 pt-2">
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="flex-1 text-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground"
            >
              免费开始
            </Link>
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="flex-1 text-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              登录
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
