import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/user"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ user: null })

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      is_pro: !!user.isPro,
      level: user.level,
    },
  })
}
