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
// ─── 三种风格（同一大类内交替出现，避免「一类一个风格」）─────────────────────
//
// 结构是「风格+配色前置 → 具体场景 → 构图 → 风格与配色再钉一次」。
// 为什么风格必须前置：早期版本把风格后缀放在整段末尾，模型被前面一长串具体名词主导，
// 水彩漂成动漫背景、扁平漂成描线 CG（见设计文档 5.3 的证据图）。
//
// ⚠️ 提示词里**绝不能出现十六进制色值**。曾写过「近似 #1e293b」，模型把色值当成
// 画面内容，在索引卡片上渲染出「#1e2983b」这类乱码字符串，在 220px 卡片下清晰可读。
const STYLE_LEAD = {
  flat:
    "扁平矢量插画风格，克制的几何形状，大面积纯色块，边缘干净利落，无描边、无渐变、无噪点。" +
    "配色：深蓝灰作为主体底色，砖红与暖橙作为强调色，点缀少量米白。",
  water:
    "水彩手绘风格，湿画法水彩晕染，明显的粗纹水彩纸质感，笔触松弛，温暖治愈的绘本插画质感。" +
    "配色：莫兰迪暖调，主色是草木绿与米黄，暖砖红与淡粉点缀，少量天蓝，明度偏亮、饱和度偏低。",
  toon:
    "3D 卡通动画电影风格，圆润可爱的角色造型，柔和的体积光与浅景深，磨砂质感的材质。" +
    "配色：明亮的暖色调，蓝紫与砖橙的对比，米白与浅木色为环境色。",
} as const

const STYLE_HOLD = {
  flat: "整体保持扁平矢量质感与上述配色，纯色块面，不要描边、不要线稿、不要冷调单色",
  water: "整体保持水彩手绘质感与上述配色，纸纹清晰可见",
  toon: "整体保持 3D 卡通动画质感与上述配色，角色造型圆润，不要写实、不要照片质感",
} as const

/**
 * 通用负向词。
 *
 * 两条经验：
 * 1. 文字类词要写得冗余 —— 车身、站牌、黑板、书页、卡片都容易被写上乱码。
 *    把「站牌/指示牌/广告牌/卡片文字」显式列入后，公交站与试卷场景的乱码消失。
 * 2. **不再排除人物与人群**：本版明确需要儿童互动、男女对话、群像场景，
 *    所以去掉了「人群」「面部特写」。保留的是**畸变类**词（多余手指、畸形、
 *    变形的手）—— 人物允许出现之后，这些才是真正要防的东西。
 */
const NEG_BASE =
  "文字, 汉字, 英文字母, 单词, 标题, 字幕, 招牌, 站牌, 指示牌, 广告牌, 标语, 卡片文字, " +
  "水印, 签名, 印章, 落款, 作者署名, logo, 商标, 二维码, 乱码, 棋盘格, " +
  "板书, 白板上的文字, 手写字, 草书, 花体字母, 拼字方块, 字母积木, 骰子字母, 单词卡片上的字, 字幕, " +
  "多余手指, 畸形, 变形的手, 肢体错位, 双头, 多余肢体, 低分辨率, 模糊, 噪点, 过曝, 浓重阴影, 边框, 拼贴"

const NEGATIVE = {
  flat:
    `${NEG_BASE}, 写实摄影, 3D渲染, 照片, 描边, 线稿, 素描, 水彩, 漫画, 渐变网格, 胶片颗粒, 冷色调单色, 全灰`,
  water:
    `${NEG_BASE}, 动漫风格, 赛璐璐, 平涂上色, 矢量插画, 扁平色块, 写实摄影, 3D渲染, 描边, 线稿, 数字绘画, 彩铅, 铅笔素描, 炭笔, 马克笔`,
  toon:
    `${NEG_BASE}, 写实摄影, 真实照片, 真人, 扁平矢量, 描边线稿, 素描, 水彩, 二次元平涂`,
} as const

