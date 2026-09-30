/**
 * 教材同步（school_sync）逐课封面流水线。
 *
 * 用法：
 *   npx tsx scripts/gen-textbook-covers.ts                    # dry-run：只产出计划，不调图像 API
 *   npx tsx scripts/gen-textbook-covers.ts --step=scenes      # 用 DeepSeek 为新课生成场景描述
 *   npx tsx scripts/gen-textbook-covers.ts --step=images      # 按计划调万相出图（花钱）
 *   npx tsx scripts/gen-textbook-covers.ts --step=report      # 看进度
 *
 * ── 这个脚本解决什么问题 ────────────────────────────────────────────────────
 *
 * 之前的封面是「主题图共用」：12 个 school_sync 槽位 × 3 风格 = 36 张图服务 194 门课，
 * 最惨的一张被 15 门课共用 —— 用户点进「三年级」会连看十几张同一张公交站。
 *
 * 现在改成**逐课专属图**：每门课一张自己的图（写在 courses.cover_url 上）。
 * 已有的 36 张不浪费 —— 它们被 1:1 分给 36 门课，剩下的课新生成。
 *
 * ── 为什么场景描述要用大模型写 ──────────────────────────────────────────────
 *
 * 实测 774 门课里只有 6.8% 的标题含可视场景（「IELTS-雅思词汇真经」这类只能靠编），
 * 所以新生成的课需要 LLM 把标题翻译成画面。但**必须约束**：早先的教训是
 * 「有人在使用文字载体」的场景（黑板讲解、单词卡片、做试卷）会生成整片乱码文字。
 *
 * ── 风格分配 ────────────────────────────────────────────────────────────────
 *
 * 同一槽位（年级）内按课程顺序在 7 种风格里轮换 —— 这样逐课不重复，
 * **而且**同一屏列表里风格是交替的（这是「不要单调」的另一半）。
 */

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { config as loadEnv } from "dotenv"
import { createConnection } from "mysql2/promise"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

const PLAN_FILE = path.join(ROOT, ".covers-build", "textbook-plan.json")
const PNG_DIR = path.join(ROOT, ".covers-build", "textbook")
const WEB_DIR = path.join(ROOT, "public", "images", "courses")
const EXISTING_DIR = path.join(ROOT, "public", "images", "courses")

const cwdRequire = createRequire(path.join(ROOT, "scripts", ".resolve-anchor.cjs"))
const sharp = createRequire(cwdRequire.resolve("next/package.json"))("sharp") as typeof import("sharp")

// ─── 7 种风格（都已出样验证过）────────────────────────────────────────────
type StyleKey = "flat" | "water" | "comic" | "papercut" | "gouache" | "duotone" | "photo" | "foreigner"

interface StyleDef {
  name: string
  lead: string
  hold: string
  negExtra: string
  /**
   * 对「画面里是谁」的额外约束，会一并交给 DeepSeek 写场景。
   *
   * 为什么需要：场景描述与风格是两段独立文本，如果场景说「两个小学生在教室」而风格要求
   * 「西方成年人」，模型会得到互相矛盾的指令。所以写场景时就必须知道这一张要谁出镜。
   */
  subjectNote?: string
}

const BLANK_SURFACES =
  "画面中的纸张、书本、笔记本、试卷、白板、黑板、卡片、屏幕、积木、方块一律为空白或只有无法辨认的抽象横线或纯色，" +
  "不出现任何可辨识的文字、字母、数字或符号"

const NEG_BASE =
  "文字, 汉字, 英文字母, 字母, 单词, 标题, 招牌, 站牌, 板书, 白板上的文字, 卡片文字, 手写字, 草书, " +
  "花体字母, 乱码, 水印, 签名, 印章, 落款, 作者署名, logo, 商标, 二维码, 棋盘格, " +
  "字母积木, 积木上的字母, 拼字块, 骰子字母, 数字方块, " +
  "多余手指, 畸形, 变形的手, 肢体错位, 双头, 多余肢体, 低分辨率, 模糊, 噪点, 过曝, 边框, 拼贴"

