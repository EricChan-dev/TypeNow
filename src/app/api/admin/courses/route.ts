import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { aliveCourse, deletedCourse } from "@/lib/soft-delete"
import { deletedCondition, deletedScope } from "@/lib/soft-delete-view"
import { courses } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { logAdminAction } from "@/lib/admin-audit"
import { parsePagination } from "@/lib/pagination"
import { desc, eq, or, like, sql, type SQL, and } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)

  // 删除视图：默认只看未删除的（normal），deleted=1 只看回收站，deleted=all 全部。
  // 恢复入口就在"已删除"视图里，所以必须能查得到它们。
  const deletedView = deletedScope(searchParams.get("deleted"))
  const conds: SQL[] = [deletedCondition(deletedView, aliveCourse, deletedCourse)]
  if (q) {
    const matched = or(like(courses.title, `%${q}%`), like(courses.sourceName, `%${q}%`))
    if (matched) conds.push(matched)
  }
  const where: SQL | undefined = and(...conds)

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(courses)
      .where(where)
      .orderBy(desc(courses.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(courses).where(where),
  ])

  return NextResponse.json({ data: rows, total })
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }) }
    const { title, description, coverUrl, source, sourceName, sourceAvatar, categoryKey, subCategoryKey, isPublished } = body
    const id = randomUUID()
    await db.insert(courses).values({ id, title, description, coverUrl, source, sourceName, sourceAvatar, categoryKey, subCategoryKey, isPublished, createdBy: auth.userId })
    const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1)
    // 审计写在业务成功之后：被守卫拒绝或写失败的请求不该留痕（见 lib/admin-audit 文件头）
    await logAdminAction(auth, {
      action: "create",
      targetType: "course",
      targetId: id,
      targetLabel: title,
      detail: { title, source, sourceName, categoryKey, subCategoryKey, isPublished },
    }, request)
    return NextResponse.json({ data: row }, { status: 201 })
  } catch (e) {
    console.error("[admin/courses POST]", e)
    return NextResponse.json({ error: "创建课程失败" }, { status: 500 })
  }
}
