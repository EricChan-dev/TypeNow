/**
 * C 类孤儿课时抢救方案（只读，不修改任何数据）
 *
 * 对象：15 门 C 类孤儿课程（course_id 指向不存在的课程，但是站点唯一副本）。
 * 目标：给出「孤儿课程 → 宿主课程」的映射，供人工确认后执行 relink。
 *
 * 映射依据（三重证据，脚本会逐条复核）：
 *   1. 内容鉴定：课时标题 + 样句 + 关键短语探针，判定是哪套教材
 *   2. 时间邻接：孤儿课时与空壳课程行创建于同一次导入的 06-12 17:00–17:14 窗口，
 *      二者时间戳交错，说明「新建课程行」和「导入课时」是同一次操作的两个半截
 *   3. 空壳排查：非重名空壳 = 那次导入为这些教材新建、却始终没拿到课时的课程行
 *
 * 空壳分类：
 *   重名空壳（13 个）→ courses 里已有同名已发布课程，是纯垃圾行，随课程清理删除
 *   非重名空壳（14 个）→ 就是这些教材本该拥有的课程行，relink 宿主
 *
 * 用法：
 *   npx tsx scripts/orphan-rescue-plan.ts                # 只读：打印方案 + 逐条证据校验
 *   npx tsx scripts/orphan-rescue-plan.ts --json out.json
 *   npx tsx scripts/orphan-rescue-plan.ts --apply        # 执行 relink + 发布 + 删重名空壳
 *
 * --apply 会做三件事（单个事务，失败自动回滚）：
 *   1. 把 14 门孤儿的课时 course_id 改成宿主课程 id
 *   2. 把 14 个宿主课程设为 is_published = 1
 *   3. 删除重名空壳课程行（排除作为宿主的那个）
 *   回滚信息写到 content-deleted/orphan-relink-undo.json
 */

import { createConnection, type Connection } from "mysql2/promise"
import fs from "node:fs"

const ORPH = `NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = l.course_id)`
const APPLY = process.argv.includes("--apply")

function dbUrl(): string {
  const m = fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error(".env.local 里找不到 DATABASE_URL")
  return m[1].trim()
}