/** 画框类负向词 —— 剪纸风格第一版把场景塞进了「舷窗」，这是那次的修复 */
const NEG_FRAME = "画框, 相框, 舷窗, 圆形取景框, 拱形取景框, 内嵌小图, 拼贴相框, 画中画, 白边, 留白边框"

const STYLES: Record<StyleKey, StyleDef> = {
  flat: {
    name: "扁平矢量插画",
    lead: "扁平矢量插画风格，克制的几何形状，大面积纯色块，边缘干净利落，无描边、无渐变、无噪点。配色：深蓝灰作为主体底色，砖红与暖橙作为强调色，点缀少量米白",
    hold: "整体保持扁平矢量质感与上述配色，纯色块面，不要描边、不要线稿、不要冷调单色",
    negExtra: "写实摄影, 3D渲染, 描边, 线稿, 水彩, 漫画",
  },
  water: {
    name: "水彩手绘",
    lead: "水彩手绘风格，湿画法水彩晕染，明显的粗纹水彩纸质感，笔触松弛，温暖治愈的绘本插画质感。配色：莫兰迪暖调，主色草木绿与米黄，暖砖红与淡粉点缀",
    hold: "整体保持水彩手绘质感与上述配色，纸纹清晰可见",
    negExtra: "动漫风格, 平涂上色, 矢量插画, 扁平色块, 写实摄影, 彩铅, 铅笔素描",
  },
  comic: {
    name: "粗描边漫画",
    lead: "美式漫画插画风格，清晰有力的黑色粗描边，平涂上色，干净的轮廓线，轻微的网点质感。配色：暖黄与青蓝的对比，米白背景",
    hold: "整体保持漫画描边质感与上述配色，描边粗而肯定",
    negExtra: "写实摄影, 3D渲染, 无描边, 扁平色块, 水彩",
  },
  papercut: {
    name: "剪纸拼贴",
    lead: "剪纸拼贴风格，多层纸片叠出立体层次，边缘有纸张裁切的手工感，表面有细微纸纹，投影清晰。配色：暖米黄纸底，砖红、芥末黄与深青的纸片",
    hold: "整体保持剪纸拼贴质感与上述配色，层次分明。不要画框、不要相框、不要舷窗、不要圆形或拱形取景框、不要内嵌小图、不要拼贴相框",
    negExtra: `写实摄影, 3D渲染, 光滑渐变, 矢量插画, 描边线稿, ${NEG_FRAME}`,
  },
  gouache: {
    name: "水粉厚涂",
    lead: "水粉厚涂插画风格，饱和而柔和的笔触，颜料叠加的厚重质感，边缘柔和不锐利，纸质底纹。配色：明亮的珊瑚橙、暖黄与湖蓝，深墨绿做暗部",
    hold: "整体保持水粉厚涂质感与上述配色，笔触可见",
    negExtra: "写实摄影, 3D渲染, 矢量插画, 细描边线条, 水彩晕染",
  },
  duotone: {
    name: "双色调丝网印",
    lead: "双色调丝网印刷风格，只用两种专色叠印，粗颗粒质感，大面积负空间，图形化处理，极简而醒目。配色：深邃藏蓝与明亮橘黄双色",
    hold: "整体严格保持上述两种专色的双色调，不要出现第三种颜色",
    negExtra: "写实摄影, 3D渲染, 多色, 彩虹色, 渐变, 水彩, 厚涂",
  },
  photo: {
    name: "写实摄影",
    lead: "写实摄影风格，35mm 定焦镜头，柔和的自然光与浅景深，真实的材质与皮肤质感，低饱和度胶片色彩。画面干净、构图克制",
    hold: "整体保持写实摄影质感与上述色调，不要插画化",
    negExtra: "插画, 卡通, 3D渲染, 矢量, 水彩, 描边, 夸张比例",
    subjectNote: "人物为亚洲面孔的师生或年轻人，贴近国内用户的日常校园与生活场景",
  },
  foreigner: {
    name: "写实外国人",
    lead: "写实摄影风格，画面中的人物为西方（欧美）面孔的外国人，具有典型的欧美面部轮廓与自然发色，35mm 定焦镜头，柔和的自然光与浅景深，真实的皮肤与材质质感，低饱和度纪实色彩",
    // 外国人风格是这个产品里「母语者 / 目标文化」的视觉代表，所以场景要偏国际化
    hold: "整体保持写实摄影质感与上述色调，人物始终是欧美面孔的外国人，不要插画化",
    negExtra: "插画, 卡通, 3D渲染, 矢量, 水彩, 描边, 夸张比例, 亚洲面孔, 动漫脸, 人造感",
    subjectNote:
      "人物必须是**西方（欧美）面孔的外国人**（如外教、外国学生、外国朋友、外国同事）；" +
      "场景偏国际化与生活化（咖啡馆、公园、图书馆、开放式办公室、街边书店、家中客厅）",
  },
}

