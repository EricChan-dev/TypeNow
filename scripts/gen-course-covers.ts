/**
 * 生成课程封面：44 个主题槽位 × 4 个构图变体 = 176 张。
 *
 * 用法：
 *   npx tsx scripts/gen-course-covers.ts --step=generate           # 串行调 API，落 PNG
 *   npx tsx scripts/gen-course-covers.ts --step=compress           # PNG → WebP 进 public/
 *   npx tsx scripts/gen-course-covers.ts --step=report             # 只打印现状
 *   npx tsx scripts/gen-course-covers.ts --only=practical__movies_stories
 *   npx tsx scripts/gen-course-covers.ts --force                   # 重跑已存在的
 *
 * ── 为什么分两步、且默认跳过已存在 ────────────────────────────────────────────
 *
 * 176 张串行要跑约一小时（见下方「串行」注释），中间断网、限流、或人工中断都很正常。
 * 因此每一步都必须幂等：generate 只在目标 PNG 不存在时才调 API，compress 同理。
 * 这让脚本可以反复重跑而不会重复计费，也让「只重跑有问题的那几张」成为可能 ——
 * 删掉对应 PNG 再跑即可。
 *
 * ── 为什么 PNG 和 WebP 分开 ───────────────────────────────────────────────────
 *
 * API 只返回 PNG（实测单张 0.6~2.0MB）。176 张 PNG 直接进仓库就是 200MB+，
 * 不可接受。所以 PNG 落 .covers-build/（进 .gitignore，可随时删），
 * 只有 WebP（实测单张 31~158KB）进 public/images/courses/。
 */

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { config as loadEnv } from "dotenv"

// 槽位清单是生成脚本与运行时解析器共用的唯一事实来源（见 course-cover-themes.ts）。
// 走相对路径而不是 `@/` 别名：那个模块本身零依赖，相对路径语义更明确，
// 也不依赖 tsx 对 tsconfig paths 的解析（而 scripts/ 恰好被 tsconfig 排除了）。
import {
  COVER_THEME_SLOTS,
  COVER_VARIANTS_PER_THEME,
  themeSlug,
} from "../src/lib/course-cover-themes"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

/**
 * sharp 不在项目顶层依赖里 —— 它是 `next` 的 optionalDependency，
 * pnpm 的严格布局不会把它提升到 node_modules 根，所以直接 `import "sharp"` 会失败。
 * 从 next 的 package.json 作为锚点解析，就能拿到同一份实例，**不新增任何依赖**。
 *
 * 这里刻意不用全局 `require`：脚本由 tsx 执行，模块模式随 tsconfig/package.json 变化，
 * 用 createRequire 以文件路径为锚点在 CJS/ESM 两种模式下都成立。
 */
const cwdRequire = createRequire(path.join(ROOT, "scripts", ".resolve-anchor.cjs"))
const nextRequire = createRequire(cwdRequire.resolve("next/package.json"))
const sharp = nextRequire("sharp") as typeof import("sharp")

// ─── 输出位置 ────────────────────────────────────────────────────────────────
const PNG_DIR = path.join(ROOT, ".covers-build")
const WEB_DIR = path.join(ROOT, "public", "images", "courses")

// ─── 模型与参数 ──────────────────────────────────────────────────────────────
const API_BASE = "https://dashscope.aliyuncs.com"
const CREATE_URL = `${API_BASE}/api/v1/services/aigc/text2image/image-synthesis`
const TASK_URL = (id: string) => `${API_BASE}/api/v1/tasks/${id}`
const MODEL = "wan2.2-t2i-flash"

/**
 * flash 的限制是**宽高都必须在 [512, 1440]**（见官方文档），所以 16:9 最大只能 1440*810。
 * 选 3:2 的 1440*960：同一张原图供两种卡片形态（discover 3:2 / mine 16:10）
 * 用 object-cover 裁切共用，不必生成两套。
 */
const SIZE = "1440*960"

/** 结果 URL 只活 24 小时，所以下载与生成必须在同一次运行内完成 —— 不能存链接稍后再取。 */
const POLL_INTERVAL_MS = 4000
const POLL_TIMEOUT_MS = 180_000

