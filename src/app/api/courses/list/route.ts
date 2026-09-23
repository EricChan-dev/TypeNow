import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { eq, and, like, sql, desc } from "drizzle-orm"
import type { SortMode } from "@/types/course"

/** 把查询串转成整数；解析失败或非有限值一律回退默认，避免 NaN 进 SQL。 */
function toInt(raw: string | null, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/**
 * 转义 LIKE 通配符。
 * 此前 `?search=%` 会被当成「匹配任意标题」，等于把搜索框变成全表返回；
 * 用户输入里的 % 和 _ 必须按字面量处理。
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export async function GET(request: Request) {
  try {
    if (!db) return NextResponse.json({ data: [], total: 0 })

    const { searchParams } = new URL(request.url)
    // pageSize 必须有上限：之前可以传 100000 一次拖走整张课程表
    const page = Math.max(1, toInt(searchParams.get("current"), 1))
    const pageSize = Math.min(100, Math.max(1, toInt(searchParams.get("pageSize"), 20)))
    const offset = (page - 1) * pageSize
    const categoryKey = searchParams.get("categoryKey")
    const subCategoryKey = searchParams.get("subCategoryKey")
    const search = searchParams.get("search")?.trim()
    const sortMode = (searchParams.get("sortMode") ?? "latest") as SortMode

    const conditions = [eq(courses.isPublished, 1)]
    if (categoryKey && categoryKey !== "all") conditions.push(eq(courses.categoryKey, categoryKey))
    if (subCategoryKey) conditions.push(eq(courses.subCategoryKey, subCategoryKey))
    if (search) {
      conditions.push(like(courses.title, `%${escapeLike(search)}%`))
    }
    const where = and(...conditions)

    let orderBy
    switch (sortMode) {
      case "most_used": orderBy = desc(courses.usageCount); break
      case "name": orderBy = courses.title; break
      case "latest":
      default: orderBy = desc(courses.createdAt); break
    }

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(courses).where(where).limit(pageSize).offset(offset).orderBy(orderBy),
      db.select({ total: sql<number>`count(*)` }).from(courses).where(where),
    ])

    return NextResponse.json({ data: rows, total })
  } catch (e) {
    console.error("[courses/list]", e)
    return NextResponse.json({ error: "加载课程失败" }, { status: 500 })
  }
}
