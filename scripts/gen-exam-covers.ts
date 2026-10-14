/**
 * 应试考试（exam_prep）封面重做 —— glm-image 成熟风 + 烤中文标题。
 *
 * 背景（用户 2026-10-13 需求）：现有 exam_prep 封面里油画风的、模糊的要筛出来重做；
 * 应试人群比中小学更成熟，人物场景要改成中学生/大学生/成年学习者。
 * 范围只做「明显有问题的」（contact sheet + 视觉初筛勾出的子集），不整批重做。
 *
 * 用法：
 *   npx tsx scripts/gen-exam-covers.ts --step=state --ids=flagged-ids.json  # 按名单建状态（不给 ids 则全量）
 *   npx tsx scripts/gen-exam-covers.ts --step=distill                      # DeepSeek 蒸馏 sub/scene
 *   npx tsx scripts/gen-exam-covers.ts --step=images --limit=2             # 先小样验证再放量
 *   npx tsx scripts/gen-exam-covers.ts --step=report
 *   npx tsx scripts/gen-exam-covers.ts --step=compress --apply
 *   npx tsx scripts/gen-exam-covers.ts --step=apply --apply                # mysqldump 备份 + 写库
 *
 * 管线与 scripts/gen-graded-covers.ts 同构（同款 OCR 校验/复检/限流处理），
 * 差异只在：槽位、成熟风 STYLE、考试名主标题映射、按 --ids 名单收窄范围。
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { config as loadEnv } from "dotenv"
import { createConnection } from "mysql2/promise"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

const SLOT = "exam_prep"
const STATE_FILE = path.join(ROOT, ".covers-build", "exam-covers-state.json")
const PNG_DIR = path.join(ROOT, ".covers-build", "exam-prep")
const WEB_DIR = path.join(ROOT, "public", "images", "courses")
const BACKUP_DIR = path.join(ROOT, "db-backup")

// sharp 走 next 的 optionalDependency 锚点（同 gen-course-covers.ts）
const cwdRequire = createRequire(path.join(ROOT, "scripts", ".resolve-anchor.cjs"))
const nextRequire = createRequire(cwdRequire.resolve("next/package.json"))
const sharpLib = nextRequire("sharp") as typeof import("sharp")

// ─── 模型与参数（与 school_sync / graded 同管线）─────────────────────────────
const IMAGE_URL = "https://open.bigmodel.cn/api/paas/v4/images/generations"
const IMAGE_MODEL = "glm-image"
const SIZE = "1440x960"
const OCR_TOOL = "/tmp/ocrtool/ocr"

/**
 * 成熟风 STYLE：保持产品统一的扁平矢量语言，但人物改成中学生/大学生/成年学习者，
 * 场景换成图书馆/自习室/书桌等备考场景，配色明快但比儿童版沉稳。
 */
const STYLE =
  "现代教育课程封面。扁平矢量插画风格，几何化造型，平涂上色，边缘干净利落。" +
  "配色明快而沉稳，以蓝、青、橙等中高饱和度色块搭配，画面饱满铺满整幅。" +
  "背景被具体的校园与学习场景元素填满：书架、课桌、台灯、云朵、树木、教学楼、几何装饰花纹铺满画面每个角落，" +
  "几乎没有大片纯色或白色空白。" +
  "主体人物是中学生、大学生或成年学习者，在图书馆、教室或书桌前专注学习，人物比例自然、造型大方，画面中不出现幼儿。"
const LEAVE = "画面中为标题文字留出一片相对简洁开阔的区域，该区域内的背景元素较少。"
const TAIL = "除上述标题外，画面中不出现任何其他文字、字母或数字。"

/** 考试名主标题映射：sub_category_key → 封面主标题（标题里出现更具体的考试名时优先用后者） */
const EXAM_MAIN: Record<string, string> = {
  ielts_toefl: "雅思",
  cet_4_6: "四六级",
  pte: "PTE",
  gaokao: "高考英语",
  zhuan_sheng_ben: "专升本",
  zhongkao: "中考英语",
  postgraduate: "考研英语",
  degree_english: "学位英语",
  pet: "PET",
  tem_4_8: "专四专八",
  gre: "GRE",
  ket: "KET",
  toeic: "托业",
  fce: "FCE",
}

