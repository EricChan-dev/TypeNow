import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id: lessonId } = await params
  const { orderedIds } = await request.json() as { orderedIds: string[] }

  if (!Array.isArray(orderedIds)) {
    return NextResponse.json({ error: "orderedIds must be an array" }, { status: 400 })
  }

  await Promise.all(
    orderedIds.map((sentenceId, index) =>
      db!.update(sentences)
        .set({ sortOrder: index })
        .where(eq(sentences.id, sentenceId))
    )
  )

  return NextResponse.json({ data: { lessonId, count: orderedIds.length } })
}
