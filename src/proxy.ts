import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sessions, users } from "@/lib/db/schema"
import { and, eq, gt } from "drizzle-orm"

function getAdminPhones(): string[] {
  if (process.env.NODE_ENV === "development") {
    return ["16634482010"]
  }
  const raw = process.env.ADMIN_PHONES
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

async function getSessionUser(request: NextRequest) {
  if (!db) return null
  const sessionId = request.cookies.get("typenow_session")?.value
  if (!sessionId) return null

  const [row] = await db
    .select({ userId: sessions.userId, role: users.role, phone: users.phone })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1)

  return row ?? null
}

function isWechatCallback(pathname: string): boolean {
  return pathname.startsWith("/api/auth/wechat/callback") ||
    pathname.startsWith("/api/wechat/oa/event") ||
    pathname.startsWith("/api/payment/notify")
}

function isAdmin(user: { role: string | null; phone: string | null } | null) {
  if (!user) return false
  return user.role === "admin" || (user.phone != null && getAdminPhones().includes(user.phone))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Log API requests
  if (pathname.startsWith("/api/")) {
    console.log(`[API] → ${request.method} ${pathname}${request.nextUrl.search || ""}`)
  }

  // CSRF defense-in-depth: check Origin/Referer on critical mutation endpoints.
  // Skip server-to-server endpoints (WeChat callbacks, payment notify).
  const CRITICAL_MUTATIONS = ["/api/payment/", "/api/partner/withdraw", "/api/subscription/cancel"]
  const isCriticalMutation = CRITICAL_MUTATIONS.some((p) => pathname.startsWith(p))
  if (isCriticalMutation && !["GET", "HEAD"].includes(request.method)) {
    if (!isWechatCallback(pathname)) {
      const siteOrigin = process.env.SITE_URL?.replace(/\/$/, "") ?? request.nextUrl.origin
      const origin = request.headers.get("origin")
      const referer = request.headers.get("referer")
      if (origin && origin !== siteOrigin) {
        return new NextResponse("Invalid origin", { status: 403 })
      }
      if (!origin && referer && !referer.startsWith(siteOrigin)) {
        return new NextResponse("Invalid referer", { status: 403 })
      }
    }
  }

  // Dev mode: allow all
  if (process.env.NODE_ENV === "development") return NextResponse.next()

  const protectedPaths = ["/home", "/practice", "/profile", "/strengthen", "/share"]
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p))
  const isAdminRoute = pathname.startsWith("/admin") && pathname !== "/admin/login"

  if (!isProtected && !isAdminRoute) return NextResponse.next()

  const sessionUser = await getSessionUser(request)

  if (isProtected && !sessionUser) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (isAdminRoute) {
    if (!sessionUser) return NextResponse.redirect(new URL("/login", request.url))
    if (!isAdmin(sessionUser)) return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
