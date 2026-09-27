import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { aliveLesson, deletedLesson } from "@/lib/soft-delete"
import { deletedCondition, deletedScope } from "@/lib/soft-delete-view"
import { courses, lessons } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { logAdminAction } from "@/lib/admin-audit"
import { parsePagination } from "@/lib/pagination"
import { and, eq, or, like, sql, getTableColumns, type SQL } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const courseId = searchParams.get("courseId")
  // 课时按课内顺序排，保持 asc(sortOrder)；只收敛分页参数。
  const { pageSize, offset } = parsePagination(searchParams, 50)

  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)

  const deletedView = deletedScope(searchParams.get("deleted"))
  const conds: SQL[] = [deletedCondition(deletedView, aliveLesson, deletedLesson)]
  if (courseId) conds.push(eq(lessons.courseId, courseId))
  if (q) conds.push(or(like(lessons.title, `%${q}%`), like(lessons.summary, `%${q}%`))!)
  const where: SQL | undefined =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds)

  const [rows, [{ total }]] = await Promise.all([
    // LEFT JOIN 出课程标题：列表里显示原始 courseId 等于没告诉使用者这是哪门课
    // （16,891 条课时不可能靠 UUID 辨认）。用 LEFT 而不是 INNER：
    // 课程若被硬删过（历史数据）课时不该跟着从列表里消失。
    db
      .select({ ...getTableColumns(lessons), courseTitle: courses.title })
      .from(lessons)
      .leftJoin(courses, eq(lessons.courseId, courses.id))
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(lessons.sortOrder),
    db.select({ total: sql<number>`count(*)` }).from(lessons).where(where),
  ])

  return NextResponse.json({ data: rows, total })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json()
  const { courseId, title, summary, sortOrder } = body
  const id = randomUUID()
  await db.insert(lessons).values({ id, courseId, title, summary, sortOrder })
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  await logAdminAction(auth, {
    action: "create",
    targetType: "lesson",
    targetId: id,
    targetLabel: title,
    // courseId 一定要记：课时的归属是"内容跑到别的课去了"这类事故的唯一线索
    detail: { courseId, title, sortOrder },
  }, request)
  return NextResponse.json({ data: row }, { status: 201 })
}
