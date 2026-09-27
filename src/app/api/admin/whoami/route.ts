import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { judgeAdmin } from "@/lib/admin-identity"
import { getCurrentUser } from "@/lib/auth/user"

/**
 * 「我是不是管理员」——前台 AuthGate 用这个接口判断，而不是自己去看 role。
 *
 * 为什么必须由服务端回答：这个判定此前在前端复制了一份"只认 role === 'admin'"，
 * 而 proxy 与 requireAdmin 还认 ADMIN_PHONES。于是仅凭手机号进去的管理员
 * 服务端全放行、前端却把他踢回登录页，而那个页面没有任何可用的登录入口 ——
 * 他彻底进不了后台。前端复制服务端规则，漂移只是时间问题。
 *
 * 响应刻意很小：只回"是不是、靠什么、你是谁"，不回任何用户资料。
 * 未登录时返回 200 + isAdmin:false（而不是 401）—— 这是**状态查询**，
 * 不是受保护资源，前端要能拿到"否"这个答案来做跳转。
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) {
    // requireAdmin 的 401 就是"不是管理员"。连同未登录一起归一成否定答案，
    // 前端不必区分两种失败（对它的行为是一样的：去登录页）
    return NextResponse.json({ isAdmin: false, userId: null, via: null })
  }

  // requireAdmin 在 dev 旁路下会返回 "dev-admin"，此时没有真实用户
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ isAdmin: true, userId: auth.userId, via: "dev-bypass" })

  const verdict = judgeAdmin({ role: user.role, phone: user.phone })
  return NextResponse.json({ isAdmin: verdict.isAdmin, userId: auth.userId, via: verdict.via })
}
