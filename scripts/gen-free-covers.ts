/**
 * 用阿里云免费额度给「最显眼的色卡课」补专属图。
 *
 * 用法：
 *   npx tsx scripts/gen-free-covers.ts                 # dry-run：列出将处理的课程与场景
 *   npx tsx scripts/gen-free-covers.ts --step=scenes   # DeepSeek 生成场景描述
 *   npx tsx scripts/gen-free-covers.ts --step=images   # 调 qwen-image-3.0 出图（消耗免费额度）
 *   npx tsx scripts/gen-free-covers.ts --step=compress # PNG → WebP
 *   npx tsx scripts/gen-free-covers.ts --apply         # 备份后写 cover_url
 *
 * ── 为什么是这两件事 ────────────────────────────────────────────────────────
 *
 * 阿里云免费的「视觉模型」里，真正能文生图的只有 `qwen-image-3.0` 与 `-pro`，
 * **各 10 张，合计 20 张**。另外那些用不了：
 *   - `qwen-mt-image-2.0`（100 张）是**图片翻译**：输入图 → 输出图，不生成画面；
 *   - `wan3.0-video` / `-prime`（各 30 张）是**视频**模型。
 * 所以「用免费额度把剩余色卡做完」在数量上不成立（剩 484 门），
 * 但把 20 张花在**学员最多的 20 门**上是划算的 —— 那是课程广场第一屏的位置。
 *
 * ── 为什么单独一个脚本 ──────────────────────────────────────────────────────
 *
 * `gen-textbook-covers.ts` 是「按分类整块做」，这个是「按可见度挑着做」，
 * 两者的选课逻辑与模型都不同（万相 vs qwen-image）。共用的话会变成一堆 if。
 */

import fs from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { createRequire } from "node:module"
import { config as loadEnv } from "dotenv"
import { createConnection } from "mysql2/promise"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

const STATE_FILE = path.join(ROOT, ".covers-build", "free-covers.json")
const PNG_DIR = path.join(ROOT, ".covers-build", "free")
const WEB_DIR = path.join(ROOT, "public", "images", "courses")

const cwdRequire = createRequire(path.join(ROOT, "scripts", ".resolve-anchor.cjs"))
const sharp = createRequire(cwdRequire.resolve("next/package.json"))("sharp") as typeof import("sharp")

/** 免费额度上限：qwen-image-3.0 与 -pro 各 10 张 */
const QUOTA = 10

const BLANK_SURFACES =
  "画面中的纸张、书本、笔记本、试卷、白板、黑板、卡片、屏幕、积木一律为空白或只有无法辨认的抽象横线，" +
  "不出现任何可辨识的文字、字母、数字或符号"

const NEG_BASE =
  "文字, 汉字, 英文字母, 字母, 单词, 标题, 招牌, 站牌, 板书, 白板上的文字, 卡片文字, 手写字, 乱码, " +
  "水印, 签名, 印章, 落款, logo, 商标, 二维码, 多余手指, 畸形, 变形的手, 肢体错位, 低分辨率, 模糊, 噪点"

/** 与教材同步那批一致的 8 种风格，逐课轮换 */
const STYLES: Record<string, { name: string; lead: string; hold: string; subjectNote?: string }> = {
  flat: {
    name: "扁平矢量插画",
    lead: "扁平矢量插画风格，克制的几何形状，大面积纯色块，边缘干净利落，无描边、无渐变。配色：深蓝灰底，砖红与暖橙做强调，点缀米白",
    hold: "整体保持扁平矢量质感与上述配色，纯色块面，不要描边、不要线稿",
  },
  water: {
    name: "水彩手绘",
    lead: "水彩手绘风格，湿画法晕染，明显的粗纹水彩纸质感，笔触松弛，温暖治愈的绘本插画质感。配色：莫兰迪暖调",
    hold: "整体保持水彩手绘质感与上述配色，纸纹清晰可见",
  },
  comic: {
    name: "粗描边漫画",
    lead: "美式漫画插画风格，清晰有力的黑色粗描边，平涂上色，轻微网点质感。配色：暖黄与青蓝对比，米白背景",
    hold: "整体保持漫画描边质感与上述配色，描边粗而肯定",
  },
  papercut: {
    name: "剪纸拼贴",
    lead: "剪纸拼贴风格，多层纸片叠出立体层次，边缘有纸张裁切的手工感，投影清晰。配色：暖米黄纸底，砖红、芥末黄与深青",
    hold: "整体保持剪纸拼贴质感与上述配色。不要画框、不要相框、不要舷窗、不要圆形取景框、不要内嵌小图",
  },
  gouache: {
    name: "水粉厚涂",
    lead: "水粉厚涂插画风格，饱和柔和的笔触，颜料叠加的厚重质感，纸质底纹。配色：珊瑚橙、暖黄与湖蓝，深墨绿做暗部",
    hold: "整体保持水粉厚涂质感与上述配色，笔触可见",
  },
  duotone: {
    name: "双色调丝网印",
    lead: "双色调丝网印刷风格，只用两种专色叠印，粗颗粒质感，大面积负空间，图形化处理。配色：深邃藏蓝与明亮橘黄双色",
    hold: "整体严格保持上述两种专色的双色调，不要出现第三种颜色",
  },
  photo: {
    name: "写实摄影",
    lead: "写实摄影风格，35mm 定焦镜头，柔和自然光与浅景深，真实材质与皮肤质感，低饱和度胶片色彩",
    hold: "整体保持写实摄影质感，不要插画化",
    subjectNote: "人物为亚洲面孔的师生或年轻人",
  },
  foreigner: {
    name: "写实外国人",
    lead: "写实摄影风格，画面中的人物为西方（欧美）面孔的外国人，35mm 定焦镜头，柔和自然光与浅景深，真实的皮肤与材质质感",
    hold: "整体保持写实摄影质感，人物始终是欧美面孔的外国人，不要插画化",
    subjectNote: "人物必须是西方（欧美）面孔的外国人；场景偏国际化与生活化",
  },
}

