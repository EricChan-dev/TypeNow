"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

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
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setIsLoggedIn(!!data?.user))
      .catch(() => setIsLoggedIn(false))
  }, [])

  if (!mounted) return null
  if (hideIfLoggedIn && isLoggedIn) return null

  const href = isLoggedIn ? loggedInHref : loggedOutHref

  return (
    <Link href={href} className={className}>
      {isLoggedIn && loggedInChildren ? loggedInChildren : children}
    </Link>
  )
}
