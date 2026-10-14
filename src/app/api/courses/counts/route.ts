import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { aliveCourse } from "@/lib/soft-delete"
import { eq, and, sql } from "drizzle-orm"
import { COURSE_CATEGORIES } from "@/types/course"
import { buildStoreFacets, type StoreFacets } from "@/lib/store-facets"

/**
 * 课程广场的筛选面：总课程数 + 每个分类 / 子分类的课程数。
 *
 * ── 为什么单独一个接口，而不是塞进 /api/courses/list ────────────────────────
 *
 * 列表接口带 categoryKey / subCategoryKey / search / 分页，每次筛选都会重算 total；
 * 但标签上的数字**不跟着筛选变**（理由见 lib/store-facets 顶部注释）。两者生命周期
 * 不同：一个是「随交互变的列表」，一个是「进页面取一次就固定的标签规模」。
 * 塞在一起会让广场每次翻页都多带一份恒定数据，也容易让人误以为数字该跟着变。
 *
 * ── 口径 ────────────────────────────────────────────────────────────────────
 *
 * 与列表接口完全一致：`is_published = 1` + 未软删除。少任何一条，标签上的数字
 * 就会比点进去看到的课程多 —— 那正是「数字对不上」类 bug 的来源。
 *
 * ── 为什么一次 GROUP BY 就够 ───────────────────────────────────────────────
 *
 * 课程表只有几百行，一次 `GROUP BY (category_key, sub_category_key)` 拿回几十行，
 * 聚合在 JS 里做（对照 /api/courses/textbook-facets 的同样取舍）。
 * 比每个标签发一条 count 少几十次往返，也不会出现「几个查询口径不一致」。
 */
export async function GET() {
  try {
    // 数据库没配时返回空壳而不是 500：广场页本身能渲染出「共 0 门」，
    // 不该因为一个装饰性数字把整页打挂。
    if (!db) {
      const empty = buildStoreFacets([], COURSE_CATEGORIES)
      return NextResponse.json(empty satisfies StoreFacets)
    }

    const rows = await db
      .select({
        categoryKey: courses.categoryKey,
        subCategoryKey: courses.subCategoryKey,
        count: sql<number>`count(*)`,
      })
      .from(courses)
      .where(and(eq(courses.isPublished, 1), aliveCourse))
      .groupBy(courses.categoryKey, courses.subCategoryKey)

    return NextResponse.json(
      buildStoreFacets(
        rows.map((r) => ({ ...r, count: Number(r.count) || 0 })),
        COURSE_CATEGORIES,
      ),
    )
  } catch (e) {
    console.error("[courses/counts]", e)
    return NextResponse.json({ error: "加载课程数量失败" }, { status: 500 })
  }
}
