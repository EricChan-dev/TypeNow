"use client"

import Link from "next/link"
import Image from "next/image"
import { UserActions, type ServerUser } from "@/components/layout/UserActions"
import { BRAND } from "@/lib/brand"

export function HomeTopbar({ serverUser }: { serverUser: ServerUser | null }) {
  return (
    <header className="h-[64px] shrink-0 border-b border-border bg-card flex items-center justify-between px-6">
      {/* Left: Logo + Brand */}
      <Link href="/home" className="flex items-center gap-2.5 shrink-0">
        <Image src="/logo.svg" alt={BRAND.nameZh} width={30} height={30} />
        <span className="font-brand text-base text-foreground">
          {BRAND.lockup}
        </span>
      </Link>

      {/* Right: User */}
      <UserActions serverUser={serverUser} variant="home" />
    </header>
  )
}