/** 轮换顺序：让相邻课程风格不同，且同一槽位内七种都用到 */
const STYLE_CYCLE: StyleKey[] = [
  "comic", "foreigner", "gouache", "photo", "flat", "duotone", "water", "papercut",
]

/** 构图变体：按课程序号轮换，避免「同一风格下构图雷同」 */
const COMPOSITIONS = [
  "中景，人物或主体占据画面中心较大面积，环境交代清楚",
  "近景，人物上半身或主体局部入画，背景略微虚化",
  "全景，人物与环境一起入画，视野开阔",
]

function buildPrompt(style: StyleKey, scene: string, idx: number): string {
  const s = STYLES[style]
  return (
    `${s.lead}。` +
    `画面内容：${scene}。` +
    `${COMPOSITIONS[idx % COMPOSITIONS.length]}，画面铺满整幅，主体占据画面主要面积，` +
    `画面中心构图，重要元素不贴近画面边缘，四周留出余量。` +
    `${BLANK_SURFACES}。` +
    `${s.hold}。`
  )
}

function buildNegative(style: StyleKey): string {
  return `${NEG_BASE}, ${STYLES[style].negExtra}`
}

// ─── 计划结构 ──────────────────────────────────────────────────────────────
interface PlanItem {
  courseId: string
  title: string
  slot: string
  /** "reuse" = 直接用已有的 36 张之一；"new" = 需要新生成 */
  kind: "reuse" | "new"
  /** reuse: 目标文件名；new: 输出文件名 */
  file: string
  style?: StyleKey
  scene?: string
}

async function connect() {
  const url = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^DATABASE_URL=(.+)$/m)
  if (!url) throw new Error("在 .env.local 里找不到 DATABASE_URL")
  return createConnection(url[1].trim())
}

/** 列出教材同步课程，并按槽位分组；每个槽位内按使用量倒序 */
async function loadCourses() {
  const conn = await connect()
  const [rows] = await conn.execute(
    `SELECT id, title, sub_category_key, usage_count
       FROM courses
      WHERE is_published = 1 AND category_key = 'school_sync'
      ORDER BY sub_category_key, usage_count DESC`,
  )
  await conn.end()
  return rows as { id: string; title: string; sub_category_key: string | null; usage_count: number }[]
}

/** 每个槽位现存的 3 张主题图（复用来源） */
function existingImagesForSlot(slot: string): string[] {
  const out: string[] = []
  for (let v = 1; v <= 3; v++) {
    const f = `${slot}__v${v}.webp`
    if (fs.existsSync(path.join(EXISTING_DIR, f))) out.push(f)
  }
  return out
}