/**
 * 三个构图变体。
 *
 * 与上一版的区别：**不再要求「画面中没有人」**，改为明确描述人物在画面中的占比。
 * 场景本身也按变体各不相同（见 SCENES 里每个槽位的三个条目），
 * 所以「同主题的三张图」在风格、人物、构图、场景四个维度上都不一样。
 */
const COMPOSITIONS = [
  "中景，人物或主体占据画面中心较大面积，环境交代清楚",
  "近景，人物上半身或主体局部入画，背景略微虚化",
  "全景，人物与环境一起入画，视野开阔",
] as const

const COMPOSE_BASE = "画面中心构图，重要元素不贴近画面边缘，四周留出余量"

/**
 * 全局正向约束 —— 这是防乱码文字最有效的一条，比负向词管用。
 *
 * 教训来自第二次量产的冒烟测试：为了让封面出现人物，我写了一大批
 * 「有人正在讲解/使用文字载体」的场景（老师讲白板、学生用单词卡片、孩子玩字母方块），
 * 结果三张全部出现乱码 —— 白板上写满大段假英文、卡片上是 "MOLNG CARDS"、
 * 字母方块全是乱码组合。模型把「讲解/使用」这个动作真的执行了。
 *
 * 负向词只能压低概率；明确要求这些表面**是空的**，模型才倾向于留白或画抽象横线。
 * 上一版没有人物也没有这类道具，所以干净 —— 这一版必须靠这句话兜住。
 */
const BLANK_SURFACES =
  "画面中的纸张、书本、笔记本、试卷、白板、黑板、卡片、屏幕一律为空白或只有无法辨认的抽象横线，" +
  "不出现任何可辨识的文字、字母、数字或符号"

type StyleKey = keyof typeof STYLE_LEAD

/**
 * 每个槽位的**三张图**：分别用扁平 / 水彩 / 3D 卡通三种风格，配三个不同的场景。
 *
 * 三条设计意图（对应需求方「太雷同」的反馈）：
 *   1. **风格交替**：不再「一类一个风格」。同一大类下相邻槽位的 v1/v2/v3 风格不同，
 *      列表里滚动时会看到风格交替，而不是一整屏同一种画法。
 *   2. **人物为主**：三个变体分别倾向「儿童互动」「男女/成人对话」「一群人」，
 *      不再一律空镜。人物出现后封面才有「谁在用这个产品」的感觉。
 *   3. **场景各异**：同一槽位的三张不共用场景描述，只共用主题。
 *
 * 键必须与 COVER_THEME_SLOTS 完全一一对应，由 assertScenesCoverSlots 守住。
 */
