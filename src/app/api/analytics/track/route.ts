import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"

export async function POST(request: Request) {
  try {
    const { event, properties, pageUrl, sessionId } = await request.json()
    if (!event) return NextResponse.json({ error: "Missing event" }, { status: 400 })

    if (!db) return NextResponse.json({ ok: true })

    const session = await getSession().catch(() => null)

    await db.insert(analyticsEvents).values({
      eventType: event,
      userId: session?.userId || null,
      properties: properties || {},
      pageUrl: pageUrl || "",
      sessionId: sessionId || "",
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