async function stepPlan() {
  const courses = await loadCourses()
  const bySlot = new Map<string, typeof courses>()
  for (const c of courses) {
    const slot = `school_sync__${c.sub_category_key ?? "general"}`
    if (!bySlot.has(slot)) bySlot.set(slot, [])
    bySlot.get(slot)!.push(c)
  }

  const plan: PlanItem[] = []
  let styleCursor = 0
  let composeCursor = 0

  for (const [slot, list] of [...bySlot.entries()].sort()) {
    const existing = existingImagesForSlot(slot)
    // 前 N 门课复用现有图（N = 该槽位现有张数，通常 3）
    list.forEach((c, i) => {
      if (i < existing.length) {
        plan.push({ courseId: c.id, title: c.title, slot, kind: "reuse", file: existing[i] })
      } else {
        const style = STYLE_CYCLE[styleCursor % STYLE_CYCLE.length]
        plan.push({
          courseId: c.id,
          title: c.title,
          slot,
          kind: "new",
          file: `${c.id}.webp`,
          style,
        })
        styleCursor++
      }
    })
    composeCursor++
  }

  fs.mkdirSync(path.dirname(PLAN_FILE), { recursive: true })
  // 若已有计划，保留它已生成的场景描述（避免重复调用 DeepSeek）
  if (fs.existsSync(PLAN_FILE)) {
    const old: PlanItem[] = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"))
    const sceneByCourse = new Map(old.filter((p) => p.scene).map((p) => [p.courseId, p.scene!]))
    for (const p of plan) if (sceneByCourse.has(p.courseId)) p.scene = sceneByCourse.get(p.courseId)
  }
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2))

  const reuse = plan.filter((p) => p.kind === "reuse").length
  const fresh = plan.filter((p) => p.kind === "new").length
  const withScene = plan.filter((p) => p.scene).length
  console.log(`[plan] 教材同步 ${plan.length} 门`)
  console.log(`  复用现有图 : ${reuse} 门`)
  console.log(`  需新生成   : ${fresh} 门   预计 ${(fresh * 0.14).toFixed(2)} 元`)
  console.log(`  已有场景描述: ${withScene} 门`)
  console.log(`  计划文件   : ${path.relative(ROOT, PLAN_FILE)}`)
  const styleCount = new Map<string, number>()
  for (const p of plan) if (p.style) styleCount.set(p.style, (styleCount.get(p.style) ?? 0) + 1)
  console.log(`  风格分布   : ${[...styleCount.entries()].map(([k, v]) => `${STYLES[k as StyleKey].name}=${v}`).join("  ")}`)
}

// ─── DeepSeek 生成场景描述 ──────────────────────────────────────────────────
const SCENE_SYSTEM = `你是英语课程封面插画的分镜师。为给定的英语课程写一句画面描述（中文，25~40字），供 AI 生成封面插画。

必须遵守（违反会导致封面出现乱码文字或不贴题）：
1. 只描述**可视的场景**，绝对不要提课程名里的单词、字母、书名、标语、知识点名称
2. **不要出现「有人正在使用文字载体」的动作**：禁止「在黑板/白板上写字或讲解」「用单词卡片」「翻看词典内页」「做试卷/练习册」「记笔记」「举着写满字的纸」
3. 纸张、书本、白板、屏幕只能写「合上的」「收起的」或「空白的」
4. 人物 1~3 个，要有明确动作（交谈、倾听、手指着对方、递给、抬头看、并肩走、蹲下观察、挥手…）
5. 场景要贴合课程的年级与主题（低年级偏童趣、高年级偏校园/学习氛围）
6. 不要用「知识的海洋」「通往世界的桥梁」这类抽象比喻
7. 不要出现任何品牌、商标、真人姓名
8. **严格遵守每门课后面括号里的「出镜人物」要求** —— 那一项决定画面里是谁，
   写错会导致人物与课程风格不符

只输出 JSON 数组，不要任何解释或代码块标记，格式：
[{"id":"课程id","scene":"画面描述"}]`

interface DsCourse {
  id: string
  title: string
  slot: string
  subjectNote?: string
}

