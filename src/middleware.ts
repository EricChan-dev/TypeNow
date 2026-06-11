import { NextRequest, NextResponse } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith("/api/")) {
    const method = request.method
    const search = request.nextUrl.search || ""
    console.log(`[API] → ${method} ${pathname}${search}`)
  }

  return NextResponse.next()
}

export const config = {
  matcher: "/api/:path*",
}
