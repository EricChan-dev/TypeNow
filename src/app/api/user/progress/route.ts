import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { userCourseProgress, courses } from "@/lib/db/schema"
import { eq, sql, and } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const rows = await db
    .select({
      courseId: userCourseProgress.courseId,
      lastStudiedAt: userCourseProgress.lastStudiedAt,
      sentenceCount: userCourseProgress.sentenceCount,
    })
    .from(userCourseProgress)
    .where(eq(userCourseProgress.userId, session.userId))
    .orderBy(sql`${userCourseProgress.lastStudiedAt} DESC`)

  return NextResponse.json({ data: rows })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  let body: { courseId?: string; sentenceCount?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { courseId, sentenceCount = 0 } = body
  if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 })

  const now = new Date()

  const [existing] = await db
    .select({ id: userCourseProgress.id })
    .from(userCourseProgress)
    .where(and(eq(userCourseProgress.userId, session.userId), eq(userCourseProgress.courseId, courseId)))
    .limit(1)

  const isFirstTime = !existing

  await db
    .insert(userCourseProgress)
    .values({
      userId: session.userId,
      courseId,
      lastStudiedAt: now,
      sentenceCount,
    })
    .onDuplicateKeyUpdate({
      set: {
        lastStudiedAt: now,
        sentenceCount: sql`GREATEST(${userCourseProgress.sentenceCount}, ${sentenceCount})`,
      },
    })

  if (isFirstTime) {
    await db
      .update(courses)
      .set({ learnerCount: sql`${courses.learnerCount} + 1` })
      .where(eq(courses.id, courseId))
  }

  return NextResponse.json({ success: true })
}