const t0 = Date.now()
const P = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`)
const N = (n: unknown) => Number(n).toLocaleString("en-US")
const S8 = (s: unknown) => String(s).slice(0, 8)

async function rows<T = Record<string, unknown>>(c: Connection, sql: string, p?: unknown[]): Promise<T[]> {
  const [r] = await c.execute(sql, p)
  return r as T[]
}

/**
 * 人工鉴定结果。hostPrefix = 空壳课程 id 前缀；probe = 必须存在于该孤儿课程里的关键短语。
 * 每条都会被脚本验证（探针查得到 + 宿主课时数为 0 + 孤儿课时与记录一致），不匹配就报错。
 */
type Plan = {
  orphPrefix: string
  hostPrefix: string | null
  material: string
  probe: string
  note: string
  /** 宿主与一个已发布课程重名，但那个已发布课程是垃圾/残缺内容，仍应作为宿主 */
  allowDupHost?: boolean
}

const PLAN: Plan[] = [
  { orphPrefix: "ab99f9d8", hostPrefix: "1f7b8e86", material: "美国家庭万用亲子英文8000句", probe: "Time to wake up", note: "607 课时；已发布 037db965「已完结含单词」与它同源但更多内容" },
  {
    orphPrefix: "d571a182",
    hostPrefix: "82e25430",
    material: "新概念英语第二册",
    probe: "Last week I went to the theatre",
    note:
      "96 课时 = NCE2 全册。宿主与已发布 51a7a0bb 重名，但 51a7a0bb 只有 15 课时、内容是 AI 编造的杰克洒牛奶故事（与孤儿 0 句重合）→ " +
      "正确做法是把孤儿挂到 82e25430，并下架/删除 51a7a0bb 的 15 课时假内容",
    allowDupHost: true,
  },
  { orphPrefix: "fa2c5d40", hostPrefix: "4d2c8a02", material: "新概念英语第3册美音【原版音频】", probe: "Where must the puma have come from", note: "85 课时，与 e954ccc3 仅 33% 重合 → 另一版本" },
  { orphPrefix: "9de62f57", hostPrefix: "30946010", material: "新概念英语第一册（单数课）", probe: "Is this your handbag", note: "72 课时偶数递增 → 单数课" },
  { orphPrefix: "b4145209", hostPrefix: "99577f8e", material: "新概念英语第1册美音【原版音频】", probe: "Whose handbag is it", note: "71 课时，与 9de62f57 仅 52% 重合 → 另一版本" },
  { orphPrefix: "d279c370", hostPrefix: "550d721a", material: "人教版高中必修二(单词)(带例句)", probe: "Cultural heritage is an important part", note: "heritage 是人教版必修二 Unit 1 词汇；标题与已发布必修一课程 51/51 重合" },
  { orphPrefix: "e954ccc3", hostPrefix: "c68a9e5d", material: "新概念英语第三册", probe: "A puma at large", note: "60 课时 = NCE3 全册正文" },
  { orphPrefix: "2b6ea386", hostPrefix: "11000b0c", material: "新世纪走遍美国【48课】", probe: "Annenberg CPB Project", note: "48 课时，与片头赞助商声明吻合" },
  { orphPrefix: "9e0aa6ce", hostPrefix: "30465c2f", material: "【译林版】七年级上册【课本同步】", probe: "each other", note: "课时标题 Unit 1 This is me! = 译林版七上 Unit 1" },
  { orphPrefix: "a3b590b4", hostPrefix: "0906292a", material: "人教版】一年级上册【新起点版课本同步】", probe: "ruler", note: "课时标题 Unit 1 School / Unit 2 Face = 人教版新起点一年级上" },
  { orphPrefix: "c3eca2ee", hostPrefix: "3ab3beed", material: "日常英语对话100句", probe: "do you have this shirt in a smaller size", note: "17 课时全部是购物/餐饮/旅行场景口语" },
  { orphPrefix: "e6bd8aa1", hostPrefix: "de0124f4", material: "【译林版】三年级上册【课本同步】", probe: "Are you Su Hai", note: "课时标题 Unit 3 Are you Su Hai? = 译林版三上 Unit 3" },
  { orphPrefix: "ee92170d", hostPrefix: "d4cc38eb", material: "小猪佩奇-第二季【英文原版音频】", probe: "i'm peppa pig", note: "课时 S02E01–S02E05 = 第二季" },
  { orphPrefix: "5d191fc9", hostPrefix: "4e8c2abc", material: "最新雅思考试胜策（写作）", probe: "The price of cars fluctuates", note: "样句全是雅思 Task 1 图表描述" },
  // 无宿主：21 个 Unit 的词汇表，内容 64% 已被已发布【雅思】词汇8000个【乱序版】覆盖
  { orphPrefix: "603f6c6c", hostPrefix: null, material: "（未识别）21 单元词汇表", probe: "work on", note: "内容 64% 与已发布 0fb947a3【雅思】词汇8000【乱序版】重合，剩余 348 句为通用词汇 → 建议弃" },
]

async function main() {
  const c = await createConnection(dbUrl())
  const jsonArg = process.argv.indexOf("--json")
  const outFile = jsonArg >= 0 ? process.argv[jsonArg + 1] : null
  let fail = 0

  P("统计 C 类孤儿课程")
  const orphans = await rows<{ course_id: string; n_lessons: number; n_sent: number; n_distinct: number; min_c: string }>(c, `
    SELECT l.course_id,
           COUNT(DISTINCT l.id) AS n_lessons,
           COUNT(s.id) AS n_sent,
           COUNT(DISTINCT CONCAT(s.chinese,'\\u0001',s.english)) AS n_distinct,
           DATE_FORMAT(MIN(l.created_at),'%Y-%m-%d %H:%i:%s') AS min_c
    FROM lessons l LEFT JOIN sentences s ON s.lesson_id = l.id
    WHERE ${ORPH}
    GROUP BY l.course_id
    ORDER BY n_lessons DESC
  `)
  const orphBy = new Map(orphans.map((o) => [S8(o.course_id), o]))
  P(`C 类孤儿课程 ${orphans.length} 门`)

  P("空壳课程分类（重名 = 已有同名已发布课程）")
  const shells = await rows<{ id: string; title: string; created_at: string; dup: number }>(c, `
    SELECT c.id, c.title, DATE_FORMAT(c.created_at,'%Y-%m-%d %H:%i:%s') AS created_at,
           (SELECT COUNT(*) FROM courses p WHERE p.is_published=1 AND TRIM(p.title)=TRIM(c.title)) AS dup
    FROM courses c
    WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id=c.id)
    ORDER BY c.created_at
  `)
  const shellBy = new Map(shells.map((s) => [S8(s.id), s]))
  const dupShells = shells.filter((s) => s.dup > 0)
  const liveShells = shells.filter((s) => s.dup === 0)
  console.log(`  重名空壳 ${dupShells.length} 个（纯垃圾行）· 非重名空壳 ${liveShells.length} 个（relink 宿主候选）`)

  P("逐条校验映射（探针存在性 + 宿主为空壳 + 课时数一致）")
  const report: unknown[] = []
  for (const p of PLAN) {
    const o = orphBy.get(p.orphPrefix)
    if (!o) {
      console.log(`  ✗ ${p.orphPrefix} 不再是孤儿课程（已处理？）`)
      fail++
      continue
    }
    const probeHit = await rows<{ n: number }>(c, `
      SELECT COUNT(*) AS n FROM sentences s JOIN lessons l ON l.id = s.lesson_id
      WHERE l.course_id = ? AND (s.english LIKE CONCAT('%', ?, '%') OR s.chinese LIKE CONCAT('%', ?, '%'))
    `, [o.course_id, p.probe, p.probe])
    const probeOk = Number(probeHit[0].n) > 0

    let hostOk = false
    let hostLine = "（无宿主 → 建议弃）"
    if (p.hostPrefix) {
      const h = shellBy.get(p.hostPrefix)
      const dupBlocking = h !== undefined && h.dup > 0 && p.allowDupHost !== true
      hostOk = h !== undefined && !dupBlocking
      hostLine = h
        ? `${h.id}  ${JSON.stringify(h.title)}  [${h.dup > 0 ? `重名空壳${p.allowDupHost ? "（已标记可用）" : " ✗"}` : "非重名空壳 ✓"}]`
        : `${p.hostPrefix}  ✗ 未找到`
    }
    if (!probeOk || (p.hostPrefix && !hostOk)) fail++

    console.log(`\n${"─".repeat(96)}`)
    console.log(`${probeOk ? "✓" : "✗"} 孤儿 ${o.course_id}`)
    console.log(`   ${N(o.n_lessons)} 课时 · 句子行 ${N(o.n_sent)} · 去重句 ${N(o.n_distinct)} · 创建 ${o.min_c}`)
    console.log(`   鉴定教材: ${p.material}`)
    console.log(`   探针 "${p.probe}" 命中 ${N(probeHit[0].n)} 句 → ${probeOk ? "通过" : "失败"}`)
    console.log(`   宿主: ${hostLine}`)
    console.log(`   说明: ${p.note}`)

    report.push({
      orphan_course_id: o.course_id,
      n_lessons: o.n_lessons,
      n_sent: o.n_sent,
      n_distinct: o.n_distinct,
      material: p.material,
      probe: p.probe,
      probe_hits: Number(probeHit[0].n),
      host_course_id: p.hostPrefix ? shellBy.get(p.hostPrefix)?.id ?? null : null,
      host_title: p.hostPrefix ? shellBy.get(p.hostPrefix)?.title ?? null : null,
      note: p.note,
    })
  }

  console.log(`\n${"=".repeat(96)}`)
  console.log(`映射 ${PLAN.length} 条 · 校验失败 ${fail} 条`)
  const mapped = PLAN.filter((p) => p.hostPrefix !== null)
  const orphTotal = mapped.reduce((a, p) => a + Number(orphBy.get(p.orphPrefix)?.n_lessons ?? 0), 0)
  const sentTotal = mapped.reduce((a, p) => a + Number(orphBy.get(p.orphPrefix)?.n_distinct ?? 0), 0)
  console.log(`可复活 ${mapped.length} 门 · ${N(orphTotal)} 课时 · ${N(sentTotal)} 去重句`)
  console.log(`无宿主 ${PLAN.length - mapped.length} 门 · 未使用空壳 ${liveShells.filter((s) => !PLAN.some((p) => p.hostPrefix === S8(s.id))).length} 个`)
  const unused = liveShells.filter((s) => !PLAN.some((p) => p.hostPrefix === S8(s.id)))
  for (const u of unused) console.log(`   未使用: ${u.id}  ${JSON.stringify(u.title)}`)

  // 重名空壳中、同时被指定为 relink 宿主的，不能删（删了这次抢救就白做）
  const hostIds = new Set(mapped.map((p) => shellBy.get(p.hostPrefix!)?.id).filter(Boolean) as string[])
  const dupToDelete = dupShells.filter((d) => !hostIds.has(d.id))
  const dupKept = dupShells.filter((d) => hostIds.has(d.id))
  console.log(`\n重名空壳 ${dupShells.length} 个：删除 ${dupToDelete.length} 个 · 保留 ${dupKept.length} 个（作为 relink 宿主）`)
  for (const d of dupToDelete) console.log(`   删 ${d.id}  ${JSON.stringify(d.title)}`)
  for (const d of dupKept) console.log(`   留 ${d.id}  ${JSON.stringify(d.title)}  ← relink 宿主`)

  if (outFile) {
    fs.writeFileSync(
      outFile,
      JSON.stringify({ plan: report, unusedShells: unused, dupShellsToDelete: dupToDelete, dupShellsKept: dupKept }, null, 2)
    )
    console.log(`\n已写出 ${outFile}`)
  }

  if (!APPLY) {
    console.log("\n当前为只读方案模式。执行写入请加 --apply。")
    await c.end()
    if (fail) process.exitCode = 1
    return
  }

  if (fail) throw new Error(`校验失败 ${fail} 条，拒绝执行 --apply`)

  // ---------- 写入 ----------
  P("开始写入")
  fs.mkdirSync("content-deleted", { recursive: true })
  fs.writeFileSync(
    "content-deleted/orphan-relink-undo.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        relink: mapped.map((p) => ({
          lessonCourseIdFrom: orphBy.get(p.orphPrefix)!.course_id,
          lessonCourseIdTo: shellBy.get(p.hostPrefix!)!.id,
          hostTitle: shellBy.get(p.hostPrefix!)!.title,
          nLessons: Number(orphBy.get(p.orphPrefix)!.n_lessons),
        })),
        deletedCourses: dupToDelete,
      },
      null,
      2
    )
  )
  console.log("   回滚信息 → content-deleted/orphan-relink-undo.json")

  await c.beginTransaction()
  try {
    let lessonMoved = 0
    for (const p of mapped) {
      const from = orphBy.get(p.orphPrefix)!.course_id
      const host = shellBy.get(p.hostPrefix!)!
      // 写入前再验一次：宿主仍是真实课程、且当前 0 课时
      const [hostCheck] = await rows<{ n: number }>(c, `
        SELECT COUNT(*) AS n FROM courses c
        WHERE c.id = ? AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id)
      `, [host.id])
      if (Number(hostCheck.n) !== 1) throw new Error(`宿主 ${host.id} 已不是「存在且 0 课时」，中止`)

      const [res] = await c.execute(`UPDATE lessons SET course_id = ? WHERE course_id = ?`, [host.id, from])
      const moved = (res as { affectedRows: number }).affectedRows
      lessonMoved += moved
      await c.execute(`UPDATE courses SET is_published = 1 WHERE id = ?`, [host.id])
      console.log(`   ✓ ${N(moved)} 课时 ${host.id} ← ${S8(from)}  ${JSON.stringify(host.title)}（已发布）`)
    }

    for (const d of dupToDelete) {
      await c.execute(`DELETE FROM courses WHERE id = ?`, [d.id])
    }
    console.log(`   ✓ 删除重名空壳课程 ${dupToDelete.length} 个`)

    await c.commit()
    console.log(`   提交完成 · 迁移课时 ${N(lessonMoved)}`)
  } catch (e) {
    await c.rollback()
    console.error("   已回滚：", e)
    await c.end()
    process.exit(1)
  }

  P("写入后校验")
  const [orphLeft] = await rows<{ n: number }>(c, `
    SELECT COUNT(*) AS n FROM lessons l WHERE ${ORPH}
  `)
  const [dangling] = await rows<{ n: number }>(c, `
    SELECT COUNT(*) AS n FROM sentences s WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = s.lesson_id)
  `)
  const [emptyLive] = await rows<{ n: number }>(c, `
    SELECT COUNT(*) AS n FROM lessons l WHERE EXISTS (SELECT 1 FROM courses c WHERE c.id = l.course_id)
      AND NOT EXISTS (SELECT 1 FROM sentences s WHERE s.lesson_id = l.id)
  `)
  const [pubShells] = await rows<{ n: number }>(c, `
    SELECT COUNT(*) AS n FROM courses c WHERE c.is_published = 1
      AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id)
  `)
  const [hostL] = await rows<{ n: number }>(c, `
    SELECT COUNT(*) AS n FROM lessons l WHERE l.course_id IN (${mapped.map(() => "?").join(",")})
  `, mapped.map((p) => shellBy.get(p.hostPrefix!)!.id))
  console.log(`   剩余孤儿课时 ${N(orphLeft.n)}（应为 1）`)
  console.log(`   断链句子 ${N(dangling.n)}（应为 0）`)
  console.log(`   可达空课时 ${N(emptyLive.n)}（应为 0）`)
  console.log(`   已发布却 0 课时的课程 ${N(pubShells.n)}（应为 0）`)
  console.log(`   14 个宿主现有课时合计 ${N(hostL.n)}（应为 ${N(orphTotal)}）`)

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