// ─── 提示词：风格 + 配色（实测验证过的 v3 结构）────────────────────────────────
//
// 结构是「风格+配色前置 → 短场景 → 构图 → 风格与配色再钉一次」。
// 为什么风格必须前置：v1 把风格后缀放在整段末尾时，模型被前面一长串具体名词主导，
// 水彩漂成动漫背景、扁平漂成描线 CG（见设计文档 5.3 与证据图）。
// 为什么配色也必须写进风格约束：v2 只钉住画法没钉住色板，会议室场景让整张塌成冷调单色。
const STYLE_LEAD = {
  water:
    "水彩手绘风格，湿画法水彩晕染，明显的粗纹水彩纸质感，淡雅的莫兰迪配色，笔触松弛，温暖治愈的儿童绘本插画质感。" +
    "配色为莫兰迪暖调：主色是草木绿与米黄，暖砖红与淡粉作为花朵点缀，少量天蓝用于天空，全图明度偏亮、饱和度偏低",
  flat:
    "扁平矢量插画风格，克制的几何形状，大面积纯色块，边缘干净利落，无描边、无渐变、无噪点，现代教育科技产品的编辑插画质感。" +
    // ⚠️ 这里**绝不能出现十六进制色值**。首版写的是「近似 #1e293b / #e2603f」，
    // 结果模型把色值当成画面内容，在索引卡片和铅笔筒上渲染出
    // 「#1e2983b」「#1e6033b」「#ee2036」这类乱码字符串 —— 在 220px 卡片尺寸下清晰可读。
    // 用色名描述即可，模型对色名的遵循度足够（实测 46 张扁平图的饱和度标准差仅 0.076）。
    "配色固定为：深蓝灰（接近深夜天空的暗蓝）作为主体底色，砖红与暖橙作为唯一强调色，点缀少量米白；整体以深色为主、暖色作点缀，不使用其他色系",
} as const

const STYLE_HOLD = {
  water:
    "整体保持水彩手绘质感与上述配色，纸纹清晰可见，画面四角干净、没有签名或落款或任何手写标记",
  flat: "整体保持扁平矢量质感与上述配色，纯色块面，不要描边和线稿，不要冷调单色",
} as const

/**
 * 通用负向词。两条经验：
 * 1. 文字类词要写得冗余 —— 车身、站牌、黑板、书页都容易被写上乱码。实测把
 *    「站牌/指示牌/广告牌」显式列入后，公交站场景的乱码汉字消失（那些物件没再被生成）。
 * 2. 落款类词写了也没用（设计文档 5.4 已记录），保留只是为了稍微降低概率，不指望它。
 */
const NEG_BASE =
  "文字, 汉字, 英文字母, 单词, 标题, 字幕, 招牌, 站牌, 指示牌, 广告牌, 标语, 水印, 签名, 印章, " +
  "logo, 商标, 二维码, 乱码, 棋盘格, 变形的手, 多余手指, 畸形, 面部特写, 人群, 杂乱, 拥挤, " +
  "低分辨率, 模糊, 噪点, 过曝, 浓重阴影, 边框, 拼贴"

const NEG_SIGN = "手写签名, 落款, 作者署名, 花体字, 草书, 手写字, 装饰性文字, 角落文字, 版权声明, 页码"

const NEGATIVE = {
  water:
    `${NEG_BASE}, 动漫风格, 赛璐璐, 平涂上色, 矢量插画, 扁平色块, 写实摄影, 3D渲染, 描边, 线稿, ` +
    `数字绘画, ${NEG_SIGN}`,
  flat:
    `${NEG_BASE}, 写实摄影, 3D渲染, 描边, 线稿, 素描, 水彩, 漫画, 渐变网格, 胶片颗粒, ` +
    `冷色调单色, 全灰, ${NEG_SIGN}`,
} as const

/**
 * 4 个构图变体：**只改视角与构图，不动光照与配色**。
 *
 * 为什么刻意不引入「清晨冷光 / 黄昏暖光」这类时段变化：配色漂移正是我们要防的主要回归
 * （见设计文档 5.3），而光照是驱动配色的最强变量。变体只动构图，能把漂移风险压到最低。
 */
const COMPOSITIONS = [
  "画面主体居中，采用平视的中景，环境交代完整",
  "采用近景特写，主体占据画面大部分面积，背景略微虚化",
  "采用略高的俯视视角看整个场景",
  "采用侧面视角，主体偏向画面一侧，另一侧留出余地",
] as const

