/**
 * 分级阅读（graded_reading）封面重做 —— glm-image 逐课专属封面。
 *
 * 用法：
 *   npx tsx scripts/gen-graded-covers.ts --step=state      # 拉取 49 门课，建状态文件
 *   npx tsx scripts/gen-graded-covers.ts --step=distill    # DeepSeek 蒸馏 main/sub/scene
 *   npx tsx scripts/gen-graded-covers.ts --step=images     # glm-image 出图 + OCR 校验（≤3 轮）
 *   npx tsx scripts/gen-graded-covers.ts --step=report     # 看进度
 *   npx tsx scripts/gen-graded-covers.ts --step=compress   # PNG → WebP 落 public/
 *   npx tsx scripts/gen-graded-covers.ts --step=apply --apply  # mysqldump 备份 + 写 cover_url
 *
 * ── 为什么复用 school_sync 这套（设计文档 §2）──────────────────────────────
 *
 * school_sync 194 门已在 10-11 日用同一管线全量重做（见 docs/julebu-cover-prompt-pack.md），
 * 需求方点名的「风格和中小学同步一致」= 同一套 STYLE 提示词 + 标题版式随机池 + OCR 校验，
 * 所以这里逐字复刻 /tmp/all194/gen_all.py 的结构，只改课程来源与标题蒸馏规则。
 *
 * ── 关键参数（与 school_sync 实测一致）──────────────────────────────────────
 *
 * 尺寸 1440*960（glm-image 要求长宽 ∈ [512,2048] 且为 32 的倍数），
 * watermark_enabled: false，串行节流 sleep 8s 避免触发限流。
 * OCR 校验：/tmp/ocrtool/ocr（Apple Vision），失败放大 2x/3x 复判，最多 3 轮重生成。
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { config as loadEnv } from "dotenv"
import { createConnection } from "mysql2/promise"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

const SLOT = "graded_reading"
const STATE_FILE = path.join(ROOT, ".covers-build", "graded-reading-state.json")
const PNG_DIR = path.join(ROOT, ".covers-build", "graded-reading")
const WEB_DIR = path.join(ROOT, "public", "images", "courses")
const BACKUP_DIR = path.join(ROOT, "db-backup")

// sharp 走 next 的 optionalDependency 锚点（见 gen-course-covers.ts 的说明）
const cwdRequire = createRequire(path.join(ROOT, "scripts", ".resolve-anchor.cjs"))
const nextRequire = createRequire(cwdRequire.resolve("next/package.json"))
const sharpLib = nextRequire("sharp") as typeof import("sharp")

// ─── 模型与参数（与 school_sync 完全一致）──────────────────────────────────
const IMAGE_URL = "https://open.bigmodel.cn/api/paas/v4/images/generations"
const CHAT_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
const IMAGE_MODEL = "glm-image"
const VISION_MODEL = "glm-4.6v-flash"
const SIZE = "1440x960"
const OCR_TOOL = "/tmp/ocrtool/ocr"

/** school_sync 全量生产的 STYLE 提示词（gen_all.py 逐字复刻） */
const STYLE =
  "儿童教育课程封面。扁平矢量插画风格，几何化圆润造型，平涂上色，边缘干净利落。" +
  "明亮鲜艳的高饱和度配色，互补色碰撞，画面饱满铺满整幅。" +
  "背景被具体的场景元素填满：楼房、树木、云朵、花草、栏杆、小物件、装饰花纹铺满画面每个角落，" +
  "几乎没有大片纯色或白色空白。"
const LEAVE = "画面中为标题文字留出一片相对简洁开阔的区域，该区域内的背景元素较少。"
const TAIL = "除上述标题外，画面中不出现任何其他文字、字母或数字。"

/** 系列名映射：sub_category_key → 封面主标题 */
const SERIES_MAIN: Record<string, string> = {
  oxford_reading_tree: "牛津树",
  raz: "RAZ",
  heinemann: "海尼曼",
  big_cat: "大猫",
  red_rocket: "红火箭",
  lets_go: "Let's Go",
  oxford_bookworm: "牛津书虫",
}

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

