"use client"

import Link from "next/link"
import { BookOpen } from "lucide-react"
import { UserActions, type ServerUser } from "@/components/layout/UserActions"

export function HomeTopbar({ serverUser }: { serverUser: ServerUser | null }) {
  return (
    <header className="h-[64px] shrink-0 border-b border-border bg-card flex items-center justify-between px-6">
      {/* Left: Logo + Brand */}
      <Link href="/home" className="flex items-center gap-2.5 shrink-0">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-accent">
          <BookOpen className="h-5 w-5 text-white" />
        </div>
        <span className="text-base font-bold text-foreground">
          TypeNow·码上英语
        </span>
      </Link>

      {/* Right: Theme toggle + User */}
      <UserActions serverUser={serverUser} variant="home" />
    </header>
  )
}
