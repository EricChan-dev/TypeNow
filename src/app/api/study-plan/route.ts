import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { courses, studyPlanWords, studyPlans } from "@/lib/db/schema"
import { and, eq, isNull } from "drizzle-orm"
import { isDuplicateKeyError } from "@/lib/db/duplicate-key"

/** 当前用户的学习计划（无则 plan 为 null —— 页面据此决定显示选课还是概览）。 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const [row] = await db
    .select({
      id: studyPlans.id,
      courseId: studyPlans.courseId,
      courseTitle: courses.title,
      createdAt: studyPlans.createdAt,
    })
    .from(studyPlans)
    .leftJoin(courses, eq(courses.id, studyPlans.courseId))
    .where(eq(studyPlans.userId, session.userId))
    .limit(1)

  return NextResponse.json({ plan: row ?? null })
}

/** 创建计划。第一期一个用户一份：重复创建返回 409，让前端提示先删除。 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json().catch(() => ({})) as { courseId?: string }
  const courseId = (body.courseId ?? "").trim()
  if (!courseId || courseId.length > 36) {
    return NextResponse.json({ error: "invalid_course" }, { status: 400 })
  }

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.isPublished, 1), isNull(courses.deletedAt)))
    .limit(1)
  if (!course) return NextResponse.json({ error: "course_not_found" }, { status: 404 })

  try {
    await db.insert(studyPlans).values({ userId: session.userId, courseId })
    // id 由 MySQL UUID() 生成、insert 拿不回来；客户端拿 ok 后自会重拉概览。
    return NextResponse.json({ ok: true })
  } catch (err) {
    // uk_study_plan_user 撞唯一键 = 已有计划（1062 是 MySQL duplicate entry）。
    // drizzle 会把驱动错误包一层 DrizzleQueryError，必须走 isDuplicateKeyError 看 cause。
    if (isDuplicateKeyError(err)) {
      return NextResponse.json({ error: "plan_exists" }, { status: 409 })
    }
    throw err
  }
}

/** 删除计划（硬删，词进度一起删）。幂等：没有计划也返回 ok。 */
export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const [plan] = await db
    .select({ id: studyPlans.id })
    .from(studyPlans)
    .where(eq(studyPlans.userId, session.userId))
    .limit(1)
  if (plan) {
    await db.delete(studyPlanWords).where(eq(studyPlanWords.planId, plan.id))
    await db.delete(studyPlans).where(eq(studyPlans.id, plan.id))
  }
  return NextResponse.json({ ok: true })
}