const COMPOSE_BASE = "画面中心构图，重要元素不贴近画面边缘，四周留出余量，画面中没有人"

type StyleKey = keyof typeof STYLE_LEAD

/**
 * slug → 场景与风格。
 *
 * **槽位清单本身不在这里** —— 它来自 `src/lib/course-cover-themes.ts`，
 * 那是生成脚本与运行时解析器共用的唯一事实来源。这个文件只负责
 * 「每个槽位画什么」，因为场景描述只有生成期才需要，不该进前端包。
 *
 * 键必须与 COVER_THEME_SLOTS 完全一一对应，由下面的 assertScenesCoverSlots 守住。
 */
const SCENES: Record<string, { scene: string; style: StyleKey }> = {
  practical__movies_stories: { style: "flat", scene: "一间老式电影院放映厅里成排的暗红色座椅，前方是一块泛着柔光的空白银幕" },
  practical__classic_textbooks: { style: "flat", scene: "一张木质书桌上摊开的厚重教科书，旁边整齐叠放着几本书和一支钢笔" },
  practical__grammar_vocab: { style: "flat", scene: "桌面上排列整齐的彩色索引卡片与一本翻开的空白笔记本" },
  practical__listening_speaking: { style: "flat", scene: "一副头戴式耳机挂在桌边的支架上，旁边立着一支小型麦克风" },
  practical__daily_oral: { style: "flat", scene: "咖啡馆靠窗的两人小桌，桌上放着两杯咖啡和一盆小绿植" },
  practical__general: { style: "flat", scene: "一张整洁的书桌，亮着的台灯、翻开的笔记本和一支钢笔" },
  none__general: { style: "flat", scene: "一面木质书架上整齐排列的书本，架子边缘垂下一盆绿植" },
  practical__business_career: { style: "flat", scene: "一间现代会议室的长桌与几把椅子，墙上是空白的投影幕布" },
  practical__travel_english: { style: "flat", scene: "机场候机大厅里成排的座椅，落地窗外停着一架客机" },
  exam_prep__ielts_toefl: { style: "flat", scene: "一张书桌上摊开的空白试卷、一支铅笔和一块橡皮" },
  exam_prep__cet_4_6: { style: "flat", scene: "一间教室里成排的课桌与讲台，后方是一块空白的黑板" },
  exam_prep__pte: { style: "flat", scene: "一张电脑桌上的一台显示器与键盘，屏幕是柔和的空白亮光" },
  exam_prep__gaokao: { style: "flat", scene: "桌面上堆叠的复习资料与一个空白的翻页台历" },
  exam_prep__zhuan_sheng_ben: { style: "flat", scene: "图书馆里成排的木质书架与一张靠窗的阅览桌" },
  exam_prep__zhongkao: { style: "flat", scene: "中学教室里的一块空白黑板、讲台与成排课桌" },
  exam_prep__postgraduate: { style: "flat", scene: "夜晚书桌上亮着的台灯、几本厚参考书和一杯冒着热气的茶" },
  exam_prep__degree_english: { style: "flat", scene: "夜校教室里一排亮着台灯的书桌" },
  exam_prep__tem_4_8: { style: "flat", scene: "书桌上摊开的一本厚重英文词典与写满格线的笔记本" },
  exam_prep__pet: { style: "flat", scene: "儿童书桌上摊开的彩色练习册与一盒彩色铅笔" },
  exam_prep__gre: { style: "flat", scene: "书桌上堆得很高的厚书与一块立着的空白白板" },
  exam_prep__toeic: { style: "flat", scene: "办公室隔间的桌面，放着文件夹、订书机和一杯咖啡" },
  exam_prep__ket: { style: "flat", scene: "明亮的儿童阅读角，矮书架与几个彩色坐垫" },
  exam_prep__fce: { style: "flat", scene: "书桌上一台翻开的笔记本电脑与一本摊开的笔记本" },
  exam_prep__general: { style: "flat", scene: "考场里成排的课桌，墙上挂着一面圆形挂钟" },

  school_sync__grade_4: { style: "water", scene: "阳光下的校园操场，红色跑道与绿色草坪" },
  school_sync__grade_3: { style: "water", scene: "清晨的公交站台与一辆停靠的明黄色公交车" },
  school_sync__grade_8: { style: "water", scene: "教学楼前的林荫道，两侧是成排的梧桐树" },
  school_sync__grade_1: { style: "water", scene: "小学教室里的矮课桌与一盒彩色粉笔" },
  school_sync__grade_7: { style: "water", scene: "校园图书馆的木质书架与靠窗的阅读桌" },
  school_sync__grade_5: { style: "water", scene: "放学后的校门口与一棵开满花的老树" },
  school_sync__grade_6: { style: "water", scene: "科学教室里的实验台与几个玻璃器皿" },
  school_sync__general: { style: "water", scene: "校园里的红色塑胶跑道与远处的教学楼" },
  school_sync__high_school: { style: "water", scene: "高中教室的课桌与书本，窗外是一棵大树" },
  school_sync__grade_9: { style: "water", scene: "安静的晚自习教室，成排课桌与亮着的灯" },
  school_sync__grade_2: { style: "water", scene: "小学教室窗台上的一盒彩色粉笔与一盆小盆栽" },
  school_sync__vocational: { style: "water", scene: "一间实训教室的工作台与整齐摆放的工具" },
  graded_reading__oxford_reading_tree: { style: "water", scene: "花园草坪上一只追球的小狗与一个浇花水桶" },
  graded_reading__lets_go: { style: "water", scene: "色彩柔和的小镇街道，两侧是低矮的房子" },
  graded_reading__raz: { style: "water", scene: "农场里的红色谷仓、木栅栏与几只小鸡" },
  graded_reading__heinemann: { style: "water", scene: "阳光下的花园草坪，几丛花与一只蝴蝶" },
  graded_reading__big_cat: { style: "water", scene: "雨后花园小径与挂在叶尖的水珠" },
  graded_reading__oxford_bookworm: { style: "water", scene: "老式书房里的皮质扶手椅与堆满书的书架" },
  graded_reading__red_rocket: { style: "water", scene: "海边的沙滩、贝壳与远处的灯塔" },
  graded_reading__general: { style: "water", scene: "秋日公园的长椅与铺满落叶的小路" },
}

