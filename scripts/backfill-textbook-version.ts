/**
 * 回填 `courses.textbook_version`（教材同步的版本维度）。
 *
 * 用法：
 *   npx tsx scripts/backfill-textbook-version.ts            # dry-run：只产出清单，不写库
 *   npx tsx scripts/backfill-textbook-version.ts --apply    # 确认清单后再写库
 *
 * ── 为什么默认 dry-run ──────────────────────────────────────────────────────
 *
 * 版本是从**课程标题**解析出来的（见 src/lib/textbook-taxonomy.ts），
 * 而生产标题很脏：括号写法不统一（`【人教版】` / `人教版】`）、有错别字（`1年纪`）、
 * 有根本不是教材同步却被归到年级下的内容（`幼儿启蒙英语`）。
 *
 * 194 门中小学同步课里只有 114 门（59%）能可靠认出，剩下 80 门归 `other`。
 * 这是一个需要人看一眼的判断过程，不该由脚本直接落库 ——
 * 所以先产出 `content-textbook-version.json`，人工抽检后再 `--apply`。
 *
 * ── 本脚本**不会**做的事 ────────────────────────────────────────────────────
 *
 * 不会把「疑似非教材同步」的课程移出年级。那是一次内容归类变更
 * （有些"主题系列"可能确实是教材配套），需要人判断；这里只产出清单。
 *
 * ── 幂等 ────────────────────────────────────────────────────────────────────
 *
 * 反复 `--apply` 是安全的：解析结果只取决于标题，写进去的值每次都一样。
 */

import { createConnection } from "mysql2/promise"
import fs from "node:fs"
import path from "node:path"
import {
  looksNonTextbook,
  parseTextbookVersion,
  versionLabel,
  type VersionMatchSource,
} from "../src/lib/textbook-taxonomy"

const APPLY = process.argv.includes("--apply")
const ROOT = process.cwd()