/** FNV-1a 32 位哈希，按 courseId 稳定选取版式/配色（与 school_sync 相同） */
function h(cid: string, salt: string, n: number): number {
  let x = 0x811c9dc5
  for (let i = 0; i < cid.length; i++) x = Math.imul(x ^ cid.charCodeAt(i), 0x01000193) >>> 0
  for (let i = 0; i < salt.length; i++) x = Math.imul(x ^ salt.charCodeAt(i), 0x01000193) >>> 0
  return x % n
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
    sub ? "圆润粗体，第一行用亮黄色、第二行用浅蓝色，都配深蓝色粗描边" : "圆润粗体，亮黄色配深绿色粗描边",
    "圆润粗体，深蓝色纯色平涂，不加描边",
    "圆润粗体，亮黄色配深绿色粗描边",
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

// ─── OCR 校验（与 school_sync 相同规则）───────────────────────────────────
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

function ocrLines(path: string): OcrLine[] {
  const raw = execFileSync(OCR_TOOL, [path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  return parseOcr(raw)
}

/** 把上半部分放大后重新 OCR（school_sync 验证过的抗误读手段） */
async function ocrLinesZoom(path: string, scale = 2, top = 0.62): Promise<OcrLine[]> {
  const tmp = path.replace(/\.png$/, `_z${scale}.png`)
  await sharpLib(path)
    .rotate()
    .extract({ left: 0, top: 0, width: 1440, height: Math.round(960 * top) })
    .resize({ width: Math.round(1440 * scale), height: Math.round(960 * top * scale) })
    .png()
    .toFile(tmp)
  const raw = execFileSync(OCR_TOOL, [tmp], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  const lines = parseOcr(raw)
  // 还原到原图坐标（纵向）：裁剪过 top 比例，y 坐标需要乘回 top
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
  const judge = (lines: OcrLine[], tag = ""): { verdict: string; reason: string } => {
    const fl = lines.filter((l) => l.h >= 0.06 && norm(l.text).length >= 1)
    if (!fl.length) return { verdict: "fail", reason: "no_text" }
    const full = fl.map((l) => norm(l.text)).join("")
    if (!full.includes(exp) && !full.includes(alt)) {
      return { verdict: "fail", reason: "title_mismatch", ...{} }
    }
    // 标题常被 OCR 拆成多行，判断方向是「行 ⊂ 标题」而非「标题 ⊂ 行」，
    // 否则两行式标题的每一行都会被当成杂字（2026-10-13 首跑即踩此坑）。
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

// ─── 步骤 1：拉取课程 ──────────────────────────────────────────────────────
async function stepState() {
  const conn = await createConnection(await dbUrl())
  const [rows] = await conn.execute(
    `SELECT id, title, sub_category_key FROM courses
      WHERE is_published = 1 AND category_key = ?
      ORDER BY sub_category_key IS NULL, sub_category_key, learner_count DESC`,
    [SLOT],
  )
  await conn.end()
  const list = rows as { id: string; title: string; sub_category_key: string | null }[]

  let items: Item[] = list.map((c) => ({
    courseId: c.id,
    title: c.title.trim(),
    subCategoryKey: c.sub_category_key,
    slot: `graded_reading__${c.sub_category_key ?? "general"}`,
  }))

  // 保留已有标题/场景/校验结果（脚本可反复跑，不重复烧钱）
  if (fs.existsSync(STATE_FILE)) {
    const old: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    const byId = new Map(old.map((o) => [o.courseId, o]))
    items = items.map((it) => ({ ...byId.get(it.courseId), ...it }))
  }

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))
  console.log(`[state] 分级阅读在架 ${items.length} 门`)
  const dist = new Map<string, number>()
  for (const it of items) dist.set(it.slot, (dist.get(it.slot) ?? 0) + 1)
  console.log(`  槽位分布: ${[...dist.entries()].map(([k, v]) => `${k.replace("graded_reading__", "")}=${v}`).join("  ")}`)
  console.log(`  已有 main: ${items.filter((i) => i.main).length}，已有 scene: ${items.filter((i) => i.scene).length}`)
}

// ─── 步骤 2：DeepSeek 蒸馏标题与场景 ────────────────────────────────────────
const DISTILL_SYSTEM = `你是英语课程封面的文案编辑。给定一门分级阅读课程，产出适合印在封面上的中文标题（主标题+副标题）和一句插画场景描述。

要求：
- main：2~7 个字，通常是系列名，如「牛津树」「RAZ」「海尼曼」「大猫」「红火箭」「Let's Go」「牛津书虫」。若课程不属于任何已知系列，用标题中的品牌/代号（如「RE」「粒粒」「分级阅读」）。
- sub：0~12 个字，级别、册次或主题，如「Level 2」「A-C 萌芽读者」「Band 1-2 自然拼读」「日常事物」「GK」。没有明确的级别/主题时返回空字符串。
- 不要出现「版版」「年纪」等错字；不要用生僻字；sub 不要重复 main 的内容。
- scene：一句中文场景描述（30~60 字），用于儿童分级阅读课程封面插画。必须包含人物动作，与课程级别/主题相关，与其他课程不同。绝对不能出现「书上的字」「黑板上的字」「写着字」；若出现书本/黑板/白板/屏幕，必须明确说明是空白。不要描述任何文字、字母、数字。

只输出 JSON 数组，每项 {"i": 序号, "main": "...", "sub": "...", "scene": "..."}，不要任何解释。`

async function distillBatch(batch: { i: number; item: Item }[], skipMain: boolean): Promise<Map<string, { main: string; sub: string; scene: string }>> {
  const items = batch.map((b) => ({
    i: b.i,
    title: b.item.title,
    sub_category: b.item.subCategoryKey,
    series_hint: b.item.subCategoryKey ? SERIES_MAIN[b.item.subCategoryKey] ?? "未知系列" : "无（从标题推断）",
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
  const m = text.match(/\[.*\]/s)
  if (!m) throw new Error(`DeepSeek 未返回 JSON 数组: ${text.slice(0, 120)}`)
  const arr = JSON.parse(m[0]) as { i: number; main: string; sub?: string; scene: string }[]
  const out = new Map<string, { main: string; sub: string; scene: string }>()
  for (const g of arr) {
    const hit = batch.find((b) => b.i === g.i)
    if (!hit) continue
    const main = (skipMain ? hit.item.main! : g.main?.trim()) || hit.item.main || "分级阅读"
    const sub = (g.sub ?? "").trim()
    const scene = g.scene?.trim()
    if (!scene) continue
    out.set(hit.item.courseId, { main, sub, scene })
  }
  return out
}

async function stepDistill() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const todo = items.filter((i) => !i.scene || !i.main)
  console.log(`[distill] 需要蒸馏 ${todo.length} 条（缺 scene 或 main）`)
  const BATCH = 10
  let done = 0
  for (let s = 0; s < todo.length; s += BATCH) {
    const batch = todo.slice(s, s + BATCH).map((item, k) => ({ i: s + k, item }))
    const skipMain = batch.every((b) => !!b.item.main)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const map = await distillBatch(batch, skipMain)
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
  console.log(`[distill] 就绪 main+sub+scene: ${items.filter((i) => i.main && i.scene).length}/${items.length}`)
  const missing = items.filter((i) => !i.main || !i.scene)
  if (missing.length) console.log(`  仍缺 ${missing.length} 条: ${missing.map((m) => m.title.slice(0, 20)).join(", ")}`)
}

// ─── 步骤 3：出图 + OCR 校验（≤3 轮）──────────────────────────────────────
async function stepImages() {
  fs.mkdirSync(PNG_DIR, { recursive: true })
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const missing = items.filter((i) => !i.main || !i.scene)
  if (missing.length) throw new Error(`还有 ${missing.length} 门没有 main/scene，先跑 --step=distill`)

  for (const it of items) {
    const png = path.join(PNG_DIR, `${it.courseId}.png`)
    const good = it.verdict === "pass" && fs.existsSync(png)
    if (good) it.verdict = "reuse"
  }

  // 上轮判失败的图先免费复检（OCR 是本地跑的，重生成要 0.1 元/张），
  // Vision OCR 偶发误读不应直接烧配额重跑。
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
    const pending = items.filter((i) => i.verdict !== "pass" && i.verdict !== "reuse")
    if (!pending.length) { console.log(`=== 第 ${rnd} 轮：全部通过 ===`); break }
    console.log(`\n=== 第 ${rnd} 轮：${pending.length} 张待处理（已用 ${used} 张）===`)
    for (let i = 0; i < pending.length; i++) {
      const it = pending[i]
      const png = path.join(PNG_DIR, `${it.courseId}.png`)
      const t0 = Date.now()
      // 上轮失败若因内容审核，scene 已改写（见 retryScene 调用点）；否则直接重跑
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
  }

  const pass = items.filter((i) => i.verdict === "pass").length
  console.log(`\n[images] 通过 ${pass}/${items.length}，累计生成 ${used} 张`)
}

/** 内容审核被拒时改写 scene（school_sync 的 161 号教训：1301 重试无效，必须改写文案） */
function rewriteScene(it: Item): string {
  const sub = it.subCategoryKey ? SERIES_MAIN[it.subCategoryKey] ?? "分级阅读" : "分级阅读"
  const theme = it.title.replace(/[【】\（）：:]/g, " ").trim().slice(0, 12)
  const candidates = [
    `${sub}主题课程封面：一名学生坐在明亮窗边的书桌前，桌上有合上的书本和一杯饮品，窗台上摆着小盆栽，画面温暖。`,
    `${sub}主题课程封面：两名学生在安静的图书馆里并肩阅读，周围是整齐的书架，光线柔和。`,
    `${sub}主题课程封面：一名学生站在校园里的树下，双手抱着合上的书本，微笑看向前方。`,
    `${sub}主题课程封面：一名学生在公园长椅上摊开合上的笔记本，旁边放着一支笔，阳光透过树叶洒下。`,
  ]
  return candidates[Math.abs(h(it.courseId, "S", 4))]
}

// ─── 步骤 4：转码落盘 ─────────────────────────────────────────────────────
async function stepCompress(apply: boolean) {
  fs.mkdirSync(WEB_DIR, { recursive: true })
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  let ok = 0, bytesIn = 0, bytesOut = 0
  const rows: { id: string; title: string; file: string; kb: number }[] = []
  for (const it of items) {
    // reuse = 免费复检通过的历史 PNG，与 pass 同等有效，压缩/写库都必须包含
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
    // reuse = 免费复检通过的历史 PNG，与 pass 同等有效，压缩/写库都必须包含
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
  const backup = path.join(BACKUP_DIR, `courses-before-graded-glm-${stamp}.sql`)
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
  const [[chk]] = await conn.query(
    `SELECT COUNT(*) total, SUM(cover_url IS NOT NULL AND cover_url <> '') with_cover
       FROM courses WHERE is_published = 1 AND category_key = ?`,
    [SLOT],
  ) as any
  console.log(`[verify] 分级阅读在架 ${chk.total} 门，有封面 ${chk.with_cover} 门`)
  await conn.end()
}

// ─── 入口 ──────────────────────────────────────────────────────────────────
function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

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
      const pass = items.filter((i) => i.verdict === "pass").length
      console.log(`[report] ${items.length} 门，通过 ${pass}，已生成 ${items.reduce((s, i) => s + (i.gens ?? 0), 0)} 张`)
      const done = items.filter((i) => i.verdict === "pass")
      for (const d of done) console.log(`  ✓ ${d.main}${d.sub ? " / " + d.sub : ""}  <-  ${d.title.slice(0, 24)}`)
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