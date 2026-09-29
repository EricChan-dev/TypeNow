/**
 * 断言「声明的变体张数」与「磁盘上的文件」**完全一致**。
 *
 * 这是整条生成流水线唯一的端到端检查，也是本方案里最容易静默出错的一环：
 * 映射表指向不存在的文件**不会有任何报错** —— 只是那批课的封面退回色块，
 * 而色块本身看起来像「正常的设计」，肉眼也发现不了。
 *
 * 三个方向都要守：
 *   1. 声明了却没文件（漏生成 / 漏转码）→ 用户看到色块；
 *   2. 有文件却没声明（生成多了忘了更新表）→ 白花的钱 + 轮换不到它；
 *   3. 某槽位一张都没有（新增课程落入新槽位但没补图）→ 整个槽位退回色块。
 *
 * ── 为什么不是「176 张全部存在」 ─────────────────────────────────────────────
 *
 * 首次量产的额度在半途耗尽（见设计文档的额度记录），最终 44 个槽位里
 * 18 个只有 v1、23 个有 v2、3 个有 v4，合计 76 张。
 * 硬要求是**每个槽位至少有 v1**（否则该槽位的课程全部没有封面）；
 * 变体多少只是「同槽位内是否重样」的观感问题。
 * 所以测试守的是「表与文件一致」，而不是一个写死的 176。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  COVER_THEME_SLOTS,
  COVER_VARIANT_COUNTS,
  themeSlug,
} from "@/lib/course-cover-themes"

const COVER_DIR = path.join(process.cwd(), "public", "images", "courses")

/** 每个槽位声明的文件列表 */
function declaredFiles(): { slug: string; files: string[] }[] {
  return COVER_THEME_SLOTS.map((slot) => {
    const slug = themeSlug(slot.categoryKey, slot.subCategoryKey)
    const n = COVER_VARIANT_COUNTS[slug] ?? 0
    return { slug, files: Array.from({ length: n }, (_, i) => `${slug}__v${i + 1}.webp`) }
  })
}

describe("public/images/courses · 声明的变体张数必须与文件一致", () => {
  it("封面目录存在", () => {
    expect(fs.existsSync(COVER_DIR)).toBe(true)
  })

  it("每个槽位都至少声明 1 张（否则该槽位的课程全部没有封面）", () => {
    const zero = declaredFiles()
      .filter((d) => d.files.length === 0)
      .map((d) => d.slug)
    expect(zero, `这些槽位一张变体都没声明：${zero.join(", ")}`).toEqual([])
  })

  it("声明了文件就真的存在，且体积正常（≥1KB）", () => {
    const missing: string[] = []
    const tooSmall: string[] = []
    for (const { files } of declaredFiles()) {
      for (const f of files) {
        const full = path.join(COVER_DIR, f)
        if (!fs.existsSync(full)) {
          missing.push(f)
          continue
        }
        // WebP q80 实测最小约 31KB（扁平类）。低于 1KB 基本只可能是空文件或半截写入。
        if (fs.statSync(full).size < 1024) tooSmall.push(f)
      }
    }
    expect(missing, `声明了但文件不存在（共 ${missing.length} 个）：${missing.slice(0, 12).join(", ")}`).toEqual([])
    expect(tooSmall, `体积异常（<1KB）：${tooSmall.join(", ")}`).toEqual([])
  })

  it("磁盘上没有未声明的孤立文件（生成多了却没更新表）", () => {
    const declared = new Set(declaredFiles().flatMap((d) => d.files))
    const actual = fs.readdirSync(COVER_DIR).filter((f) => f.endsWith(".webp"))
    const orphans = actual.filter((f) => !declared.has(f))
    expect(
      orphans,
      `存在但未被声明的文件（把它们补进 COVER_VARIANT_COUNTS 或删掉）：${orphans.join(", ")}`,
    ).toEqual([])
  })

  it("抽查多变体槽位：同槽位的各变体文件不应大小全同（防文件名串位）", () => {
    const suspicious: string[] = []
    for (const { slug, files } of declaredFiles().filter((d) => d.files.length > 1).slice(0, 8)) {
      const sizes = files.map((f) => fs.statSync(path.join(COVER_DIR, f)).size)
      if (sizes.every((s) => s === sizes[0])) suspicious.push(slug)
    }
    expect(suspicious, `这些槽位的变体文件大小完全相同，疑似串位：${suspicious.join(", ")}`).toEqual([])
  })

  it("统计总张数，便于对照流水线报告", () => {
    const total = declaredFiles().reduce((n, d) => n + d.files.length, 0)
    const perSlot = declaredFiles().map((d) => d.files.length)
    const hist = new Map<number, number>()
    for (const n of perSlot) hist.set(n, (hist.get(n) ?? 0) + 1)
    console.log(
      `  封面合计 ${total} 张；变体数分布 ` +
        [...hist.entries()].sort().map(([k, v]) => `${k} 张×${v} 槽位`).join("，"),
    )
    expect(total).toBeGreaterThanOrEqual(COVER_THEME_SLOTS.length)
  })
})