const STYLE_CYCLE = ["comic", "foreigner", "gouache", "photo", "flat", "duotone", "water", "papercut"]

const COMPOSITIONS = [
  "中景，人物或主体占据画面中心较大面积，环境交代清楚",
  "近景，人物上半身或主体局部入画，背景略微虚化",
  "全景，人物与环境一起入画，视野开阔",
]

interface Item {
  courseId: string
  title: string
  categoryKey: string | null
  learners: number
  style: string
  /** qwen-image-3.0 或 qwen-image-3.0-pro */
  model: string
  scene?: string
}

function fun() {
  const m = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^DATABASE_URL=(.+)$/m)
  if (!m) throw new Error("找不到 DATABASE_URL")
  return m[1].trim()
}

function buildPrompt(style: string, scene: string, idx: number): string {
  const s = STYLES[style]
  return (
    `${s.lead}。画面内容：${scene}。` +
    `${COMPOSITIONS[idx % COMPOSITIONS.length]}，画面铺满整幅，主体占据画面主要面积，四周留出余量。` +
    `${BLANK_SURFACES}。${s.hold}。`
  )
}

// ─── 选课：色卡课里学员最多的 N 门 ──────────────────────────────────────────
async function buildState() {
  const conn = await createConnection(fun())
  // LIMIT 直接内联：mysql2 的 execute()（预处理语句）不接受 LIMIT 传参，
  // 会抛 "Incorrect arguments to mysqld_stmt_execute"。这里是内部常量，无注入风险。
  const limit = QUOTA * 2
  const [rows] = await conn.query(
    `SELECT id, title, category_key, learner_count
       FROM courses
      WHERE is_published = 1 AND (cover_url IS NULL OR cover_url = '')
      ORDER BY learner_count DESC, created_at DESC
      LIMIT ${limit}`,
  )
  await conn.end()

  const list = rows as { id: string; title: string; category_key: string | null; learner_count: number }[]
  const items: Item[] = list.map((c, i) => ({
    courseId: c.id,
    title: c.title,
    categoryKey: c.category_key,
    learners: c.learner_count,
    style: STYLE_CYCLE[i % STYLE_CYCLE.length],
    // 前 10 张用 pro（质量更好），后 10 张用普通版 —— 两个额度各 10 张，都用上
    model: i < QUOTA ? "qwen-image-3.0-pro" : "qwen-image-3.0",
  }))

  // 保留已生成的场景描述
  if (fs.existsSync(STATE_FILE)) {
    const old: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    const byId = new Map(old.filter((o) => o.scene).map((o) => [o.courseId, o.scene!]))
    for (const it of items) if (byId.has(it.courseId)) it.scene = byId.get(it.courseId)
  }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))

  console.log(`[state] 选出 ${items.length} 门「学员最多的色卡课」`)
  for (const it of items) {
    console.log(`  ${String(it.learners).padStart(5)} 人  ${it.model.replace("qwen-image-3.0", "qwen3")}  ${STYLES[it.style].name.padEnd(6)}  ${it.title}`)
  }
}