/** 标题关键词优先级：比子类默认名更具体就用它 */
const TITLE_REFINE: [RegExp, string][] = [
  [/托福/i, "托福"],
  [/雅思/i, "雅思"],
  [/六级/i, "六级"],
  [/四级|CET-?4/i, "四级"],
  [/考研/i, "考研英语"],
  [/专四专八|TEM/i, "专四专八"],
  [/学位英语/i, "学位英语"],
  [/专升本/i, "专升本"],
]

interface Item {
  courseId: string
  title: string
  subCategoryKey: string | null
  slot: string
  main?: string
  sub?: string
  scene?: string
  gens?: number
  verdict?: string
  reason?: string
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function zhipuKey(): string {
  const key = process.env.ZHIPU_API_KEY?.trim()
  if (!key) throw new Error("在 .env.local 里找不到 ZHIPU_API_KEY")
  return key
}

function deepseekKey(): string {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error("在 .env.local 里找不到 DEEPSEEK_API_KEY")
  return key
}

async function dbUrl(): Promise<string> {
  const m = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^DATABASE_URL=(.+)$/m)
  if (!m) throw new Error("在 .env.local 里找不到 DATABASE_URL")
  return m[1].trim()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** FNV-1a 32 位哈希，按 courseId 稳定选取版式/配色 */
function h(cid: string, salt: string, n: number): number {
  let x = 0x811c9dc5
  for (let i = 0; i < cid.length; i++) x = Math.imul(x ^ cid.charCodeAt(i), 0x01000193) >>> 0
  for (let i = 0; i < salt.length; i++) x = Math.imul(x ^ salt.charCodeAt(i), 0x01000193) >>> 0
  return x % n
}

function seedMain(title: string, sub: string | null): string {
  for (const [re, name] of TITLE_REFINE) if (re.test(title)) return name
  return (sub && EXAM_MAIN[sub]) || "英语考试"
}

function buildPrompt(x: Item): string {
  const main = x.main ?? ""
  const sub = x.sub ?? ""
  const label = sub ? `${main} ${sub}` : main

  const t = h(x.courseId, "T", 5)
  const c = h(x.courseId, "C", 5)
  const tilt = h(x.courseId, "R", 100) < 12

  let pos: string
  if (t === 0) {
    pos = `画面顶部（从上边缘往下约 3% 处）有一行醒目的大号中文标题「${label}」，字高约占画面高度的 19%，几乎横跨整幅、水平居中`
  } else if (t === 1 && sub) {
    pos = `画面上部有两行中文标题：第一行「${main}」字高约占画面高度的 18%，第二行「${sub}」字高约占画面高度的 12%，两行都水平居中，第二行整体比第一行略窄`
  } else if (t === 1) {
    pos = `画面上部（从上边缘往下约 15% 处）有一行中文标题「${label}」，字高约占画面高度的 18%，水平居中`
  } else if (t === 2) {
    pos = `画面中部偏上（从上边缘往下约 28% 处）有一行中文标题「${label}」，字高约占画面高度的 16%，水平居中`
  } else if (t === 3 && sub) {
    pos = `画面上部有错落排列的中文标题：「${main}」字高约占画面高度的 20%、「${sub}」约占 13%，整体靠左对齐，占据画面左侧约 45% 宽度`
  } else {
    pos = `画面上部（从上边缘往下约 15% 处）有一行中文标题「${label}」，字高约占画面高度的 18%，水平居中`
  }

  const cols = [
    "圆润粗体，纯白色，配深蓝色粗描边和轻微阴影",
    sub ? "圆润粗体，第一行用亮橙色、第二行用浅蓝色，都配深蓝色粗描边" : "圆润粗体，亮橙色配深蓝色粗描边",
    "圆润粗体，深蓝色纯色平涂，不加描边",
    "圆润粗体，亮橙色配深绿色粗描边",
    "圆润粗体，深蓝色字配白色粗描边",
  ][c]
  const tl = tilt ? "，整行文字带约 6 度的轻微倾斜" : ""
  return `${STYLE}主体：${x.scene}${LEAVE}${pos}，${cols}${tl}。${TAIL}`
}

/** glm-image 出图，返回 PNG Buffer（0.1 元/次） */
async function genImage(x: Item): Promise<Buffer> {
  const prompt = buildPrompt(x)
  const res = await fetch(IMAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${zhipuKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: SIZE, watermark_enabled: false }),
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok) {
    // code 1301 = 内容审核拒绝：重试永远不会成功，必须改写 scene（school_sync 的教训）
    const code = json?.error?.code
    const msg = json?.error?.message ?? ""
    if (code === "1301") throw new Error(`CONTENT_FILTER: ${msg.slice(0, 120)}`)
    if (res.status === 429) throw new Error(`RATE_LIMIT`)
    throw new Error(`HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`)
  }
  const url = json?.data?.[0]?.url
  if (!url) throw new Error(`响应无图片：${JSON.stringify(json).slice(0, 200)}`)
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`下载图片失败 HTTP ${imgRes.status}`)
  return Buffer.from(await imgRes.arrayBuffer())
}

