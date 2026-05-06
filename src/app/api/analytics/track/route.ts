import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  try {
    const { event, properties, pageUrl, sessionId } = await request.json()

    if (!event) {
      return NextResponse.json({ error: "Missing event" }, { status: 400 })
    }

    const serviceClient = createServiceClient()
    if (!serviceClient) {
      // Silently succeed - analytics should never block
      return NextResponse.json({ ok: true })
    }

    // Try to get user from session, but don't require it
    const { createClient } = await import("@/lib/supabase/server")
    const supabase = await createClient()
    let userId: string | null = null

    if (supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      userId = session?.user?.id || null
    }

    await serviceClient.from("analytics_events").insert({
      event_type: event,
      user_id: userId,
      properties: properties || {},
      page_url: pageUrl || "",
      session_id: sessionId || "",
    })

    return NextResponse.json({ ok: true })
  } catch {
    // Silently fail
    return NextResponse.json({ ok: true })
  }
}
