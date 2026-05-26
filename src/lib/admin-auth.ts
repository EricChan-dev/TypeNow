import { getCurrentUser } from "@/lib/auth/user"
import { NextResponse } from "next/server"

const ADMIN_PHONES = ["16634482010"]

function isDevMode() {
  return process.env.NODE_ENV === "development"
}

export async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  // Dev mode: skip auth entirely, return a placeholder userId
  if (isDevMode()) {
    return { userId: "dev-admin" }
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const isAdmin = user.role === "admin" || (user.phone != null && ADMIN_PHONES.includes(user.phone))
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return { userId: user.id }
}