/**
 * 槽位清单与场景映射必须完全对齐。
 * 这条断言防「新增了一个槽位但忘了写场景」—— 那种情况下提示词会缺掉画面主体，
 * 生成一张与课程无关的图，而且不会有任何报错。宁可启动就失败。
 */
function assertScenesCoverSlots(): void {
  const slugs = COVER_THEME_SLOTS.map((s) => themeSlug(s.categoryKey, s.subCategoryKey))
  const missing = slugs.filter((s) => !SCENES[s])
  const extra = Object.keys(SCENES).filter((s) => !slugs.includes(s))
  if (missing.length || extra.length) {
    throw new Error(
      `槽位与场景不匹配：缺场景 ${missing.length} 个 [${missing.join(", ")}]，` +
        `多余场景 ${extra.length} 个 [${extra.join(", ")}]`,
    )
  }
}

/**
 * 提示词结构（v3，实测验证过的）：
 *   风格+配色前置 → 短场景 → 构图 → 风格与配色再钉一次
 *
 * 为什么风格必须前置：v1 把风格后缀放在整段末尾时，模型被前面一长串具体名词主导，
 * 水彩漂成动漫背景、扁平漂成描线 CG（见设计文档 5.3 的证据图）。
 * 为什么配色也必须写进风格约束：v2 只钉住画法没钉住色板，会议室场景让整张塌成冷调单色。
 */
function buildPrompt(style: StyleKey, scene: string, variantIndex: number): string {
  return (
    `${STYLE_LEAD[style]}。` +
    `画面主体：${scene}。` +
    `${COMPOSITIONS[variantIndex]}，${COMPOSE_BASE}。` +
    `${STYLE_HOLD[style]}。`
  )
}

interface Job {
  slug: string
  style: StyleKey
  variant: number
  prompt: string
  negative: string
  png: string
  webp: string
}

/**
 * 每个槽位的在架课程数（设计文档 4.3 的实测数据）。
 *
 * 只用于**生成优先级**，不参与任何运行时逻辑，所以它随时间漂移是无害的 ——
 * 课程数变了只会让补变体的先后顺序略有不同。
 */