// ─── 场景描述 ──────────────────────────────────────────────────────────────
const SCENE_SYSTEM = `你是英语课程封面插画的分镜师。为给定的英语课程写一句画面描述（中文，25~40字），供 AI 生成封面插画。

必须遵守：
1. 只描述**可视的场景**，不要提课程名里的单词、字母、书名、知识点名称
2. 禁止「有人正在使用文字载体」的动作：不要在黑板/白板上写字或讲解、不要用单词卡片、不要翻词典内页、不要做试卷、不要记笔记
3. 纸张、书本、白板、屏幕、积木只能写「合上的」「收起的」或「空白的」
4. 人物 1~3 个，要有明确动作（交谈、倾听、手指着、递给、抬头看、并肩走…）
5. 场景贴合课程主题与目标人群
6. 不要用抽象比喻，不要出现品牌、商标、真人姓名
7. **严格遵守每门课后面括号里的「出镜人物」要求**

只输出 JSON 数组，不要解释、不要代码块标记：[{"id":"课程id","scene":"画面描述"}]`

const RISKY = ["写字", "书写", "板书", "白板上", "黑板上", "卡片", "试卷", "练习册", "记笔记", "单词", "字母", "积木", "方块"]

async function stepScenes() {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error("找不到 DEEPSEEK_API_KEY")
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const todo = items.filter((i) => !i.scene)
  console.log(`[scenes] 需要生成 ${todo.length} 条`)
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10)
    const user = batch
      .map((b) => `- id=${b.courseId}｜课程名：${b.title}｜出镜人物：${STYLES[b.style].subjectNote ?? "1~3 个与课程年龄相称的人"}`)
      .join("\n")
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-flash",
        temperature: 0.9,
        messages: [
          { role: "system", content: SCENE_SYSTEM },
          { role: "user", content: `为下面 ${batch.length} 门课各写一句画面描述：\n${user}` },
        ],
      }),
    })
    const json: any = await res.json().catch(() => null)
    if (!res.ok) {
      console.log(`  ✗ DeepSeek HTTP ${res.status}`)
      continue
    }
    const text: string = json?.choices?.[0]?.message?.content ?? ""
    const s = text.indexOf("["), e = text.lastIndexOf("]")
    if (s < 0 || e < 0) continue
    const arr = JSON.parse(text.slice(s, e + 1)) as { id: string; scene: string }[]
    const map = new Map(arr.map((x) => [x.id, x.scene]))
    for (const b of batch) {
      const sc = map.get(b.courseId)
      if (!sc) continue
      const bad = RISKY.filter((w) => sc.includes(w))
      if (bad.length) {
        console.log(`  ⚠ 丢弃（含高危词 ${bad.join("/")}）：${b.title.slice(0, 18)}`)
        continue
      }
      b.scene = sc
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))
  }
  console.log(`[scenes] 就绪 ${items.filter((i) => i.scene).length}/${items.length}`)
  for (const it of items) if (it.scene) console.log(`  ${it.title.slice(0, 20).padEnd(22)} ${it.scene}`)
}

// ─── 出图（qwen-image-3.0，multimodal-generation 端点）─────────────────────
async function genOne(item: Item, idx: number): Promise<Buffer> {
  const key = process.env.DASHSCOPE_API_KEY?.trim()
  if (!key) throw new Error("找不到 DASHSCOPE_API_KEY")
  const res = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: item.model,
        input: { messages: [{ role: "user", content: [{ text: buildPrompt(item.style, item.scene!, idx) }] }] },
        // 1664*1104 是 3:2，与卡片比例一致；prompt_extend 关掉避免改写提示词导致风格漂移
        parameters: { size: "1664*1104", n: 1, prompt_extend: false, watermark: false },
      }),
    },
  )
  const json: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
  const img = json?.output?.choices?.[0]?.message?.content?.find((c: any) => c.image)?.image
  if (!img) throw new Error(`响应里没有图片：${JSON.stringify(json).slice(0, 300)}`)
  const buf = Buffer.from(await (await fetch(img)).arrayBuffer())
  return buf
}