async function genScenes(batch: DsCourse[]): Promise<Map<string, string>> {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error("在 .env.local 里找不到 DEEPSEEK_API_KEY")
  const user = batch
    .map(
      (c) =>
        `- id=${c.id}｜课程名：${c.title}｜学段/年级：${c.slot.replace("school_sync__", "")}` +
        `｜出镜人物：${c.subjectNote ?? "不限（1~3 个与课程年龄相称的学生或年轻人）"}`,
    )
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
  const json = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[]; error?: unknown }
    | null
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  const text = json?.choices?.[0]?.message?.content ?? ""
  const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim()
  const start = cleaned.indexOf("[")
  const end = cleaned.lastIndexOf("]")
  if (start < 0 || end < 0) throw new Error(`模型未返回 JSON 数组：${cleaned.slice(0, 200)}`)
  const arr = JSON.parse(cleaned.slice(start, end + 1)) as { id: string; scene: string }[]
  return new Map(arr.filter((x) => x.id && x.scene).map((x) => [x.id, x.scene]))
}

/** 场景描述里如果出现这些词，生成乱码文字的概率显著升高 —— 直接拦掉重写 */
const RISKY_WORDS = [
  "写字", "书写", "板书", "讲解板", "白板上", "黑板上", "卡片", "试卷", "练习册",
  "记笔记", "单词", "字母", "词典内", "摊开写", "举着写",
  // 积木/方块是实测会出乱码字母的载体（CogView 那次方块上全是乱码组合）
  "积木", "方块", "拼字", "骰子",
]

async function stepScenes() {
  if (!fs.existsSync(PLAN_FILE)) throw new Error("请先跑 --step=plan 生成计划")
  const plan: PlanItem[] = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"))
  const todo = plan.filter((p) => p.kind === "new" && !p.scene)
  console.log(`[scenes] 需要生成场景描述 ${todo.length} 门`)

  const BATCH = 10
  let done = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH).map((p) => ({
      id: p.courseId,
      title: p.title,
      slot: p.slot,
      subjectNote: p.style ? STYLES[p.style].subjectNote : undefined,
    }))
    let scenes: Map<string, string> | null = null
    for (let attempt = 1; attempt <= 3 && !scenes; attempt++) {
      try {
        scenes = await genScenes(batch)
      } catch (e) {
        console.log(`  第 ${attempt} 次失败：${e instanceof Error ? e.message.slice(0, 120) : e}`)
      }
    }
    if (!scenes) {
      console.log(`  ✗ 第 ${i / BATCH + 1} 批放弃`)
      continue
    }
    for (const p of todo.slice(i, i + BATCH)) {
      const s = scenes.get(p.courseId)
      if (!s) continue
      const risky = RISKY_WORDS.filter((w) => s.includes(w))
      if (risky.length) {
        // 命中高危词就丢弃，下一轮重写（不带着风险去生成，一张图 0.14 元）
        console.log(`  ⚠ 丢弃（含高危词 ${risky.join("/")}）：${p.title.slice(0, 20)} → ${s.slice(0, 40)}`)
        continue
      }
      p.scene = s
    }
    done += batch.length
    fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2))
    process.stdout.write(`\r  进度 ${Math.min(done, todo.length)}/${todo.length}`)
  }
  console.log()
  const withScene = plan.filter((p) => p.scene).length
  console.log(`[scenes] 现有场景描述 ${withScene} 门；仍缺 ${plan.filter((p) => p.kind === "new" && !p.scene).length} 门`)
}


// ─── 万相出图（与 scripts/gen-course-covers.ts 同一套已实测的约束）──────────
const API_CREATE = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
const API_TASK = (id: string) => `https://dashscope.aliyuncs.com/api/v1/tasks/${id}`
const SIZE = "1440*960"

/** 额度/鉴权类错误重试没有意义，直接终止整批，别把剩下几十张各失败一遍 */
class FatalApiError extends Error {}
const FATAL_CODE = /Arrearage|QuotaExhausted|InvalidApiKey|AccessDenied|Unactivated/i
const FATAL_HINT = ["欠费", "余额", "额度不足", "未开通", "insufficient", "balance", "arrearage", "quota"]

function detectFatal(status: number, json: any): string | null {
  const code = json?.code ?? ""
  const message = json?.message ?? ""
  if (FATAL_CODE.test(code)) return `${code}: ${message}`
  if (status === 401 || status === 403) return `HTTP ${status} ${code}: ${message}`
  const blob = `${code} ${message}`.toLowerCase()
  if (FATAL_HINT.some((h) => blob.includes(h))) return `${code}: ${message}`
  return null
}