function loadDatabaseUrl(): string {
  // 允许用环境变量指定库（便于先在测试库上验证脚本行为再动生产）。
  // 显式传入时优先使用，否则回落到 .env.local 里的 DATABASE_URL。
  const fromEnv = process.env.DATABASE_URL?.trim()
  if (fromEnv) return fromEnv

  const envPath = path.join(ROOT, ".env.local")
  const text = fs.readFileSync(envPath, "utf8")
  const m = text.match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error("在 .env.local 中找不到 DATABASE_URL")
  return m[1].trim().replace(/^["']|["']$/g, "")
}

interface CourseRow {
  id: string
  title: string
  sub_category_key: string | null
  is_published: number
  textbook_version: string | null
}

interface ReviewEntry {
  id: string
  title: string
  grade: string | null
  resolvedVersion: string
  resolvedLabel: string
  source: VersionMatchSource
  evidence: string
  published: boolean
  suspectedNonTextbook: boolean
}

async function main() {
  const conn = await createConnection(loadDatabaseUrl())
  try {
    // 范围：中小学同步 + 未软删除。**包含未发布**的课程 ——
    // 否则将来把某门课发布出去时又会缺版本，得再跑一次。
    const [rows] = await conn.query<(CourseRow & { id: string })[]>(
      `SELECT id, title, sub_category_key, is_published, textbook_version
       FROM courses
       WHERE category_key = 'school_sync' AND deleted_at IS NULL
       ORDER BY sub_category_key, title`,
    )

    console.log(`中小学同步课程（未软删除）：${rows.length} 门`)
    const publishedCount = rows.filter((r) => Number(r.is_published) === 1).length
    console.log(`  其中已发布：${publishedCount} 门`)

    const review: ReviewEntry[] = []
    // 没有年级的课：它们在教材同步页的「未分级」分组里可见，
    // 但从标题看多数能判断真实年级（如「…8下单词」→ 八年级）。
    // 改年级是内容归类变更，脚本不擅自决定，只产出清单。
    const ungraded: ReviewEntry[] = []
    const byVersion = new Map<string, number>()
    const byGrade = new Map<string, Map<string, number>>()
    let bracketCount = 0
    let keywordCount = 0
    let otherCount = 0
    const suspected: ReviewEntry[] = []

    for (const row of rows) {
      const parsed = parseTextbookVersion(row.title)
      if (parsed.source === "bracket") bracketCount++
      else if (parsed.source === "keyword") keywordCount++
      else otherCount++

      byVersion.set(parsed.version, (byVersion.get(parsed.version) ?? 0) + 1)

      const grade = row.sub_category_key ?? "(无年级)"
      if (!byGrade.has(grade)) byGrade.set(grade, new Map())
      const gm = byGrade.get(grade)!
      gm.set(parsed.version, (gm.get(parsed.version) ?? 0) + 1)

      const entry: ReviewEntry = {
        id: row.id,
        title: row.title,
        grade: row.sub_category_key,
        resolvedVersion: parsed.version,
        resolvedLabel: versionLabel(parsed.version),
        source: parsed.source,
        evidence: parsed.evidence,
        published: Number(row.is_published) === 1,
        suspectedNonTextbook: looksNonTextbook(row.title, parsed.source),
      }
      review.push(entry)
      if (entry.suspectedNonTextbook) suspected.push(entry)
      if (!row.sub_category_key) ungraded.push(entry)
    }

    // ── 报告 ────────────────────────────────────────────────────────────────
    console.log(`\n解析来源分布：`)
    console.log(`  括号内命中（最可靠）：${bracketCount}`)
    console.log(`  全文关键词命中：      ${keywordCount}`)
    console.log(`  认不出 → other：      ${otherCount}`)
    const resolvable = bracketCount + keywordCount
    console.log(
      `  可识别率：${rows.length > 0 ? Math.round((resolvable / rows.length) * 100) : 0}%` +
        `（${resolvable}/${rows.length}）`,
    )

    console.log(`\n版本分布：`)
    for (const [key, count] of [...byVersion.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${versionLabel(key).padEnd(12)} ${String(count).padStart(4)}`)
    }

    console.log(`\n各年级的版本分布（用于判断某个年级点进去会不会太空）：`)
    const gradeOrder = [
      "grade_1", "grade_2", "grade_3", "grade_4", "grade_5", "grade_6",
      "grade_7", "grade_8", "grade_9", "high_school", "vocational", "(无年级)",
    ]
    for (const g of gradeOrder) {
      const gm = byGrade.get(g)
      if (!gm) continue
      const total = [...gm.values()].reduce((a, b) => a + b, 0)
      const detail = [...gm.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, c]) => `${versionLabel(k)} ${c}`)
        .join(" / ")
      console.log(`  ${g.padEnd(12)} 共 ${String(total).padStart(3)}：${detail}`)
    }

    if (ungraded.length > 0) {
      console.log(`\n⚠️ 没有年级的课程（sub_category_key IS NULL）：${ungraded.length} 门`)
      console.log(`   它们在教材同步页的「未分级」分组里可见，不会被藏起来。`)
      console.log(`   从标题看多数能判断真实年级，但改年级属于内容归类变更 —— 清单见 JSON，请人工决定。`)
      for (const u of ungraded) {
        console.log(`   · [${u.resolvedLabel}] ${u.title}`)
      }
    }

    if (suspected.length > 0) {
      console.log(`\n⚠️ 疑似非教材同步（认不出且标题含"启蒙/基础学习/主题系列"等词）：${suspected.length} 门`)
      console.log(`   本脚本**不会**自动把它们移出年级 —— 需要人工判断，清单见 JSON。`)
      for (const s of suspected.slice(0, 15)) {
        console.log(`   · [${s.grade ?? "无年级"}] ${s.title}`)
      }
      if (suspected.length > 15) console.log(`   … 其余 ${suspected.length - 15} 门见 JSON`)
    }

    // ── 产出清单 ────────────────────────────────────────────────────────────
    const outPath = path.join(ROOT, "content-textbook-version.json")
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          applied: APPLY,
          summary: {
            total: rows.length,
            published: publishedCount,
            bracket: bracketCount,
            keyword: keywordCount,
            other: otherCount,
            ungraded: ungraded.length,
            resolvableRate: rows.length > 0 ? resolvable / rows.length : 0,
          },
          byVersion: Object.fromEntries([...byVersion.entries()].sort((a, b) => b[1] - a[1])),
          ungraded,
          ungradedCount: ungraded.length,
          suspectedNonTextbook: suspected,
          courses: review,
        },
        null,
        2,
      ),
      "utf8",
    )
    console.log(`\n清单已写出：${path.relative(ROOT, outPath)}`)

    // ── 写库 ────────────────────────────────────────────────────────────────
    if (!APPLY) {
      console.log(`\n（dry-run）没有写库。确认清单后加 --apply 再跑一次。`)
      return
    }

    // 按版本分组，一组一条 UPDATE，避免 194 次单行更新
    const groups = new Map<string, string[]>()
    for (const r of review) {
      const list = groups.get(r.resolvedVersion) ?? []
      list.push(r.id)
      groups.set(r.resolvedVersion, list)
    }

    let updated = 0
    for (const [version, ids] of groups) {
      if (ids.length === 0) continue
      const placeholders = ids.map(() => "?").join(",")
      const [result] = await conn.query<{ affectedRows: number }>(
        `UPDATE courses SET textbook_version = ? WHERE id IN (${placeholders})`,
        [version, ...ids],
      )
      updated += Number((result as unknown as { affectedRows?: number })?.affectedRows ?? 0)
      console.log(`  ${versionLabel(version).padEnd(12)} 写入 ${ids.length} 门`)
    }
    console.log(`\n完成：共更新 ${updated} 行。`)

    // 回读校验：写进去的值必须与解析结果一致
    const [check] = await conn.query<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM courses
       WHERE category_key = 'school_sync' AND deleted_at IS NULL AND textbook_version IS NULL`,
    )
    const nullCount = Number(check[0]?.n ?? 0)
    console.log(
      nullCount === 0
        ? `校验通过：中小学同步课程全部有版本值。`
        : `⚠️ 仍有 ${nullCount} 门课没有版本值（可能是在本脚本读取之后新增的，重跑即可）。`,
    )
  } finally {
    await conn.end()
  }
}

void main().catch((e) => {
  console.error("回填失败：", e)
  process.exit(1)
})
