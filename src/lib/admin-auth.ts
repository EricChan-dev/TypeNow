import { getCurrentUser } from "@/lib/auth/user"
import { judgeAdmin } from "@/lib/admin-identity"
import { NextResponse } from "next/server"

/**
 * 所有 /api/admin/* 的统一守卫。
 *
 * 判定规则**不在这里** —— 它收敛在 lib/admin-identity，与 proxy.ts 和
 * /api/admin/whoami 共用同一份。此前这里自己写了一遍 role/phone 判定，
 * 而前端 authProvider 又写了第三份（只认 role），三份漂移的后果是
 * "仅凭 ADMIN_PHONES 的管理员被前端挡在后台外面"。
 */
export async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  // Dev bypass: only when explicitly opted in — NOT auto-enabled by NODE_ENV
  if (process.env.NODE_ENV === "development" && process.env.ADMIN_DEV_BYPASS === "1") {
    return { userId: "dev-admin" }
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!judgeAdmin({ role: user.role, phone: user.phone }).isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return { userId: user.id }
}