// ─── OCR 校验（与 school_sync / graded 同规则）──────────────────────────────
function norm(s: string): string {
  return s.replace(/[\s：:·•、,，。.！!？?\-—()（）\[\]【】《》"'“”]/g, "")
}

interface OcrLine {
  y0: number
  y1: number
  h: number
  x0: number
  x1: number
  conf: number
  text: string
}

function parseOcr(raw: string): OcrLine[] {
  const out: OcrLine[] = []
  for (const ln of raw.split("\n")) {
    const m = ln.match(
      /y=([\d.]+)\.\.([\d.]+) h=([\d.]+) x=([\d.]+)\.\.([\d.]+) w=([\d.]+)\s+conf=([\d.]+)\s+(.*)/,
    )
    if (m) {
      out.push({
        y0: parseFloat(m[1]), y1: parseFloat(m[2]), h: parseFloat(m[3]),
        x0: parseFloat(m[4]), x1: parseFloat(m[5]), conf: parseFloat(m[7]), text: m[8].trim(),
      })
    }
  }
  return out
}

function ocrLines(p: string): OcrLine[] {
  const raw = execFileSync(OCR_TOOL, [p], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  return parseOcr(raw)
}

/** 把上半部分放大后重新 OCR（school_sync 验证过的抗误读手段） */
async function ocrLinesZoom(p: string, scale = 2, top = 0.62): Promise<OcrLine[]> {
  const tmp = p.replace(/\.png$/, `_z${scale}.png`)
  await sharpLib(p)
    .rotate()
    .extract({ left: 0, top: 0, width: 1440, height: Math.round(960 * top) })
    .resize({ width: Math.round(1440 * scale), height: Math.round(960 * top * scale) })
    .png()
    .toFile(tmp)
  const raw = execFileSync(OCR_TOOL, [tmp], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  const lines = parseOcr(raw)
  for (const l of lines) {
    l.y0 = l.y0 * top
    l.y1 = l.y1 * top
    l.h = l.h * top
  }
  return lines
}

async function check(x: Item, png: string): Promise<{ verdict: string; reason: string; detail?: string }> {
  if (!fs.existsSync(png)) return { verdict: "fail", reason: "no_file" }
  const exp = norm(x.main! + (x.sub ?? ""))
  const alt = norm((x.sub ?? "") + x.main!)
  const judge = (lines: OcrLine[], tag = ""): { verdict: string; reason: string; detail?: string } => {
    const fl = lines.filter((l) => l.h >= 0.06 && norm(l.text).length >= 1)
    if (!fl.length) return { verdict: "fail", reason: "no_text" }
    const full = fl.map((l) => norm(l.text)).join("")
    if (!full.includes(exp) && !full.includes(alt)) {
      return { verdict: "fail", reason: "title_mismatch", detail: full.slice(0, 60) }
    }
    // 标题常被 OCR 拆成多行，判断方向是「行 ⊂ 标题」而非「标题 ⊂ 行」
    // （2026-10-13 graded 首跑踩坑：反着写会把两行式标题的每一行都判成杂字）
    const extra = fl.filter((l) => {
      const t = norm(l.text)
      return l.h >= 0.10 && t.length >= 2 && !exp.includes(t) && !alt.includes(t)
    })
    if (extra.length) return { verdict: "fail", reason: "stray_text", detail: extra.map((l) => l.text).join("|") }
    return { verdict: "pass", reason: tag }
  }
  const r = judge(ocrLines(png))
  if (r.verdict === "pass") return r
  try {
    const r2 = judge(await ocrLinesZoom(png, 2), "z2")
    if (r2.verdict === "pass") return r2
    const r3 = judge(await ocrLinesZoom(png, 3), "z3")
    return r3.verdict === "pass" ? r3 : r2
  } catch {
    return r
  }
}

// ─── 步骤 1：按名单拉取课程 ────────────────────────────────────────────────
function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function stepState() {
  const idsArg = argValue("ids")
  let onlyIds: Set<string> | null = null
  if (idsArg) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(idsArg), "utf8"))
    onlyIds = new Set(Array.isArray(raw) ? raw : raw.ids)
    console.log(`[state] 名单 ${onlyIds.size} 门`)
  }
  const conn = await createConnection(await dbUrl())
  const [rows] = await conn.execute(
    `SELECT id, title, sub_category_key FROM courses
      WHERE is_published = 1 AND category_key = ?
      ORDER BY sub_category_key IS NULL, sub_category_key, learner_count DESC`,
    [SLOT],
  )
  await conn.end()
  let list = rows as { id: string; title: string; sub_category_key: string | null }[]
  if (onlyIds) {
    const missing = [...onlyIds].filter((id) => !list.some((r) => r.id === id))
    if (missing.length) throw new Error(`名单里有 ${missing.length} 门不在架/不属于 exam_prep: ${missing.slice(0, 3).join(",")}`)
    list = list.filter((r) => onlyIds!.has(r.id))
  }

  let items: Item[] = list.map((c) => ({
    courseId: c.id,
    title: c.title.trim(),
    subCategoryKey: c.sub_category_key,
    slot: `exam_prep__${c.sub_category_key ?? "general"}`,
    main: seedMain(c.title.trim(), c.sub_category_key),
  }))

  // 保留已有 sub/scene/校验结果（脚本可反复跑，不重复烧钱）
  if (fs.existsSync(STATE_FILE)) {
    const old: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    const byId = new Map(old.map((o) => [o.courseId, o]))
    items = items.map((it) => {
      const o = byId.get(it.courseId)
      return o ? { ...o, ...it, main: it.main || o.main, sub: o.sub ?? it.sub, scene: o.scene ?? it.scene } : it
    })
  }

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))
  console.log(`[state] 应试考试本次处理 ${items.length} 门`)
  const dist = new Map<string, number>()
  for (const it of items) dist.set(it.main!, (dist.get(it.main!) ?? 0) + 1)
  console.log(`  主标题分布: ${[...dist.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`)
}