const SCENES: Record<string, { style: StyleKey; scene: string }[]> = {
  // ── 实用英语 ───────────────────────────────────────────────────────────────
  practical__movies_stories: [
    { style: "flat", scene: "两个孩子在电影院放映厅里，一个指着银幕跟同伴说话" },
    { style: "water", scene: "一男一女两位年轻人在放映厅外的大厅里讨论刚看的电影" },
    { style: "toon", scene: "一群观众坐在电影院里一起看电影，有人笑着侧头交谈" },
  ],
  practical__classic_textbooks: [
    { style: "flat", scene: "一位中学生坐在书桌前翻开一本教科书，手边摊着笔记本" },
    { style: "water", scene: "一男一女两位学生共用一张桌子读同一本教材" },
    { style: "toon", scene: "一群学生围坐在长桌旁一起翻看教科书" },
  ],
  practical__grammar_vocab: [
    { style: "flat", scene: "两个学生面对面坐在书桌两侧讨论，桌上放着合上的笔记本和两支笔" },
    { style: "water", scene: "一位老师站在两位学生旁边弯腰指点，三人围在桌旁" },
    { style: "toon", scene: "一群学生围坐在桌旁热烈讨论，桌上放着合上的书本" },
  ],
  practical__listening_speaking: [
    { style: "flat", scene: "一位学生戴着耳机对着麦克风朗读，手边放着打开的课本" },
    { style: "water", scene: "一男一女两位学生在语言教室里对着麦克风做对话练习" },
    { style: "toon", scene: "一群学生戴着耳机在语言教室里各自练习口语" },
  ],
  practical__daily_oral: [
    { style: "flat", scene: "一男一女在咖啡馆靠窗的小桌旁聊天，桌上放着两杯咖啡" },
    { style: "water", scene: "两位朋友在街角的面包店门口站着说话" },
    { style: "toon", scene: "一群朋友围坐在咖啡馆的长桌旁热烈交谈" },
  ],
  practical__general: [
    { style: "flat", scene: "一位年轻人坐在书桌前，手托着下巴望向窗外思考" },
    { style: "water", scene: "一男一女两位同事在共享办公桌前讨论手边的笔记" },
    { style: "toon", scene: "几个人在共享书桌前各自安静地学习" },
  ],
  none__general: [
    { style: "flat", scene: "一位年轻人站在书架前，抬头看着上层的书" },
    { style: "water", scene: "一男一女两位读者在书架旁各自翻着一本书" },
    { style: "toon", scene: "几位读者在书架之间安静地浏览书籍" },
  ],
  practical__business_career: [
    { style: "flat", scene: "一男一女两位职场人士在会议室长桌旁交换意见" },
    { style: "water", scene: "一位职场人士站在落地窗前对着手机做电话会议" },
    { style: "toon", scene: "一群同事围在会议室长桌旁讨论投影幕布上的内容" },
  ],
  practical__travel_english: [
    { style: "flat", scene: "一位旅客拖着行李箱在机场候机大厅看向窗外的客机" },
    { style: "water", scene: "一男一女两位旅客在机场柜台前询问，工作人员在柜台后" },
    { style: "toon", scene: "一群旅客拖着行李在机场候机大厅排队" },
  ],

  // ── 应试考试 ───────────────────────────────────────────────────────────────
  exam_prep__ielts_toefl: [
    { style: "flat", scene: "一个考生在书桌前低头沉思，桌上放着合上的试卷" },
    { style: "water", scene: "一男一女两位考生在考场外的走廊上对答案" },
    { style: "toon", scene: "一群考生在考场里低头沉思" },
  ],
  exam_prep__cet_4_6: [
    { style: "flat", scene: "一位大学生在阶梯教室的座位上抬头听讲" },
    { style: "water", scene: "一男一女两位大学生在教室后排小声讨论题目" },
    { style: "toon", scene: "一群大学生在阶梯教室里上课，前方是空白的黑板" },
  ],
  exam_prep__pte: [
    { style: "flat", scene: "一位考生坐在电脑前双手放在键盘上，屏幕亮着柔和的空白光" },
    { style: "water", scene: "一男一女两位考生在机房相邻的电脑前，各自侧头看向对方" },
    { style: "toon", scene: "一群考生在电脑机房里各自坐在屏幕前，屏幕亮着柔光" },
  ],
  exam_prep__gaokao: [
    { style: "flat", scene: "一位高三学生在堆满资料的书桌前复习，旁边立着空白台历" },
    { style: "water", scene: "一男一女两位高中生在教室窗边互相抽查知识点" },
    { style: "toon", scene: "一群高三学生在教室里埋头复习，桌上堆满资料" },
  ],
  exam_prep__zhuan_sheng_ben: [
    { style: "flat", scene: "一位学生在图书馆靠窗的阅览桌前看书" },
    { style: "water", scene: "一男一女两位学生在书架之间小声讨论" },
    { style: "toon", scene: "一群学生在图书馆的长桌旁安静自习" },
  ],
  exam_prep__zhongkao: [
    { style: "flat", scene: "一位初中生坐在课桌前抬头听讲，手边放着合上的练习册" },
    { style: "water", scene: "一男一女两位初中生在课间对着课本讨论" },
    { style: "toon", scene: "一群初中生在教室里听讲，前方是空白的黑板" },
  ],
  exam_prep__postgraduate: [
    { style: "flat", scene: "一位考研学生在深夜的台灯下埋头读书，手边一杯热茶" },
    { style: "water", scene: "一男一女两位考研学生在自习室的相邻座位互相鼓励" },
    { style: "toon", scene: "几位考研学生在深夜的自习室里一起复习" },
  ],
  exam_prep__degree_english: [
    { style: "flat", scene: "一位成年学生就着台灯坐在夜校教室里，双手交叠在桌面上" },
    { style: "water", scene: "一男一女两位成年学生在夜校课间交谈" },
    { style: "toon", scene: "一群成年学生在夜校教室里上课" },
  ],
  exam_prep__tem_4_8: [
    { style: "flat", scene: "一位学生抱着一本厚重的词典站在书桌前，抬头看向镜头" },
    { style: "water", scene: "一男一女两位英语专业学生对着合上的词典争论，词典放在桌角" },
    { style: "toon", scene: "一群英语专业学生在教室里彼此交谈，桌上放着合上的词典" },
  ],
  exam_prep__pet: [
    { style: "flat", scene: "两个小学生在书桌前一起说笑，桌上散着一盒彩色铅笔" },
    { style: "water", scene: "一位小女孩转头对身旁的小男孩说话，桌上放着彩色铅笔" },
    { style: "toon", scene: "一群小学生围着桌子一起说笑，桌上散落彩色铅笔" },
  ],
  exam_prep__gre: [
    { style: "flat", scene: "一位考生在堆满厚书的书桌前抬头思考，身后立着一块空白白板" },
    { style: "water", scene: "一男一女两位考生在自习室里互相讲解难题" },
    { style: "toon", scene: "几位考生在自习室里对着厚书复习" },
  ],
  exam_prep__toeic: [
    { style: "flat", scene: "一位上班族在办公室隔间里对着文件与咖啡工作" },
    { style: "water", scene: "一男一女两位同事在隔间旁站着讨论一份文件" },
    { style: "toon", scene: "一群上班族在开放式办公室里各自工作" },
  ],
  exam_prep__ket: [
    { style: "flat", scene: "两个孩子在明亮的阅读角一起翻一本图画书" },
    { style: "water", scene: "一位小女孩坐在彩色坐垫上给同伴讲故事" },
    { style: "toon", scene: "一群孩子围坐在阅读角听故事" },
  ],
  exam_prep__fce: [
    { style: "flat", scene: "一位学生在笔记本电脑前做笔记，手边摊开一本笔记本" },
    { style: "water", scene: "一男一女两位学生对着同一台笔记本讨论" },
    { style: "toon", scene: "一群学生在电脑教室里各自坐在屏幕前，屏幕亮着柔光" },
  ],
  exam_prep__general: [
    { style: "flat", scene: "一位考生在考场座位上抬头看墙上的挂钟" },
    { style: "water", scene: "一男一女两位监考老师在考场过道里缓步走动" },
    { style: "toon", scene: "一群考生在考场里低头沉思" },
  ],

  // ── 分级阅读 ───────────────────────────────────────────────────────────────
  graded_reading__oxford_reading_tree: [
    { style: "flat", scene: "一个小男孩在花园草坪上和小狗玩球，脚边一个浇花水桶" },
    { style: "water", scene: "一位小女孩蹲在草地上给小狗看手里的红色皮球" },
    { style: "toon", scene: "一群孩子在花园里和小狗一起玩耍" },
  ],
  graded_reading__lets_go: [
    { style: "flat", scene: "两个孩子在安静的街道上并肩走，两侧是低矮的房子" },
    { style: "water", scene: "一位小男孩在小镇街角向一位小女孩挥手打招呼" },
    { style: "toon", scene: "一群孩子在小镇街道上结伴而行" },
  ],
  graded_reading__raz: [
    { style: "flat", scene: "一个小女孩在农场木栅栏旁喂几只小鸡" },
    { style: "water", scene: "一位小男孩坐在谷仓门口给身旁的同伴看手里的鸡蛋" },
    { style: "toon", scene: "一群孩子和动物一起在农场上" },
  ],
  graded_reading__heinemann: [
    { style: "flat", scene: "一个小女孩蹲在花园里观察停在花上的一只蝴蝶" },
    { style: "water", scene: "一位小男孩指着花丛让身旁的小女孩看" },
    { style: "toon", scene: "一群孩子在花园里一起赏花" },
  ],
  graded_reading__big_cat: [
    { style: "flat", scene: "一个孩子撑着伞走在雨后花园的小径上" },
    { style: "water", scene: "一位小女孩蹲下来看叶尖上的水珠，同伴在旁边" },
    { style: "toon", scene: "一群孩子撑着伞走在雨后的花园里" },
  ],
  graded_reading__oxford_bookworm: [
    { style: "flat", scene: "一位读者坐在老式书房的皮质扶手椅上读书" },
    { style: "water", scene: "一男一女两位读者在书房里各自捧着一本书" },
    { style: "toon", scene: "几位读者在堆满书的书房里安静阅读" },
  ],
  graded_reading__red_rocket: [
    { style: "flat", scene: "两个孩子在海边沙滩上捡贝壳，远处是灯塔" },
    { style: "water", scene: "一位小女孩把捡到的贝壳递给身旁的小男孩看" },
    { style: "toon", scene: "一群孩子在海边沙滩上玩耍" },
  ],
  graded_reading__general: [
    { style: "flat", scene: "一个人坐在秋日公园的长椅上读书，落叶铺满小路" },
    { style: "water", scene: "一男一女两位年轻人在公园长椅上并肩看书" },
    { style: "toon", scene: "一家人在秋日公园里散步" },
  ],

  // ── 中小学同步 ─────────────────────────────────────────────────────────────
  school_sync__grade_4: [
    { style: "flat", scene: "一男一女两个小学生在校园跑道上并肩奔跑" },
    { style: "water", scene: "一位小女孩在跑道边给跑步的同伴加油" },
    { style: "toon", scene: "一群小学生在校园操场上活动" },
  ],
  school_sync__grade_3: [
    { style: "flat", scene: "两个小学生在公交站台等车，一辆黄色公交车正在停靠" },
    { style: "water", scene: "一位小男孩牵着身旁小女孩的手走向停靠的校车" },
    { style: "toon", scene: "一群小学生排队登上一辆黄色校车" },
  ],
  school_sync__grade_8: [
    { style: "flat", scene: "一男一女两位中学生在教学楼前的林荫道上边走边聊" },
    { style: "water", scene: "一位中学生靠在梧桐树干上等同伴" },
    { style: "toon", scene: "一群中学生走在教学楼前的林荫道上" },
  ],
  school_sync__grade_1: [
    { style: "flat", scene: "一位小学老师在矮课桌旁弯腰给一个孩子讲解" },
    { style: "water", scene: "两个小朋友在矮课桌旁一起摆弄彩色粉笔盒" },
    { style: "toon", scene: "一群小朋友在小学教室里围坐上课" },
  ],
  school_sync__grade_7: [
    { style: "flat", scene: "一位学生在校园图书馆靠窗的桌边读书" },
    { style: "water", scene: "一男一女两位同学在书架之间小声交谈" },
    { style: "toon", scene: "一群学生在校园图书馆里一起阅读" },
  ],
  school_sync__grade_5: [
    { style: "flat", scene: "几位小学生在开满花的校门口道别" },
    { style: "water", scene: "一位小女孩在校门口的老树下向同伴挥手" },
    { style: "toon", scene: "一群小学生放学后在校门口道别" },
  ],
  school_sync__grade_6: [
    { style: "flat", scene: "两个小学生在科学教室的实验台前一起观察玻璃器皿" },
    { style: "water", scene: "一位小女孩举着量杯让身旁的同伴看液体颜色" },
    { style: "toon", scene: "一群小学生在科学教室里做实验" },
  ],
  school_sync__general: [
    { style: "flat", scene: "一位学生在校园跑道上慢跑，远处是教学楼" },
    { style: "water", scene: "两位学生在跑道旁的教学楼前交谈" },
    { style: "toon", scene: "一群学生在校园跑道上集合" },
  ],
  school_sync__high_school: [
    { style: "flat", scene: "一男一女两位高中生在教室窗边讨论课本" },
    { style: "water", scene: "一位高中生靠在窗边看窗外的大树，手边放着书本" },
    { style: "toon", scene: "一群高中生在教室里围着桌子讨论" },
  ],
  school_sync__grade_9: [
    { style: "flat", scene: "一位初三学生在晚自习教室的灯下做题" },
    { style: "water", scene: "一男一女两位同学在晚自习课间低声讨论" },
    { style: "toon", scene: "一群初三学生在晚自习教室里复习" },
  ],
  school_sync__grade_2: [
    { style: "flat", scene: "一位小女孩趴在窗台上摆弄彩色粉笔与小盆栽" },
    { style: "water", scene: "两个小朋友在窗台旁一起给盆栽浇水" },
    { style: "toon", scene: "一群小朋友在小学教室里画画" },
  ],
  school_sync__vocational: [
    { style: "flat", scene: "两位职校学生在实训教室的工作台前一起操作工具" },
    { style: "water", scene: "一位职校学生举着工具向身旁的同学演示" },
    { style: "toon", scene: "一群职校学生在实训教室里操作设备" },
  ],
}

