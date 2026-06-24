import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { userNotes } from "@/lib/db/schema"
import { and, desc, eq, sql } from "drizzle-orm"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? "1"))
    const size = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("size") ?? "50")))
    const offset = (page - 1) * size

    const rows = await db.select().from(userNotes).where(eq(userNotes.userId, session.userId)).orderBy(desc(userNotes.updatedAt)).limit(size).offset(offset)
    const [{ total }] = await db.select({ total: sql<number>`COUNT(*)` }).from(userNotes).where(eq(userNotes.userId, session.userId))

    return NextResponse.json({ items: rows, total: Number(total ?? 0), page, size })
  } catch (e) {
    console.error("[notes GET]", e)
    return NextResponse.json({ error: "加载笔记失败" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const body = await request.json().catch(() => ({})) as { title?: string; content?: string }
    const title = (body.title ?? "").slice(0, 200)
    const content = body.content ?? ""
    if (!content && !title) return NextResponse.json({ error: "empty_note" }, { status: 400 })

    const id = crypto.randomUUID()
    await db.insert(userNotes).values({ id, userId: session.userId, title: title || "未命名笔记", content })
    const [row] = await db.select().from(userNotes).where(eq(userNotes.id, id)).limit(1)

    return NextResponse.json({ note: row })
  } catch (e) {
    console.error("[notes POST]", e)
    return NextResponse.json({ error: "创建笔记失败" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const body = await request.json().catch(() => ({})) as { id?: string; title?: string; content?: string }
    if (!body.id) return NextResponse.json({ error: "missing_id" }, { status: 400 })

    const updates: { title?: string; content?: string; updatedAt: Date } = { updatedAt: new Date() }
    if (typeof body.title === "string") updates.title = body.title.slice(0, 200) || "未命名笔记"
    if (typeof body.content === "string") updates.content = body.content

    await db.update(userNotes).set(updates).where(and(eq(userNotes.id, body.id), eq(userNotes.userId, session.userId)))
    const [row] = await db.select().from(userNotes).where(and(eq(userNotes.id, body.id), eq(userNotes.userId, session.userId))).limit(1)

    return NextResponse.json({ note: row })
  } catch (e) {
    console.error("[notes PUT]", e)
    return NextResponse.json({ error: "更新笔记失败" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 })

    await db.delete(userNotes).where(and(eq(userNotes.id, id), eq(userNotes.userId, session.userId)))
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[notes DELETE]", e)
    return NextResponse.json({ error: "删除笔记失败" }, { status: 500 })
  }
}