// ─── 步骤 2：DeepSeek 蒸馏副标题与场景 ──────────────────────────────────────
const DISTILL_SYSTEM = `你是英语应试课程封面的文案编辑。给定课程标题与考试类别，产出封面副标题（sub）和一句插画场景描述（scene）。主标题（main）已定，不要改。

要求：
- sub：0~10 个字，课程内容词，如「词汇精讲」「真题解析」「听力专项」「写作冲刺」「核心 1000 词」「冲分班」。课程就是整科综合课时返回空字符串。不要重复 main 的内容。
- scene：一句中文场景描述（30~60 字），用于应试英语课程封面插画。画面主体必须是中学生、大学生或成年学习者（绝不出现幼儿/小学生），在图书馆、自习室、教室或书桌前学习或思考，要包含人物动作，与课程内容呼应，各课程之间不同。绝对不能出现「书上的字」「黑板上的字」「写着字」；若出现书本/黑板/屏幕/试卷，必须明确说明是空白的。不要描述任何文字、字母、数字。

只输出 JSON 数组，每项 {"i": 序号, "sub": "...", "scene": "..."}，不要任何解释。`

async function distillBatch(batch: { i: number; item: Item }[]): Promise<Map<string, { sub: string; scene: string }>> {
  const items = batch.map((b) => ({
    i: b.i,
    title: b.item.title,
    exam: b.item.subCategoryKey,
    main_hint: b.item.main,
  }))
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${deepseekKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DISTILL_SYSTEM },
        { role: "user", content: JSON.stringify(items) },
      ],
    }),
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`)
  const text: string = json?.choices?.[0]?.message?.content ?? ""
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) throw new Error(`DeepSeek 未返回数组: ${text.slice(0, 120)}`)
  const arr = JSON.parse(m[0]) as { i: number; sub?: string; scene?: string }[]
  const out = new Map<string, { sub: string; scene: string }>()
  for (const g of arr) {
    const hit = batch.find((b) => b.i === g.i)
    if (!hit || !g.scene?.trim()) continue
    out.set(hit.item.courseId, { sub: (g.sub ?? "").trim(), scene: g.scene.trim() })
  }
  return out
}

async function stepDistill() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const todo = items.filter((i) => !i.scene)
  console.log(`[distill] 需要蒸馏 ${todo.length} 条`)
  const BATCH = 10
  let done = 0
  for (let s = 0; s < todo.length; s += BATCH) {
    const batch = todo.slice(s, s + BATCH).map((item, k) => ({ i: s + k, item }))
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const map = await distillBatch(batch)
        for (const b of batch) {
          const g = map.get(b.item.courseId)
          if (g) Object.assign(b.item, g)
        }
        break
      } catch (err) {
        if (attempt === 3) console.log(`  ✗ 第 ${s / BATCH + 1} 批放弃: ${(err as Error).message}`)
        else await sleep(3000)
      }
    }
    done += batch.length
    fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))
    process.stdout.write(`\r  进度 ${Math.min(done, todo.length)}/${todo.length}`)
  }
  console.log()
  const missing = items.filter((i) => !i.scene)
  console.log(`[distill] 就绪 scene: ${items.length - missing.length}/${items.length}`)
  if (missing.length) console.log(`  仍缺: ${missing.map((m) => m.title.slice(0, 18)).join(", ")}`)
}

// ─── 步骤 3：出图 + OCR 校验（≤3 轮）──────────────────────────────────────
async function stepImages() {
  fs.mkdirSync(PNG_DIR, { recursive: true })
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const missing = items.filter((i) => !i.main || !i.scene)
  if (missing.length) throw new Error(`还有 ${missing.length} 门没有 main/scene，先跑 --step=distill`)
  const limit = Number(argValue("limit") ?? 0)

  for (const it of items) {
    const png = path.join(PNG_DIR, `${it.courseId}.png`)
    if (it.verdict === "pass" && fs.existsSync(png)) it.verdict = "reuse"
  }

  // 上轮判失败的图先免费复检（OCR 是本地跑的，重生成要 0.1 元/张）
  let rechecked = 0
  for (const it of items) {
    if (it.verdict === "pass" || it.verdict === "reuse") continue
    const png = path.join(PNG_DIR, `${it.courseId}.png`)
    if (!fs.existsSync(png)) continue
    const v = await check(it, png)
    if (v.verdict === "pass") {
      it.verdict = "reuse"
      it.reason = `recheck:${v.reason}`
      rechecked++
      console.log(`  复检通过 ${it.title.slice(0, 24)}`)
    }
  }
  if (rechecked) fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))

  let used = items.reduce((s, i) => s + (i.gens ?? 0), 0)
  for (let rnd = 1; rnd <= 3; rnd++) {
    let pending = items.filter((i) => i.verdict !== "pass" && i.verdict !== "reuse")
    if (limit && pending.length > limit) pending = pending.slice(0, limit)
    if (!pending.length) { console.log(`=== 第 ${rnd} 轮：全部通过 ===`); break }
    console.log(`\n=== 第 ${rnd} 轮：${pending.length} 张待处理（已用 ${used} 张）===`)
    for (let i = 0; i < pending.length; i++) {
      const it = pending[i]
      const png = path.join(PNG_DIR, `${it.courseId}.png`)
      const t0 = Date.now()
      try {
        const buf = await genImage(it)
        fs.writeFileSync(png, buf)
        it.gens = (it.gens ?? 0) + 1
        used++
        await sleep(8000) // 串行节流
        const v = await check(it, png)
        it.verdict = v.verdict
        it.reason = v.reason
        console.log(`  ${i + 1}/${pending.length} ${v.verdict === "pass" ? "✓" : "✗"} ${it.title.slice(0, 22)} ${v.reason} ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  ${i + 1}/${pending.length} ✗ ${it.title.slice(0, 22)}: ${msg.slice(0, 80)}`)
        it.verdict = "fail"
        it.reason = msg.slice(0, 120)
        if (msg.includes("CONTENT_FILTER")) {
          it.scene = rewriteScene(it)
          console.log(`     场景已改写: ${it.scene}`)
        }
        if (msg.includes("RATE_LIMIT")) {
          console.log("    限流，等待 60s")
          await sleep(60_000)
        }
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))
    }
    if (limit) break
  }

  const pass = items.filter((i) => i.verdict === "pass" || i.verdict === "reuse").length
  console.log(`\n[images] 通过 ${pass}/${items.length}，累计生成 ${used} 张`)
}

/** 内容审核被拒时改写 scene（school_sync 的教训：1301 重试无效，必须改写文案）
 *  按 courseId 起始位置轮转，并跳过与当前 scene 相同的那句，保证每次重试都换新文案。 */
function rewriteScene(it: Item): string {
  const candidates = [
    "一名大学生在安静的图书馆长桌前翻阅摊开的书本，旁边放着背包和一杯饮品，周围是整齐的书架，光线柔和。",
    "一名中学生坐在明亮的窗边书桌前，双手捧着合上的书本思考，桌上放着笔袋和台灯，窗外是校园。",
    "两名成年学习者在自习室并肩复习，桌上摊着空白的笔记本，一人托腮思考，墙上挂着圆形挂钟。",
    "一名年轻人站在校园林荫道上，背着书包抬头看向远处的教学楼，手里抱着合上的书本，阳光透过树叶洒下。",
    "一名成年学习者坐在木质书桌前，双手交叠放在合上的书本上静静思考，桌上摆着一盏台灯和几只笔，室内光线温暖。",
  ]
  const start = Math.abs(h(it.courseId, "S", candidates.length))
  for (let k = 1; k <= candidates.length; k++) {
    const c = candidates[(start + k) % candidates.length]
    if (c !== it.scene) return c
  }
  return candidates[start]
}

// ─── 步骤 4：转码落盘 ─────────────────────────────────────────────────────
async function stepCompress(apply: boolean) {
  fs.mkdirSync(WEB_DIR, { recursive: true })
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  let ok = 0, bytesIn = 0, bytesOut = 0
  const rows: { id: string; title: string; file: string; kb: number }[] = []
  for (const it of items) {
    if (it.verdict !== "pass" && it.verdict !== "reuse") continue
    const png = path.join(PNG_DIR, `${it.courseId}.png`)
    if (!fs.existsSync(png)) continue
    const buf = await sharpLib(png).webp({ quality: 80, effort: 5 }).toBuffer()
    bytesIn += fs.statSync(png).size
    bytesOut += buf.length
    ok++
    const file = `/images/courses/${it.courseId}.webp`
    if (apply) fs.writeFileSync(path.join(WEB_DIR, path.basename(file)), buf)
    rows.push({ id: it.courseId, title: it.title, file, kb: Math.round(buf.length / 1024) })
  }
  console.log(`[compress] ${apply ? "已写入" : "dry-run"} ${ok} 张  ${(bytesIn / 1048576).toFixed(1)}MB → ${(bytesOut / 1048576).toFixed(1)}MB`)
  if (!apply) {
    for (const r of rows.slice(0, 5)) console.log(`  ${r.title.slice(0, 20).padEnd(22)} -> ${r.file} (${r.kb}KB)`)
    console.log("\n加 --apply 落盘并写库（会先 mysqldump 备份）")
  }
}

// ─── 步骤 5：备份 + 写库 ───────────────────────────────────────────────────
async function stepApply() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const rows: { id: string; file: string }[] = []
  for (const it of items) {
    if (it.verdict !== "pass" && it.verdict !== "reuse") continue
    const p = path.join(WEB_DIR, `${it.courseId}.webp`)
    if (!fs.existsSync(p)) throw new Error(`WebP 不存在: ${p}，先跑 --step=compress --apply`)
    rows.push({ id: it.courseId, file: `/images/courses/${it.courseId}.webp` })
  }
  if (!rows.length) throw new Error("没有通过的图，先跑 --step=images")

  const url = new URL(await dbUrl())
  const conn = await createConnection({
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  })

  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)
  const backup = path.join(BACKUP_DIR, `courses-before-exam-glm-${stamp}.sql`)
  console.log(`[backup] mysqldump -> ${path.relative(ROOT, backup)}`)
  const dump = execFileSync("mysqldump", [
    "-h", url.hostname, "-P", url.port || "3306",
    "-u", decodeURIComponent(url.username), `-p${decodeURIComponent(url.password)}`,
    "--single-transaction", "--no-tablespaces", "--skip-add-locks",
    url.pathname.replace(/^\//, ""), "courses",
  ], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 })
  fs.writeFileSync(backup, dump)
  const [[cnt]] = await conn.query("SELECT COUNT(*) n FROM courses") as any
  const backedUp = (dump.toString("utf8").match(/\),\(/g) ?? []).length + 1
  console.log(`[backup] ${(dump.length / 1024).toFixed(0)}KB，表内 ${cnt.n} 行，备份中约 ${backedUp} 行`)
  if (dump.length < 10_000) throw new Error("备份过小，中止")
  if (backedUp < cnt.n) throw new Error(`备份行数 ${backedUp} < 表行数 ${cnt.n}，疑似残缺，中止`)

  console.log(`[apply] 事务写入 ${rows.length} 行 cover_url…`)
  await conn.beginTransaction()
  try {
    for (const r of rows) {
      await conn.execute("UPDATE courses SET cover_url = ? WHERE id = ?", [r.file, r.id])
    }
    await conn.commit()
    console.log("[apply] 提交完成")
  } catch (e) {
    await conn.rollback()
    throw e
  }
  await conn.end()
}

// ─── 入口 ──────────────────────────────────────────────────────────────────
async function main() {
  const step = argValue("step") ?? "report"
  const apply = process.argv.includes("--apply")
  switch (step) {
    case "state": await stepState(); break
    case "distill": await stepDistill(); break
    case "images": await stepImages(); break
    case "compress": await stepCompress(apply); break
    case "apply": await stepApply(); break
    case "report": {
      const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
      const pass = items.filter((i) => i.verdict === "pass" || i.verdict === "reuse").length
      console.log(`[report] ${items.length} 门，通过 ${pass}，已生成 ${items.reduce((s, i) => s + (i.gens ?? 0), 0)} 张`)
      const bad = items.filter((i) => i.verdict && i.verdict !== "pass" && i.verdict !== "reuse")
      for (const b of bad) console.log(`  ✗ ${b.verdict} ${(b.reason ?? "").slice(0, 40)} | ${b.title.slice(0, 24)}`)
      break
    }
    default:
      console.error(`未知 --step=${step}（可用: state | distill | images | compress | apply | report）`)
      process.exit(1)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
