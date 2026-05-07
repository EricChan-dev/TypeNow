"use client"

import { usePathname } from "next/navigation"
import { HomeTopbar } from "@/components/home/HomeTopbar"
import type { ServerUser } from "@/components/layout/UserActions"

export function ConditionalTopbar({ serverUser }: { serverUser: ServerUser | null }) {
  const pathname = usePathname()
  if (pathname.startsWith("/home/learn/")) return null
  return <HomeTopbar serverUser={serverUser} />
}