async function createTask(prompt: string, negative: string, label: string): Promise<string> {
  const key = process.env.DASHSCOPE_API_KEY?.trim()
  if (!key) throw new Error("在 .env.local 里找不到 DASHSCOPE_API_KEY")
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetch(API_CREATE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      // n 必须显式写 1（官方默认 4，不写就是 4 倍计费）
      // prompt_extend 必须显式 false（默认 true 会改写提示词导致风格漂移）
      body: JSON.stringify({
        model: "wan2.2-t2i-flash",
        input: { prompt, negative_prompt: negative },
        parameters: { size: SIZE, n: 1, prompt_extend: false, watermark: false },
      }),
    })
    const json = await res.json().catch(() => null)
    if (res.status === 429) {
      const wait = 8000 * attempt
      console.log(`    限流(429)，退避 ${wait / 1000}s`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    const fatal = detectFatal(res.status, json)
    if (fatal) throw new FatalApiError(`额度或鉴权问题：${fatal}`)
    if (!res.ok || !json?.output?.task_id) {
      throw new Error(`创建任务失败 HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`)
    }
    return json.output.task_id
  }
  throw new Error("连续 8 次被限流")
}

async function pollTask(taskId: string): Promise<string> {
  const key = process.env.DASHSCOPE_API_KEY?.trim()!
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000))
    const json: any = await (
      await fetch(API_TASK(taskId), { headers: { Authorization: `Bearer ${key}` } })
    ).json()
    const st = json?.output?.task_status
    if (st === "SUCCEEDED") {
      const url = json?.output?.results?.[0]?.url
      if (!url) throw new Error(`SUCCEEDED 但无 url\n${JSON.stringify(json).slice(0, 400)}`)
      return url
    }
    if (st && st !== "PENDING" && st !== "RUNNING") {
      throw new Error(`任务终态 ${st}\n${JSON.stringify(json).slice(0, 400)}`)
    }
  }
  throw new Error("轮询超时")
}

