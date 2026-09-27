import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { userAcquiredCourses } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq } from "drizzle-orm"

/**
 * 用户「获取」过的课程集合。
 *
 * 为什么放到服务端（这是一个真实 bug 的修复）：这份状态原先只存在浏览器
 * localStorage，而"我的课程"列表是按 `已获取 ∪ 已练习过` 算的（已练习来自服务端）。
 * 清一次浏览器数据后，已获取记录消失、但课程因"练过"仍在列表里 ——
 * 于是**列表里有、点进去却显示「获取课程」**。服务端存一份就没有这个矛盾了，
 * 顺带还解决了换设备丢失的问题。
 *
 * 只返回 courseId 列表：前端只需要判断"在不在里面"，不需要时间戳等细节。
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const rows = await db
    .select({ courseId: userAcquiredCourses.courseId })
    .from(userAcquiredCourses)
    .where(eq(userAcquiredCourses.userId, session.userId))

  return NextResponse.json({ ids: rows.map((r) => r.courseId) })
}

/**
 * 获取一门课程。幂等：重复获取同一门课不会报错也不会产生第二行
 * （唯一键 + onDuplicateKeyUpdate，配合前端"重复点击/多标签页"这类真实场景）。
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const courseId = typeof body?.courseId === "string" ? body.courseId.trim().slice(0, 36) : ""
  if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 })

  await db
    .insert(userAcquiredCourses)
    .values({ id: randomUUID(), userId: session.userId, courseId })
    // 已经获取过就什么都不做：唯一键兜住并发/重复提交
    .onDuplicateKeyUpdate({ set: { courseId } })

  return NextResponse.json({ success: true, courseId })
}
