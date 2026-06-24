import { getCurrentUser } from "@/lib/auth/user"
import { NextResponse } from "next/server"

function getAdminPhones(): string[] {
  // Always require explicit phone list; dev fallback requires opt-in via ADMIN_DEV_BYPASS
  const raw = process.env.ADMIN_PHONES
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

export async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  // Dev bypass: only when explicitly opted in — NOT auto-enabled by NODE_ENV
  if (process.env.NODE_ENV === "development" && process.env.ADMIN_DEV_BYPASS === "1") {
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