const SLOT_COURSE_COUNTS: Record<string, number> = {
  practical__movies_stories: 71,
  practical__classic_textbooks: 49,
  practical__grammar_vocab: 48,
  practical__listening_speaking: 45,
  exam_prep__ielts_toefl: 34,
  practical__daily_oral: 32,
  school_sync__grade_4: 32,
  practical__general: 30,
  none__general: 28,
  school_sync__grade_3: 26,
  exam_prep__cet_4_6: 25,
  school_sync__grade_8: 24,
  practical__business_career: 20,
  exam_prep__pte: 20,
  exam_prep__gaokao: 19,
  exam_prep__zhuan_sheng_ben: 19,
  school_sync__grade_1: 19,
  school_sync__grade_7: 18,
  school_sync__grade_5: 17,
  exam_prep__zhongkao: 15,
  exam_prep__postgraduate: 14,
  practical__travel_english: 11,
  school_sync__grade_6: 11,
  school_sync__general: 11,
  school_sync__high_school: 10,
  school_sync__grade_9: 10,
  exam_prep__degree_english: 9,
  school_sync__grade_2: 9,
  exam_prep__tem_4_8: 8,
  exam_prep__pet: 8,
  graded_reading__oxford_reading_tree: 7,
  graded_reading__lets_go: 7,
  graded_reading__raz: 7,
  graded_reading__heinemann: 7,
  school_sync__vocational: 7,
  graded_reading__big_cat: 6,
  graded_reading__oxford_bookworm: 6,
  exam_prep__gre: 6,
  exam_prep__toeic: 6,
  exam_prep__ket: 6,
  graded_reading__red_rocket: 5,
  exam_prep__fce: 5,
  graded_reading__general: 4,
  exam_prep__general: 3,
}

/**
 * 广度优先排序 —— **预算受限时唯一正确的顺序**。
 *
 * 先保证每个槽位都有 v1：否则一旦额度用尽，还没轮到的槽位一张图都没有，
 * 那个槽位下的所有课程会静默退回渐变色块（实测代价：`movies_stories` 一个槽位
 * 就是 71 门课）。
 *
 * 之后再按「槽位课程数从多到少」补 v2/v3/v4 —— 课程越多的槽位，
 * 多一个变体带来的观感提升越大（同槽位内才有「相邻卡片重样」的问题）。
 */
function sortByCoveragePriority(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    if (a.variant !== b.variant) return a.variant - b.variant
    const ca = SLOT_COURSE_COUNTS[a.slug] ?? 0
    const cb = SLOT_COURSE_COUNTS[b.slug] ?? 0
    if (ca !== cb) return cb - ca
    return a.slug.localeCompare(b.slug)
  })
}

function buildJobs(only?: string): Job[] {
  assertScenesCoverSlots()
  const jobs: Job[] = []
  for (const slot of COVER_THEME_SLOTS) {
    const slug = themeSlug(slot.categoryKey, slot.subCategoryKey)
    if (only && slug !== only) continue
    const meta = SCENES[slug]
    for (let v = 0; v < COVER_VARIANTS_PER_THEME; v++) {
      const name = `${slug}__v${v + 1}`
      jobs.push({
        slug,
        style: meta.style,
        variant: v,
        prompt: buildPrompt(meta.style, meta.scene, v),
        negative: NEGATIVE[meta.style],
        png: path.join(PNG_DIR, `${name}.png`),
        webp: path.join(WEB_DIR, `${name}.webp`),
      })
    }
  }
  return sortByCoveragePriority(jobs)
}

// ─── API ─────────────────────────────────────────────────────────────────────

function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY?.trim()
  if (!key) {
    throw new Error(
      "在 .env.local 里找不到 DASHSCOPE_API_KEY。\n" +
        "该 key 只被本地脚本读取，不会进 Next 运行时、也不会打到前端。",
    )
  }
  return key
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface DashScopeResponse {
  output?: {
    task_id?: string
    task_status?: string
    results?: { url?: string; actual_prompt?: string }[]
  }
  code?: string
  message?: string
}

/**
 * 额度耗尽 / 鉴权失败这类错误重试没有意义，而且会把剩下的每一张都失败一遍、刷屏几百行。
 * 单独抛出来，由调用方直接终止整个批次。
 */
class FatalApiError extends Error {}