async function stepImages() {
  fs.mkdirSync(PNG_DIR, { recursive: true })
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const missingScene = items.filter((i) => !i.scene)
  if (missingScene.length) throw new Error(`还有 ${missingScene.length} 条没有场景描述，先跑 --step=scenes`)

  const todo = items.filter((i) => !fs.existsSync(path.join(PNG_DIR, `${i.courseId}.png`)))
  console.log(`[images] 共 ${items.length} 张，本次生成 ${todo.length} 张（走免费额度）`)

  let ok = 0
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i]
    const label = `${item.model.replace("qwen-image-3.0", "qwen3")} ${STYLES[item.style].name} ${item.title.slice(0, 16)}`
    const t0 = Date.now()
    try {
      const buf = await genOne(item, i)
      // qwen 返回的是 png 或 jpeg，统一按实际格式存，压缩阶段交给 sharp
      fs.writeFileSync(path.join(PNG_DIR, `${item.courseId}.png`), buf)
      ok++
      console.log(`  ✓ ${label} (${i + 1}/${todo.length})  ${(buf.length / 1024).toFixed(0)}KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e)
      console.log(`  ✗ ${label}\n      ${msg}`)
      // 额度类错误直接停，别把剩下几张各失败一遍
      if (/Arrearage|QuotaExhausted|quota|额度|balance/i.test(msg)) {
        console.log("\n[images] 判定为额度问题，终止")
        break
      }
    }
  }
  console.log(`\n[images] 成功 ${ok}，累计 ${items.filter((i) => fs.existsSync(path.join(PNG_DIR, `${i.courseId}.png`))).length}/${items.length}`)
}

async function stepCompress() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  let ok = 0
  for (const it of items) {
    const png = path.join(PNG_DIR, `${it.courseId}.png`)
    if (!fs.existsSync(png)) continue
    const buf = await sharp(png).webp({ quality: 80, effort: 5 }).toBuffer()
    fs.writeFileSync(path.join(WEB_DIR, `${it.courseId}.webp`), buf)
    ok++
  }
  console.log(`[compress] 转码 ${ok}/${items.length}`)
}

async function stepReport() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const png = items.filter((i) => fs.existsSync(path.join(PNG_DIR, `${i.courseId}.png`))).length
  const webp = items.filter((i) => fs.existsSync(path.join(WEB_DIR, `${i.courseId}.webp`))).length
  console.log(`[report] 计划 ${items.length} 张｜PNG ${png}｜WebP ${webp}｜场景 ${items.filter((i) => i.scene).length}`)
}


/**
 * 写 cover_url。写库前必须 mysqldump 备份 —— 生产库就是唯一的库。
 */
async function stepApply(apply: boolean) {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const ready = items.filter((i) => fs.existsSync(path.join(WEB_DIR, `${i.courseId}.webp`)))
  if (!ready.length) throw new Error("还没有任何 WebP 成品，先跑 --step=compress")

  console.log(`将写入 ${ready.length} 行 cover_url`)
  if (!apply) {
    for (const r of ready.slice(0, 8)) console.log(`  ${r.title.slice(0, 22).padEnd(24)} → /images/courses/${r.courseId}.webp`)
    console.log("（dry-run）加 --apply 写库")
    return
  }

  const url = new URL(fun())
  const backupDir = path.join(ROOT, "db-backup")
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)
  const backup = path.join(backupDir, `courses-before-free-covers-${stamp}.sql`)
  const args = [
    "-h", url.hostname, "-P", url.port || "3306",
    "-u", decodeURIComponent(url.username), `-p${decodeURIComponent(url.password)}`,
    "--single-transaction", "--no-tablespaces", "--skip-add-locks",
    url.pathname.replace(/^\//, ""), "courses",
  ]
  const dump = execFileSync("mysqldump", args, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 })
  fs.writeFileSync(backup, dump)
  const rows = (dump.toString("utf8").match(/\),\n?\(/g) ?? []).length + 1
  console.log(`[backup] ${(dump.length / 1024).toFixed(0)}KB，数据行数约 ${rows} → ${path.relative(ROOT, backup)}`)
  if (dump.length < 10_000 || rows < 100) throw new Error("备份疑似残缺，已中止")

  const conn = await createConnection(fun())
  await conn.beginTransaction()
  try {
    for (const r of ready) {
      await conn.execute("UPDATE courses SET cover_url = ? WHERE id = ?", [`/images/courses/${r.courseId}.webp`, r.courseId])
    }
    await conn.commit()
    console.log(`[apply] 已写入 ${ready.length} 行`)
  } catch (e) {
    await conn.rollback()
    throw e
  }
  const [[check]]: any = await conn.execute(
    "SELECT COUNT(*) total, SUM(cover_url IS NOT NULL AND cover_url <> '') with_cover FROM courses WHERE is_published = 1",
  )
  console.log(`[verify] 在架 ${check.total}，已有 cover_url ${check.with_cover}`)
  await conn.end()
}

async function main() {
  const step = process.argv.find((a) => a.startsWith("--step="))?.slice(7) ?? "state"
  switch (step) {
    case "state": await buildState(); break
    case "scenes": await stepScenes(); break
    case "images": await stepImages(); break
    case "compress": await stepCompress(); break
    case "apply": await stepApply(process.argv.includes("--apply")); break
    case "report": await stepReport(); break
    default:
      console.error(`未知 --step=${step}（state | scenes | images | compress | apply | report）`)
      process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1) })
