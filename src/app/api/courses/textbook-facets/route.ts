import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { aliveCourse } from "@/lib/soft-delete"
import { eq, and, sql } from "drizzle-orm"
import {
  GRADE_LABELS,
  STAGES,
  UNGRADED_STAGE_KEY,
  UNGRADED_STAGE_LABEL,
  versionLabel,
} from "@/lib/textbook-taxonomy"

/**
 * 教材同步的筛选面（facets）：各学段 / 年级 / 版本下的课程数量。
 *
 * ── 为什么要单独一个接口 ────────────────────────────────────────────────────
 *
 * 实测数据非常不均：高中只有 10 门课、中职 7 门、某些年级只有 9 门。
 * 如果筛选按钮无条件全列出来，用户会点进一个空列表 —— 那比"少一个选项"糟得多。
 * 前端据此**只列出真的有内容的选项并显示数量**。
 *
 * ── 为什么必须包含「未分级」────────────────────────────────────────────────
 *
 * 生产库有 11 门已发布的 `school_sync` 课程 `sub_category_key IS NULL`
 * （实测 2026-09-29）。如果只按 STAGES 列分组，这 11 门课在教材同步页
 * **完全不可见** —— 用户会以为它们不存在。
 *
 * 注意区分两个容易混淆的概念：
 *   · **未分级**：`sub_category_key IS NULL` —— 课程没归到任何年级
 *   · **版本未回填**：`textbook_version IS NULL` —— 迁移跑了但回填脚本没跑
 * 前者是一个「分组」，后者是一个「过渡态」。字段名里刻意区分开。
 *
 * ── 为什么一次 GROUP BY 就够 ────────────────────────────────────────────────
 *
 * 课程表只有几百行，一次 `GROUP BY (sub_category_key, textbook_version)` 拿回
 * 几十行，聚合在 JS 里做。比拆成三四个查询更简单，也不会出现"三个查询口径不一致"。
 */
export async function GET() {
  try {
    if (!db) return NextResponse.json({ stages: [], versionReady: false })

    const rows = await db
      .select({
        grade: courses.subCategoryKey,
        version: courses.textbookVersion,
        count: sql<number>`count(*)`,
      })
      .from(courses)
      .where(
        and(eq(courses.categoryKey, "school_sync"), eq(courses.isPublished, 1), aliveCourse),
      )
      .groupBy(courses.subCategoryKey, courses.textbookVersion)

    // grade → version → count
    const byGrade = new Map<string, Map<string, number>>()
    // 未分级课程的版本分布（单独统计，不进 byGrade —— 它的 key 不是年级）
    const ungradedVersions = new Map<string, number>()
    let ungradedTotal = 0
    let versionReady = false

    for (const row of rows) {
      const n = Number(row.count) || 0
      const versionKey = row.version ?? ""
      if (versionKey) versionReady = true

      // 没归年级的课单独归集
      if (!row.grade) {
        ungradedTotal += n
        if (versionKey) {
          ungradedVersions.set(versionKey, (ungradedVersions.get(versionKey) ?? 0) + n)
        }
        continue
      }

      const bucket = byGrade.get(row.grade) ?? new Map<string, number>()
      bucket.set(versionKey, (bucket.get(versionKey) ?? 0) + n)
      byGrade.set(row.grade, bucket)
    }

    /**
     * 显式声明为宽类型。
     *
     * 不这样做的话 TS 会把数组推断成 `STAGES.map(...)` 的形状（`key: StageKey`），
     * 于是最后追加「未分级」（key 是 `"ungraded"`，不是学段）会报类型错 ——
     * 而那个错误恰好反映了真实语义：未分级**不是**学段。
     */
    interface FacetStage {
      key: string
      label: string
      total: number
      versionUnclassified: number
      versions: { key: string; label: string; count: number }[]
      grades: {
        key: string
        label: string
        total: number
        versions: { key: string; label: string; count: number }[]
      }[]
    }

    const stages: FacetStage[] = STAGES.map((stage) => {
      const stageVersions = new Map<string, number>()
      let stageTotal = 0
      let versionUnclassified = 0

      const grades = stage.grades.map((gradeKey) => {
        const bucket = byGrade.get(gradeKey) ?? new Map<string, number>()
        let gradeTotal = 0
        const versions: { key: string; label: string; count: number }[] = []

        for (const [versionKey, count] of bucket) {
          gradeTotal += count
          if (versionKey) {
            stageVersions.set(versionKey, (stageVersions.get(versionKey) ?? 0) + count)
            versions.push({ key: versionKey, label: versionLabel(versionKey), count })
          } else {
            versionUnclassified += count
          }
        }
        // 版本按数量倒序：用户最可能选的版本排前面（人教版/外研版通常最大）
        versions.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"))

        stageTotal += gradeTotal
        return {
          key: gradeKey,
          label: GRADE_LABELS[gradeKey] ?? gradeKey,
          total: gradeTotal,
          versions,
        }
      })

      // 学段级版本汇总（「全部年级」时用）
      const versionSummary = [...stageVersions.entries()]
        .map(([key, count]) => ({ key, label: versionLabel(key), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"))

      return {
        key: stage.key,
        label: stage.label,
        total: stageTotal,
        versionUnclassified,
        versions: versionSummary,
        // 只保留真的有课的年级 —— 免得用户点进空列表
        grades: grades.filter((g) => g.total > 0),
      }
    }).filter((s) => s.total > 0)

    // 「未分级」作为最后一个分组追加。它没有年级子层（grades 为空）。
    if (ungradedTotal > 0) {
      const versions = [...ungradedVersions.entries()]
        .map(([key, count]) => ({ key, label: versionLabel(key), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"))
      stages.push({
        key: UNGRADED_STAGE_KEY,
        label: UNGRADED_STAGE_LABEL,
        total: ungradedTotal,
        versionUnclassified: ungradedTotal - versions.reduce((s, v) => s + v.count, 0),
        versions,
        grades: [],
      })
    }

    return NextResponse.json({ stages, versionReady })
  } catch (e) {
    console.error("[courses/textbook-facets]", e)
    return NextResponse.json({ error: "加载筛选条件失败" }, { status: 500 })
  }
}