const FATAL_CODE_PATTERN = /Arrearage|QuotaExhausted|InvalidApiKey|AccessDenied|Unactivated/i
const FATAL_MESSAGE_HINTS = [
  "欠费", "余额", "额度不足", "未开通", "insufficient", "balance", "arrearage", "quota",
]

function detectFatal(status: number, json: DashScopeResponse | null): string | null {
  const code = json?.code ?? ""
  const message = json?.message ?? ""
  if (FATAL_CODE_PATTERN.test(code)) return `${code}: ${message}`
  if (status === 401 || status === 403) return `HTTP ${status} ${code}: ${message}`
  const blob = `${code} ${message}`.toLowerCase()
  if (FATAL_MESSAGE_HINTS.some((h) => blob.includes(h.toLowerCase()))) {
    return `${code}: ${message}`
  }
  return null
}

/**
 * 创建任务。
 *
 * **必须显式传 `n: 1`** —— 官方默认是 4，不写就是一次 4 张、4 倍计费。
 * **必须显式传 `prompt_extend: false`** —— 默认 true 会让大模型改写提示词，
 * 176 张各改各的必然风格漂移。
 * `negative_prompt` 放在 `input` 里而不是 `parameters` 里（按官方示例）。
 */
async function createTask(prompt: string, negative: string, label: string): Promise<string> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        // 图像生成耗时十几秒到数分钟，必须走异步两步式
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: MODEL,
        input: { prompt, negative_prompt: negative },
        parameters: { size: SIZE, n: 1, prompt_extend: false, watermark: false },
      }),
    })
    const json = (await res.json().catch(() => null)) as DashScopeResponse | null

    if (res.status === 429) {
      // 实测 3 并发就会触发 Throttling.RateQuota（文档写 120 RPM，账号实际配额更低），
      // 所以本脚本串行执行；这里的退避是兜底，用于偶发限流。
      const wait = 8000 * attempt
      console.log(`    限流(429)，退避 ${wait / 1000}s 后重试（第 ${attempt} 次）`)
      await sleep(wait)
      continue
    }

    const fatal = detectFatal(res.status, json)
    if (fatal) throw new FatalApiError(`额度或鉴权问题：${fatal}`)

    if (!res.ok || !json?.output?.task_id) {
      throw new Error(`创建任务失败 HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`)
    }
    return json.output.task_id
  }
  throw new Error("连续 8 次被限流，放弃这一张")
}

async function pollTask(taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const res = await fetch(TASK_URL(taskId), { headers: { Authorization: `Bearer ${apiKey()}` } })
    const json = (await res.json().catch(() => null)) as DashScopeResponse | null
    const status = json?.output?.task_status

    if (status === "SUCCEEDED") {
      const url = json?.output?.results?.[0]?.url
      if (!url) throw new Error(`任务 SUCCEEDED 但没有返回 url\n${JSON.stringify(json, null, 2)}`)
      return url
    }
    // 除了 PENDING / RUNNING，其余状态都视为终态失败，并把原始响应打出来 ——
    // 常见的是 IPInfringementSuspect / DataInspectionFailed（提示词含受版权保护的内容）
    if (status && status !== "PENDING" && status !== "RUNNING") {
      throw new Error(`任务终态 ${status}\n${JSON.stringify(json, null, 2)}`)
    }
  }
  throw new Error(`轮询超时（${POLL_TIMEOUT_MS / 1000}s）`)
}

// ─── 步骤 ────────────────────────────────────────────────────────────────────

