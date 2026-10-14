/**
 * 课程广场（/home/store）筛选面：各分类 / 子分类下的课程数量。
 *
 * 纯逻辑层，不依赖数据库 —— 路由只负责 GROUP BY 取数，聚合与标签映射都在这里，
 * 这样可以脱离 MySQL 直接单测（对照 src/lib/textbook-sync.ts 的做法）。
 *
 * ── 为什么计数是「静态」的，不跟着搜索框变 ────────────────────────────────
 *
 * 搜索词会把结果集缩到很小，如果标签上的数字跟着变，用户搜「写作」时会看到
 * 「分级阅读 2」这种与分类真实规模无关的数字，反而看不出分类大小。参考页
 * （句游英语课本同步）与本站 /api/courses/textbook-facets 都是静态计数，保持一致。
 *
 * ── 为什么「全部课程」的数和各分类之和对不上 ──────────────────────────────
 *
 * 生产库有已发布但 category_key IS NULL 的课程（实测 2026-10-14 为 11 门）。
 * 它们能出现在「全部课程」里，却没有任何分类标签可挂。
 * 这里**不把它们摊派**给某个分类（那会让分类数虚高），而是单独返回
 * `uncategorized`，让「总数 = 各分类之和 + 未分类」这个恒等式可核对。
 */

import type { CourseCategory } from "@/types/course"

/** 数据库 GROUP BY 出来的一行（已发布且未软删除的课程）。 */
export interface StoreFacetRow {
  categoryKey: string | null
  subCategoryKey: string | null
  count: number
}

export interface StoreSubFacet {
  key: string
  label: string
  count: number
}

export interface StoreMainFacet {
  key: string
  label: string
  count: number
  subCategories: StoreSubFacet[]
}

export interface StoreFacets {
  /** 课程广场可见的课程总数（categoryKey=all 时列表的 total）。 */
  total: number
  /** 挂了分类标签的课程数；total - categorized = uncategorized。 */
  categorized: number
  /** 没有分类的课程数（total 里含它们，各分类之和里不含）。 */
  uncategorized: number
  /** 按 COURSE_CATEGORIES 声明顺序，**不含** key="all" 那一项。 */
  categories: StoreMainFacet[]
}

/**
 * 把 GROUP BY 结果装配成筛选面。
 *
 * 每个子分类都会出现在结果里（count 为 0 也保留）：
 * 「显示 0」让用户一眼看出这个方向暂时没有内容，
 * 而按 total>0 过滤会让标签行随数据上线/下架来回跳动，位置不稳定。
 */
export function buildStoreFacets(
  rows: readonly StoreFacetRow[],
  categories: readonly CourseCategory[],
): StoreFacets {
  const norm = (v: string | null) => (v && v.length > 0 ? v : null)

  let total = 0
  // 分类 key → 该分类下课程数
  const byCategory = new Map<string, number>()
  // "category/sub" → 该子分类课程数
  const bySub = new Map<string, number>()

  for (const row of rows) {
    const n = Number(row.count) || 0
    if (n <= 0) continue
    total += n
    const cat = norm(row.categoryKey)
    const sub = norm(row.subCategoryKey)
    if (cat) {
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + n)
      // 只统计属于已知分类的子分类，避免拼错分类时数字串到别的标签下
      if (sub) {
        const k = `${cat}/${sub}`
        bySub.set(k, (bySub.get(k) ?? 0) + n)
      }
    }
  }

  // 主分类列表以 COURSE_CATEGORIES 为准（它是前后台共用的唯一事实来源），
  // 未在其中的 category_key 不计入任何标签 —— 但它仍在 total 里，
  // 因此这里用「已归类之和」反推 uncategorized，差额不会被悄悄吞掉。
  const main = categories.filter((c) => c.key !== "all")
  let categorized = 0

  const result: StoreMainFacet[] = main.map((cat) => {
    const count = byCategory.get(cat.key) ?? 0
    categorized += count
    return {
      key: cat.key,
      label: cat.label,
      count,
      subCategories: cat.subCategories.map((sub) => ({
        key: sub.key,
        label: sub.label,
        count: bySub.get(`${cat.key}/${sub.key}`) ?? 0,
      })),
    }
  })

  return {
    total,
    categorized,
    uncategorized: total - categorized,
    categories: result,
  }
}
