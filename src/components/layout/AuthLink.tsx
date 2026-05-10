"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"

interface AuthLinkProps {
  loggedInHref?: string
  loggedOutHref?: string
  hideIfLoggedIn?: boolean
  className: string
  children: React.ReactNode
  loggedInChildren?: React.ReactNode
}

export function AuthLink({
  loggedInHref = "/home",
  loggedOutHref = "/login",
  hideIfLoggedIn = false,
  className,
  children,
  loggedInChildren,
}: AuthLinkProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const supabase = createClient()
    if (!supabase) {
      setIsLoggedIn(false)
      return
    }

    supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } }) => {
      setIsLoggedIn(!!data.user)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((
      _event: string,
      session: { user: Record<string, unknown> } | null,
    ) => {
      setIsLoggedIn(!!session?.user)
    })
    return () => subscription?.unsubscribe()
  }, [])

  // Prevent hydration mismatch
  if (!mounted) return null

  if (hideIfLoggedIn && isLoggedIn) return null

  const href = isLoggedIn ? loggedInHref : loggedOutHref

  return (
    <Link href={href} className={className}>
      {isLoggedIn && loggedInChildren ? loggedInChildren : children}
    </Link>
  )
}
