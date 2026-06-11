import { getCurrentUser } from "@/lib/auth/user"
import { NextResponse } from "next/server"

function getAdminPhones(): string[] {
  // In dev, allow the hardcoded phone as fallback
  if (process.env.NODE_ENV === "development") {
    return ["16634482010"]
  }
  const raw = process.env.ADMIN_PHONES
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

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
  const isAdmin = user.role === "admin" || (user.phone != null && getAdminPhones().includes(user.phone))
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return { userId: user.id }
}
