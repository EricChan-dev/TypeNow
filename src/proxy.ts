import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sessions, users } from "@/lib/db/schema"
import { and, eq, gt } from "drizzle-orm"

const ADMIN_PHONES = ["16634482010"]

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

function isAdmin(user: { role: string | null; phone: string | null } | null) {
  if (!user) return false
  return user.role === "admin" || (user.phone != null && ADMIN_PHONES.includes(user.phone))
}

export async function proxy(request: NextRequest) {
  // Dev mode: allow all
  if (process.env.NODE_ENV === "development") return NextResponse.next()

  const { pathname } = request.nextUrl

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
