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
 *   npx tsx scripts/orphan-rescue-plan.ts            # 打印方案 + 逐条证据校验
 *   npx tsx scripts/orphan-rescue-plan.ts --json out.json
 *
 * 注意：本脚本只读。真正的 relink 需要另一份显式脚本，且宿主必须人工确认。
 */

import { createConnection, type Connection } from "mysql2/promise"
import fs from "node:fs"

const ORPH = `NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = l.course_id)`

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
  console.log("\n重名空壳（建议随课程清理删除）:")
  for (const d of dupShells) console.log(`   ${d.id}  ${JSON.stringify(d.title)}`)
  console.log("\n本脚本只读，未修改任何数据。relink 需人工确认后另行执行。")

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({ plan: report, unusedShells: unused, dupShells }, null, 2))
    console.log(`已写出 ${outFile}`)
  }
  await c.end()
  if (fail) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
