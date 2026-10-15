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
  // isLoggedIn 初始为 false，即「未登录」。SSR 与客户端首次渲染都取这个值，
  // 二者一致，不会触发 hydration 失配。
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setIsLoggedIn(!!data?.user))
      .catch(() => setIsLoggedIn(false))
  }, [])

  // 首帧就按「未登录」渲染，而不是先 return null 等 /api/auth/me 回来。
  //
  // 原来这里是 `if (!mounted) return null`，会让按钮在服务端 HTML 里完全不存在，
  // 等接口回来后客户端再补上 —— 落地页那三个主 CTA（免费开始 / 免费开始学习 /
 // 立即免费体验）首屏先缺失再出现，整块布局跟着跳一次。基准实现用的是静态 <a>，
  // 没有这个问题。
  //
  // hideIfLoggedIn 只在**确认**已登录后才隐藏：isLoggedIn 为 false 时这个分支
  // 不会命中，所以「还没问过接口」与「确认未登录」表现一致，都是显示。
  if (hideIfLoggedIn && isLoggedIn) return null

  const href = isLoggedIn ? loggedInHref : loggedOutHref

  return (
    <Link href={href} className={className}>
      {isLoggedIn && loggedInChildren ? loggedInChildren : children}
    </Link>
  )
}
