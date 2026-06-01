import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { posts, users } from "@/lib/db/schema"
import { eq, lt, desc, and } from "drizzle-orm"

export async function GET(request: Request) {
  if (!db) return NextResponse.json({ data: [], nextCursor: null })

  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get("cursor")
  const pageSize = 20

  const where = and(
    eq(posts.status, "published"),
    cursor ? lt(posts.createdAt, new Date(cursor)) : undefined
  )

  const rows = await db
    .select({
      id: posts.id,
      content: posts.content,
      likeCount: posts.likeCount,
      commentCount: posts.commentCount,
      createdAt: posts.createdAt,
      userId: posts.userId,
      userName: users.name,
      userAvatar: users.avatar,
    })
    .from(posts)
    .leftJoin(users, eq(posts.userId, users.id))
    .where(where)
    .orderBy(desc(posts.createdAt))
    .limit(pageSize + 1)

  const hasMore = rows.length > pageSize
  const data = rows.slice(0, pageSize)
  const nextCursor = hasMore ? data[data.length - 1]?.createdAt?.toISOString() ?? null : null

  return NextResponse.json({ data, nextCursor })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const { content } = await request.json()
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 })
  }
  if (content.length > 500) {
    return NextResponse.json({ error: "内容不能超过 500 字" }, { status: 400 })
  }

  await db.insert(posts).values({ userId: session.userId, content: content.trim() })
  return NextResponse.json({ success: true })
}
