// 学习计划选课列表：已发布未软删课程，按学习人数排序。
// 第一期取前 100 供客户端搜索过滤 —— 词表类课程全部在学习人数头部，够用；
// 以后做全量搜索时再换成 /api/courses 的分页口径，不要在这里悄悄加 LIKE。
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { and, desc, eq, isNull } from "drizzle-orm"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const rows = await db
    .select({ id: courses.id, title: courses.title, learnerCount: courses.learnerCount })
    .from(courses)
    .where(and(eq(courses.isPublished, 1), isNull(courses.deletedAt)))
    .orderBy(desc(courses.learnerCount))
    .limit(100)

  return NextResponse.json({ items: rows })
}