/**
 * 槽位清单与场景映射必须完全对齐，且每个槽位恰好配 **3** 个变体
 * （与 COVER_VARIANTS_PER_THEME 一致）。
 *
 * 漏写会让提示词缺掉画面主体、生成一张与课程无关的图，而且不会有任何报错；
 * 多写则会让 buildJobs 生成重复或错位的文件。宁可启动就失败。
 */
function assertScenesCoverSlots(): void {
  const slugs = COVER_THEME_SLOTS.map((s) => themeSlug(s.categoryKey, s.subCategoryKey))
  const missing = slugs.filter((s) => !SCENES[s])
  const extra = Object.keys(SCENES).filter((s) => !slugs.includes(s))
  const wrongCount = slugs.filter(
    (s) => SCENES[s] && SCENES[s].length !== COVER_VARIANTS_PER_THEME,
  )
  if (missing.length || extra.length || wrongCount.length) {
    throw new Error(
      `槽位与场景不匹配：缺场景 ${missing.length} 个 [${missing.join(", ")}]，` +
        `多余场景 ${extra.length} 个 [${extra.join(", ")}]，` +
        `变体数不等于 ${COVER_VARIANTS_PER_THEME} 的槽位 ${wrongCount.length} 个 [${wrongCount.join(", ")}]`,
    )
  }
  // 同一槽位的三张图必须风格各不相同，否则「风格交替」这个目标就落空了
  const sameStyle = slugs.filter((s) => new Set(SCENES[s].map((v) => v.style)).size < 2)
  if (sameStyle.length) {
    throw new Error(`这些槽位的变体风格过于单一：${sameStyle.join(", ")}`)
  }
}

/**
 * 提示词结构：风格+配色前置 → 具体场景 → 构图 → 风格与配色再钉一次。
 * 为什么风格必须前置、为什么配色必须写进风格约束，见 STYLE_LEAD 上方的说明。
 */
function buildPrompt(style: StyleKey, scene: string, variantIndex: number): string {
  return (
    `${STYLE_LEAD[style]}。` +
    `画面内容：${scene}。` +
    `${COMPOSITIONS[variantIndex]}，${COMPOSE_BASE}。` +
    `${BLANK_SURFACES}。` +
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
    const variants = SCENES[slug]
    for (let v = 0; v < variants.length; v++) {
      const spec = variants[v]
      const name = `${slug}__v${v + 1}`
      jobs.push({
        slug,
        style: spec.style,
        variant: v,
        prompt: buildPrompt(spec.style, spec.scene, v),
        negative: NEGATIVE[spec.style],
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
