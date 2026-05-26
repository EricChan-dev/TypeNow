import { getCurrentUser } from "@/lib/auth/user"
import { NextResponse } from "next/server"

export async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  const user = await getCurrentUser()
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return { userId: user.id }
}
