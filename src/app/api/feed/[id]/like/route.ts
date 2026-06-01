import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { postLikes, posts } from "@/lib/db/schema"
import { eq, and, sql } from "drizzle-orm"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const { id: postId } = await params

  const [existing] = await db
    .select({ id: postLikes.id })
    .from(postLikes)
    .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, session.userId)))
    .limit(1)

  if (existing) {
    await db.delete(postLikes).where(eq(postLikes.id, existing.id))
    await db.update(posts)
      .set({ likeCount: sql`GREATEST(0, ${posts.likeCount} - 1)` })
      .where(eq(posts.id, postId))
    return NextResponse.json({ liked: false })
  } else {
    await db.insert(postLikes).values({ postId, userId: session.userId })
    await db.update(posts)
      .set({ likeCount: sql`${posts.likeCount} + 1` })
      .where(eq(posts.id, postId))
    return NextResponse.json({ liked: true })
  }
}