async function stepGenerate(jobs: Job[], force: boolean, limit?: number) {
  fs.mkdirSync(PNG_DIR, { recursive: true })
  const pending = jobs.filter((j) => force || !fs.existsSync(j.png))
  const todo = typeof limit === "number" ? pending.slice(0, limit) : pending

  console.log(
    `[generate] 共 ${jobs.length} 张，已有 ${jobs.length - pending.length} 张，` +
      `本次待生成 ${todo.length} 张${limit ? `（--limit=${limit}）` : ""}\n`,
  )
  // 打印前几张的顺序，便于确认广度优先是否生效（先 v1 覆盖全部槽位）
  const preview = todo.slice(0, 5).map((j) => path.basename(j.png, ".png"))
  if (preview.length) console.log(`  顺序预览: ${preview.join(", ")} …\n`)

  let ok = 0
  let consecutiveFailures = 0
  const failed: { job: Job; reason: string }[] = []

  for (let i = 0; i < todo.length; i++) {
    const job = todo[i]
    const label = `${path.basename(job.png, ".png")} (${i + 1}/${todo.length})`
    const t0 = Date.now()
    try {
      const taskId = await createTask(job.prompt, job.negative, label)
      const url = await pollTask(taskId)
      // 结果 URL 只活 24 小时 —— 必须立刻下载落盘，不能把链接存起来稍后再取
      const imgRes = await fetch(url)
      if (!imgRes.ok) throw new Error(`下载失败 HTTP ${imgRes.status}`)
      const buf = Buffer.from(await imgRes.arrayBuffer())
      fs.writeFileSync(job.png, buf)
      ok++
      consecutiveFailures = 0
      console.log(`  ✓ ${label}  ${(buf.length / 1024).toFixed(0)}KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)

      // 额度/鉴权问题：重试后续每一张都只会再失败一次，直接停，别把额度提示刷屏几百行
      if (e instanceof FatalApiError) {
        console.log(`\n  ✗ ${label}\n      ${reason}`)
        console.log("\n[generate] 遇到不可恢复的错误，已终止本批次（已完成的不受影响，可续跑）")
        break
      }

      failed.push({ job, reason })
      consecutiveFailures++
      console.log(`  ✗ ${label}\n      ${reason.split("\n")[0]}`)

      // 连续失败通常是同一个系统性原因（鉴权、模型未开通、提示词被审核拦截）。
      // 与其把剩下几十张各失败一次，不如停下来让人看日志。
      if (consecutiveFailures >= 5) {
        console.log("\n[generate] 连续失败 5 次，判定为系统性问题，已终止本批次")
        break
      }
    }
  }

  console.log(`\n[generate] 成功 ${ok}，失败 ${failed.length}`)
  if (failed.length) {
    console.log("失败清单（重跑只需把对应 PNG 删掉后再执行本步）：")
    for (const f of failed) console.log(`  - ${path.basename(f.job.png)}: ${f.reason.split("\n")[0]}`)
  }
  const done = jobs.filter((j) => fs.existsSync(j.png)).length
  console.log(`[generate] 累计已有 ${done}/${jobs.length} 张 PNG`)
}

async function stepCompress(jobs: Job[], force: boolean) {
  fs.mkdirSync(WEB_DIR, { recursive: true })
  const todo = jobs.filter((j) => force || !fs.existsSync(j.webp))
  console.log(`[compress] 共 ${jobs.length} 张，待转码 ${todo.length} 张\n`)

  let ok = 0
  let bytesIn = 0
  let bytesOut = 0
  const missing: string[] = []
  const failed: string[] = []

  for (const job of todo) {
    if (!fs.existsSync(job.png)) {
      missing.push(path.basename(job.png))
      continue
    }
    try {
      // WebP q80：实测 827KB PNG → 54KB；扁平类 31~42KB，水彩类 116~158KB（笔触纹理更难压）
      const buf = await sharp(job.png).webp({ quality: 80, effort: 5 }).toBuffer()
      fs.writeFileSync(job.webp, buf)
      bytesIn += fs.statSync(job.png).size
      bytesOut += buf.length
      ok++
      console.log(`  ✓ ${path.basename(job.webp)}  ${(buf.length / 1024).toFixed(0)}KB`)
    } catch (e) {
      // 不因为一张坏图中断整批：generate 与本步可能并发运行，
      // 极小概率读到写了一半的 PNG，sharp 会直接抛错。
      failed.push(`${path.basename(job.png)}: ${e instanceof Error ? e.message : String(e)}`)
      console.log(`  ✗ ${path.basename(job.webp)}  转码失败`)
    }
  }

  console.log(`\n[compress] 转码 ${ok} 张  ${(bytesIn / 1024 / 1024).toFixed(1)}MB → ${(bytesOut / 1024 / 1024).toFixed(1)}MB`)
  if (failed.length) {
    console.log(`转码失败 ${failed.length} 张（删掉对应 PNG 后重跑本步）：`)
    for (const f of failed.slice(0, 5)) console.log(`  - ${f}`)
  }
  if (missing.length) {
    console.log(`缺少源 PNG ${missing.length} 张，请先跑 --step=generate：`)
    for (const m of missing.slice(0, 10)) console.log(`  - ${m}`)
    if (missing.length > 10) console.log(`  … 其余 ${missing.length - 10} 张`)
  }
}

function stepReport(jobs: Job[]) {
  const pngDone = jobs.filter((j) => fs.existsSync(j.png)).length
  const webpDone = jobs.filter((j) => fs.existsSync(j.webp)).length
  const webBytes = jobs.reduce(
    (sum, j) => sum + (fs.existsSync(j.webp) ? fs.statSync(j.webp).size : 0),
    0,
  )
  const byStyle = { water: 0, flat: 0 } as Record<StyleKey, number>
  for (const j of jobs) if (fs.existsSync(j.webp)) byStyle[j.style]++

  console.log(
    `[report] 槽位 ${COVER_THEME_SLOTS.length}，目标变体 ${COVER_VARIANTS_PER_THEME}，` +
      `合计 ${jobs.length} 张`,
  )
  console.log(`  PNG 已生成 : ${pngDone}/${jobs.length}`)
  console.log(`  WebP 已转码: ${webpDone}/${jobs.length}  （扁平 ${byStyle.flat}，水彩 ${byStyle.water}）`)
  console.log(`  WebP 总体积: ${(webBytes / 1024 / 1024).toFixed(1)} MB`)

  const missing = jobs.filter((j) => !fs.existsSync(j.webp)).map((j) => path.basename(j.webp))
  if (missing.length) {
    console.log(
      `  缺 ${missing.length} 张：${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`,
    )
  }

  /**
   * 打印每个槽位**实际**有几张变体，供更新 `COVER_VARIANT_COUNTS`。
   *
   * 这一步不能省：运行时的变体轮换按那张表取模，表比实际文件多 → 课程指向不存在的
   * 文件（同槽位卡片一半有图一半色块）；表比实际少 → 白生成的图永远轮不到。
   * 单测 course-cover-files.test.ts 会断言表与文件完全一致，所以忘了更新会直接变红。
   */
  const counts: string[] = []
  let actualTotal = 0
  for (const slot of COVER_THEME_SLOTS) {
    const slug = themeSlug(slot.categoryKey, slot.subCategoryKey)
    let n = 0
    for (let v = 1; v <= COVER_VARIANTS_PER_THEME; v++) {
      if (fs.existsSync(path.join(WEB_DIR, `${slug}__v${v}.webp`))) n++
    }
    actualTotal += n
    counts.push(`  ${slug}: ${n},`)
  }
  const hist = new Map<number, number>()
  for (const c of counts) {
    const n = Number(c.trim().split(": ")[1].replace(",", ""))
    hist.set(n, (hist.get(n) ?? 0) + 1)
  }

  console.log(`\n  实际变体张数合计 ${actualTotal}；分布 ` +
    [...hist.entries()].sort().map(([k, v]) => `${k} 张×${v} 槽位`).join("，"))

  console.log(
    `\n  ── 若与 src/lib/course-cover-themes.ts 的 COVER_VARIANT_COUNTS 不一致，` +
      `把下面整段粘贴过去替换 ──`,
  )
  console.log(counts.join("\n"))
}

// ─── 入口 ────────────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function main() {
  const step = argValue("step") ?? "report"
  const only = argValue("only")
  const force = process.argv.includes("--force")
  // 预算闸门：额度有限时用 --limit=N 把一次运行的张数钉住，避免把钱一次花光。
  // 未指定则不限制，但 createTask 的 FatalApiError 仍会在额度耗尽时终止批次。
  const limitRaw = argValue("limit")
  const limit = limitRaw === undefined ? undefined : Number(limitRaw)
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    console.error(`--limit 必须是正整数，收到：${limitRaw}`)
    process.exit(1)
  }
  const jobs = buildJobs(only)

  if (jobs.length === 0) {
    console.error(`没有匹配的槽位：--only=${only}`)
    process.exit(1)
  }

  switch (step) {
    case "generate":
      await stepGenerate(jobs, force, limit)
      break
    case "compress":
      await stepCompress(jobs, force)
      break
    case "report":
      stepReport(jobs)
      break
    default:
      console.error(`未知 --step=${step}（可用：generate | compress | report）`)
      process.exit(1)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
