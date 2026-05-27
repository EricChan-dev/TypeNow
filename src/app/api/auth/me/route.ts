import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/user"

const ADMIN_PHONES = ["16634482010"]

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ user: null })

  const isAdmin = user.role === "admin" || (user.phone != null && ADMIN_PHONES.includes(user.phone))

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      is_pro: !!user.isPro,
      is_partner: !!user.isPartner,
      level: user.level,
      role: isAdmin ? "admin" : (user.role ?? "user"),
    },
  })
}
