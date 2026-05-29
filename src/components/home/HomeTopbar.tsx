"use client"

import Link from "next/link"
import Image from "next/image"
import { UserActions, type ServerUser } from "@/components/layout/UserActions"

export function HomeTopbar({ serverUser }: { serverUser: ServerUser | null }) {
  return (
    <header className="h-[64px] shrink-0 border-b border-border bg-card flex items-center justify-between px-6">
      {/* Left: Logo + Brand */}
      <Link href="/home" className="flex items-center gap-2.5 shrink-0">
        <Image src="/logo_w.svg" alt="TypeNow" width={30} height={30} className="block [.light_&]:hidden" />
        <Image src="/logo.svg" alt="TypeNow" width={30} height={30} className="hidden [.light_&]:block" />
        <span className="text-base font-bold text-foreground">
          TypeNow·码上英语
        </span>
      </Link>

      {/* Right: Theme toggle + User */}
      <UserActions serverUser={serverUser} variant="home" />
    </header>
  )
}
