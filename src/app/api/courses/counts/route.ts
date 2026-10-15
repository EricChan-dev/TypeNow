import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { aliveCourse } from "@/lib/soft-delete"
import { eq, and, sql } from "drizzle-orm"
import { COURSE_CATEGORIES } from "@/types/course"
import { buildStoreFacets, type StoreFacets } from "@/lib/store-facets"
import { courseSearchCondition } from "@/lib/course-query"

/**
 * 课程广场的筛选面：总课程数 + 每个分类 / 子分类的课程数。
 *
 * ── 计数跟着搜索词走 ──────────────────────────────────────────────────────
 *
 * 传 `?search=` 时，各标签的数字变成「当前搜索词下各分类的命中数」。
 * 这样标签上的数字与点进去看到的列表始终是同一个口径 ——
 * 搜「雅思」时看到「应试考试 27」，点进去就该是 27 门。
 *
 * （早期版本是静态计数，理由是「数字跟着缩水会看不出分类真实规模」。
 *   但那个取舍的前提是数字只作装饰；一旦用户拿它导航，数字与实际结果
 *   不一致就成了误导。现在统一按当前搜索词算。）
 *
 * ── 为什么单独一个接口，而不是塞进 /api/courses/list ────────────────────────
 *
 * 列表接口要分页、要排序、要带 lessonCount 子查询；筛选面只需要几十行聚合结果。
 * 塞在一起会让每次翻页都多带一份和当前页无关的聚合，且两者的触发时机不同
 * （计数只在搜索词变化时重取，切分类 / 翻页都不需要）。
 *
 * ── 口径必须与列表逐字一致 ──────────────────────────────────────────────────
 *
 * `is_published = 1` + 未软删除 + 同一条标题匹配条件（共用
 * `lib/course-query.ts` 的 courseSearchCondition，绝不各写一份 LIKE 转义）。
 * 任何一处分叉，标签上的数字就会比点进去看到的课程多 —— 那正是最难自查的 bug。
 *
 * ── 为什么一次 GROUP BY 就够 ───────────────────────────────────────────────
 *
 * 课程表只有几百行，一次 `GROUP BY (category_key, sub_category_key)` 拿回几十行，
 * 聚合在 JS 里做（对照 /api/courses/textbook-facets 的同样取舍）。
 * 比每个标签发一条 count 少几十次往返，也不会出现「几个查询口径不一致」。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")

    // 数据库没配时返回空壳而不是 500：广场页本身能渲染出「共 0 门」，
    // 不该因为一个装饰性数字把整页打挂。
    if (!db) {
      const empty = buildStoreFacets([], COURSE_CATEGORIES)
      return NextResponse.json(empty satisfies StoreFacets)
    }

    // 与列表接口同一条搜索条件（同一函数产出，不重复实现转义）
    const conditions = [eq(courses.isPublished, 1), aliveCourse]
    const searchCondition = courseSearchCondition(search)
    if (searchCondition) conditions.push(searchCondition)

    const rows = await db
      .select({
        categoryKey: courses.categoryKey,
        subCategoryKey: courses.subCategoryKey,
        count: sql<number>`count(*)`,
      })
      .from(courses)
      .where(and(...conditions))
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