async function stepImages() {
  if (!fs.existsSync(PLAN_FILE)) throw new Error("请先跑 --step=plan")
  fs.mkdirSync(PNG_DIR, { recursive: true })
  const plan: PlanItem[] = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"))
  const fresh = plan.filter((p) => p.kind === "new")

  const missingScene = fresh.filter((p) => !p.scene)
  if (missingScene.length) {
    console.error(`有 ${missingScene.length} 门课还没有场景描述，请先跑 --step=scenes`)
    process.exit(1)
  }

  const todo = fresh.filter((p) => !fs.existsSync(path.join(PNG_DIR, p.file.replace(/\.webp$/, ".png"))))
  console.log(
    `[images] 共需 ${fresh.length} 张，已有 ${fresh.length - todo.length} 张，` +
      `本次生成 ${todo.length} 张（约 ${(todo.length * 0.14).toFixed(2)} 元）\n`,
  )

  let ok = 0
  let consecutive = 0
  const failed: string[] = []

  for (let i = 0; i < todo.length; i++) {
    const item = todo[i]
    const label = `${item.title.slice(0, 16)} (${i + 1}/${todo.length}) ${STYLES[item.style!].name}`
    const t0 = Date.now()
    try {
      const prompt = buildPrompt(item.style!, item.scene!, i)
      const taskId = await createTask(prompt, buildNegative(item.style!), label)
      const url = await pollTask(taskId)
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
      fs.writeFileSync(path.join(PNG_DIR, item.file.replace(/\.webp$/, ".png")), buf)
      ok++
      consecutive = 0
      console.log(`  ✓ ${label}  ${(buf.length / 1024).toFixed(0)}KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    } catch (e) {
      if (e instanceof FatalApiError) {
        console.log(`\n  ✗ ${label}\n      ${e.message}`)
        console.log("\n[images] 额度/鉴权问题，已终止本批次（已生成的不受影响，可续跑）")
        break
      }
      consecutive++
      const reason = e instanceof Error ? e.message.split("\n")[0] : String(e)
      failed.push(`${item.title}: ${reason}`)
      console.log(`  ✗ ${label}\n      ${reason}`)
      if (consecutive >= 5) {
        console.log("\n[images] 连续失败 5 次，终止本批次")
        break
      }
    }
  }
  console.log(`\n[images] 成功 ${ok}，失败 ${failed.length}`)
  for (const f of failed.slice(0, 8)) console.log(`  - ${f}`)
  const done = fresh.filter((p) => fs.existsSync(path.join(PNG_DIR, p.file.replace(/\.webp$/, ".png")))).length
  console.log(`[images] 累计已有 ${done}/${fresh.length} 张 PNG`)
}


/**
 * 把生成的 PNG 转成 WebP 落到 public/images/courses/<courseId>.webp
 *
 * 文件名用**课程 id**（不是槽位名）—— 因为逐课图靠 cover_url 直接指向它，
 * 一个课程一个文件，不再按槽位共用。
 */
async function stepCompress() {
  if (!fs.existsSync(PLAN_FILE)) throw new Error("请先跑 --step=plan")
  fs.mkdirSync(WEB_DIR, { recursive: true })
  const plan: PlanItem[] = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"))
  const fresh = plan.filter((p) => p.kind === "new")

  let ok = 0
  let bytesIn = 0
  let bytesOut = 0
  const missing: string[] = []
  const failed: string[] = []

  for (const item of fresh) {
    const png = path.join(PNG_DIR, item.file.replace(/\.webp$/, ".png"))
    const webp = path.join(WEB_DIR, item.file)
    if (!fs.existsSync(png)) {
      missing.push(path.basename(png))
      continue
    }
    try {
      const buf = await sharp(png).webp({ quality: 80, effort: 5 }).toBuffer()
      fs.writeFileSync(webp, buf)
      bytesIn += fs.statSync(png).size
      bytesOut += buf.length
      ok++
    } catch (e) {
      failed.push(`${path.basename(png)}: ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log(`[compress] 转码 ${ok}/${fresh.length} 张  ${(bytesIn / 1024 / 1024).toFixed(1)}MB → ${(bytesOut / 1024 / 1024).toFixed(1)}MB`)
  if (failed.length) {
    console.log(`转码失败 ${failed.length} 张：`)
    for (const f of failed.slice(0, 5)) console.log(`  - ${f}`)
  }
  if (missing.length) {
    console.log(`缺少源 PNG ${missing.length} 张，请先跑 --step=images`)
  }
}

function stepReport() {
  if (!fs.existsSync(PLAN_FILE)) {
    console.log("尚无计划文件")
    return
  }
  const plan: PlanItem[] = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"))
  const reuse = plan.filter((p) => p.kind === "reuse")
  const fresh = plan.filter((p) => p.kind === "new")
  const sceneOk = fresh.filter((p) => p.scene)
  const pngOk = fresh.filter((p) => fs.existsSync(path.join(PNG_DIR, p.file.replace(/\.webp$/, ".png"))))
  const webOk = plan.filter((p) => fs.existsSync(path.join(WEB_DIR, p.file)))
  console.log(`[report] 教材同步 ${plan.length} 门`)
  console.log(`  复用现有图   : ${reuse.length}`)
  console.log(`  需新生成     : ${fresh.length}（场景描述已就绪 ${sceneOk.length}）`)
  console.log(`  新图 PNG 已出 : ${pngOk.length}/${fresh.length}`)
  console.log(`  成品 WebP 已有: ${webOk.length}/${plan.length}`)
}

// ─── 入口 ──────────────────────────────────────────────────────────────────
function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function main() {
  const step = argValue("step") ?? "plan"
  switch (step) {
    case "plan":
      await stepPlan()
      break
    case "scenes":
      await stepScenes()
      break
    case "images":
      await stepImages()
      break
    case "compress":
      await stepCompress()
      break
    case "report":
      stepReport()
      break
    default:
      console.error(`未知 --step=${step}（可用：plan | scenes | images | compress | report）`)
      process.exit(1)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
