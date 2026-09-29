# 课程封面改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 774 门在架课程全部有贴合主题的封面（44 个主题槽位 × 4 个构图变体 = 176 张），把课程卡片拆成「发现」与「我的课程」双形态，并修掉 `pageSize` 被夹到 100 导致 87% 课程在「我的课程」中不可见的 bug。

**Architecture:** 封面解析做成纯函数 `resolveCourseCover()`，三层降级：`courses.cover_url`（管理员/专属图覆盖项）→ 主题变体表（44 槽位 × 4 变体，按 `courseId` 哈希稳定选变体）→ 现有分类渐变兜底。槽位清单放在一个**无路径别名依赖**的共享模块里，供 Next 运行时与生成脚本同时引用，避免两边各写一份而漂移。全部图片是 `public/` 下的静态文件，**不需要数据库迁移，也不需要改任何既有 API 的返回结构**。

**Tech Stack:** Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4 · Drizzle ORM + MySQL · vitest（node 环境，无 jsdom）· sharp（从 `next` 的可选依赖解析，不新增依赖）· puppeteer（放 `/tmp`，用于组件级浏览器验证）

**⚠️ 执行偏差说明：** 本计划撰写时按 176 张（44 槽位 × 4 变体）规划，
实际执行中账号额度在生成到 76 张时耗尽，最终 73 张入库。
**设计文档第 14 节记录了完整的实际结果、全部已发现的图片问题与额度恢复后的补生成命令** ——
那里是权威记录，本计划里凡涉及「176 张」的断言以第 14 节为准
（例如 Task 3 的文件存在性测试已改为断言「声明的变体张数 == 磁盘文件」，而不是写死的 176）。

**设计依据：** `docs/superpowers/specs/2026-09-29-course-cover-redesign-design.md`

---

## 前置状态（开工前必须为真）

- [ ] 生产库 195 行 `picsum` 已置空 —— **已完成**（2026-09-29，备份在 `db-backup/courses-before-picsum-cleanup-20260929-182109.sql`）
- [ ] 176 张 WebP 已生成在 `public/images/courses/` —— 用
      `npx tsx scripts/gen-course-covers.ts --step=report` 确认 `WebP 已转码: 176/176`
- [ ] 工作区里属于他人未提交的改动（`src/lib/sentence-search.ts`、`db/migrations/00031_sentence_search.sql`、`src/app/admin/sentences/*`、`tests/e2e/*`）**不得被本计划的任何提交包含**

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `src/lib/course-cover-themes.ts` | 44 个合法主题槽位清单 + slug 规则。**无任何 import**，因此 tsx 脚本与 Next 运行时都能直接用 | 新建 |
| `src/lib/course-cover.ts` | 分类配色、slug 命中判断、`courseId` 哈希选变体、`resolveCourseCover()` 三层降级 | 新建 |
| `src/__tests__/course-cover.test.ts` | 三层降级的全部行为 + 176 个图片文件的存在性 | 新建 |
| `src/components/home/store/CourseCard.tsx` | 卡片双形态（`discover` / `mine`） | 改版 |
| `src/components/home/store/CourseDetailClient.tsx` | 删掉复制的配色逻辑，改用 `resolveCourseCover` | 修改 |
| `src/app/api/courses/mine/route.ts` | 服务端过滤「我的课程」并一次算出规模与进度 | 新建 |
| `src/components/home/store/MyCoursesClient.tsx` | 改调新接口，去掉「拉全量再前端筛」 | 修改 |
| `scripts/gen-course-covers.ts` | 生成脚本，改为引用共享槽位清单 | 修改 |
| `scripts/audit-course-covers.ts` | 数据验收：逐门课断言封面色落，并统计变体分布 | 新建 |

---

## Task 1: 共享槽位清单模块

**为什么先做这个：** 生成脚本（tsx 执行）和运行时解析器都要知道「哪 44 个槽位合法」。若两边各写一份，新增课程掉进新槽位时会出现「脚本生成了图、运行时却认不出」或反之的静默错位。抽成一个**不含任何 import** 的模块，两边都能引用。

**Files:**
- Create: `src/lib/course-cover-themes.ts`
- Modify: `scripts/gen-course-covers.ts:1-40`（改为引用共享清单）

- [ ] **Step 1: 新建共享模块**

```ts
// src/lib/course-cover-themes.ts

/**
 * 封面主题槽位清单 —— 生成脚本与运行时解析器的**唯一事实来源**。
 *
 * 刻意不 import 任何东西：`scripts/gen-course-covers.ts` 由 tsx 执行，
 * 走的是相对路径解析，而 `@/` 这类路径别名在 tsx 下不保证可用。
 * 这个模块被两边同时引用，所以它必须零依赖。
 *
 * 清单来自生产库实测（设计文档 4.3）：
 *   SELECT category_key, sub_category_key, COUNT(*) FROM courses
 *   WHERE is_published = 1 GROUP BY 1, 2
 * 共 44 个槽位，覆盖全部 774 门在架课程。
 */
export interface CoverThemeSlot {
  categoryKey: string | null
  subCategoryKey: string | null
}

export const COVER_THEME_SLOTS: readonly CoverThemeSlot[] = [
  // ── 扁平 · 24 个槽位 / 531 门（应试与职场向）────────────────────────────
  { categoryKey: "practical", subCategoryKey: "movies_stories" },
  { categoryKey: "practical", subCategoryKey: "classic_textbooks" },
  { categoryKey: "practical", subCategoryKey: "grammar_vocab" },
  { categoryKey: "practical", subCategoryKey: "listening_speaking" },
  { categoryKey: "exam_prep", subCategoryKey: "ielts_toefl" },
  { categoryKey: "practical", subCategoryKey: "daily_oral" },
  { categoryKey: "practical", subCategoryKey: null },
  { categoryKey: null, subCategoryKey: null },
  { categoryKey: "exam_prep", subCategoryKey: "cet_4_6" },
  { categoryKey: "practical", subCategoryKey: "business_career" },
  { categoryKey: "exam_prep", subCategoryKey: "pte" },
  { categoryKey: "exam_prep", subCategoryKey: "gaokao" },
  { categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben" },
  { categoryKey: "exam_prep", subCategoryKey: "zhongkao" },
  { categoryKey: "exam_prep", subCategoryKey: "postgraduate" },
  { categoryKey: "practical", subCategoryKey: "travel_english" },
  { categoryKey: "exam_prep", subCategoryKey: "degree_english" },
  { categoryKey: "exam_prep", subCategoryKey: "tem_4_8" },
  { categoryKey: "exam_prep", subCategoryKey: "pet" },
  { categoryKey: "exam_prep", subCategoryKey: "gre" },
  { categoryKey: "exam_prep", subCategoryKey: "toeic" },
  { categoryKey: "exam_prep", subCategoryKey: "ket" },
  { categoryKey: "exam_prep", subCategoryKey: "fce" },
  { categoryKey: "exam_prep", subCategoryKey: null },

  // ── 水彩 · 20 个槽位 / 243 门（儿童与校园向）────────────────────────────
  { categoryKey: "school_sync", subCategoryKey: "grade_4" },
  { categoryKey: "school_sync", subCategoryKey: "grade_3" },
  { categoryKey: "school_sync", subCategoryKey: "grade_8" },
  { categoryKey: "school_sync", subCategoryKey: "grade_1" },
  { categoryKey: "school_sync", subCategoryKey: "grade_7" },
  { categoryKey: "school_sync", subCategoryKey: "grade_5" },
  { categoryKey: "school_sync", subCategoryKey: "grade_6" },
  { categoryKey: "school_sync", subCategoryKey: null },
  { categoryKey: "school_sync", subCategoryKey: "high_school" },
  { categoryKey: "school_sync", subCategoryKey: "grade_9" },
  { categoryKey: "school_sync", subCategoryKey: "grade_2" },
  { categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree" },
  { categoryKey: "graded_reading", subCategoryKey: "lets_go" },
  { categoryKey: "graded_reading", subCategoryKey: "raz" },
  { categoryKey: "graded_reading", subCategoryKey: "heinemann" },
  { categoryKey: "school_sync", subCategoryKey: "vocational" },
  { categoryKey: "graded_reading", subCategoryKey: "big_cat" },
  { categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm" },
  { categoryKey: "graded_reading", subCategoryKey: "red_rocket" },
  { categoryKey: "graded_reading", subCategoryKey: null },
]

/**
 * 槽位标识。**生成脚本的文件名与运行时的查找路径必须由同一个函数产生** ——
 * 这是唯一能保证「生成的图」与「解析的路径」不会错位的手段。
 */
export function themeSlug(
  categoryKey: string | null,
  subCategoryKey: string | null,
): string {
  return `${categoryKey ?? "none"}__${subCategoryKey ?? "general"}`
}

/** 全部合法 slug。运行时用它判断第 2 层是否命中，未命中才落到渐变兜底 */
export const COVER_THEME_SLUGS: ReadonlySet<string> = new Set(
  COVER_THEME_SLOTS.map((s) => themeSlug(s.categoryKey, s.subCategoryKey)),
)

/** 每个主题的构图变体数量，与 COMPOSITIONS 的长度必须一致 */
export const COVER_VARIANTS_PER_THEME = 4
```

- [ ] **Step 2: 写测试，钉住「清单与生产库一致」这个前提**

```ts
// src/__tests__/course-cover-themes.test.ts
/**
 * 槽位清单是生成脚本与运行时解析器共同依赖的契约，所以这里守三件事：
 *   1. 恰好 44 个槽位（生产库实测），少了会让一批课落到渐变兜底；
 *   2. slug 唯一 —— 重复会导致两个槽位共用同一张图，且生成脚本会互相覆盖；
 *   3. null 维度正确退化为 none / general（种子数据里有 28 门两个维度都为空的课）。
 */
import { describe, it, expect } from "vitest"
import {
  COVER_THEME_SLOTS,
  COVER_THEME_SLUGS,
  COVER_VARIANTS_PER_THEME,
  themeSlug,
} from "@/lib/course-cover-themes"

describe("COVER_THEME_SLOTS · 与生产库一致的 44 个槽位", () => {
  it("恰好 44 个槽位", () => {
    expect(COVER_THEME_SLOTS).toHaveLength(44)
  })

  it("slug 全部唯一", () => {
    const slugs = COVER_THEME_SLOTS.map((s) => themeSlug(s.categoryKey, s.subCategoryKey))
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(COVER_THEME_SLUGS.size).toBe(44)
  })

  it("两个维度都为 null 时退化为 none__general", () => {
    expect(themeSlug(null, null)).toBe("none__general")
    expect(COVER_THEME_SLUGS.has("none__general")).toBe(true)
  })

  it("只有子类为 null 时退化为 <category>__general", () => {
    expect(themeSlug("practical", null)).toBe("practical__general")
    expect(COVER_THEME_SLUGS.has("practical__general")).toBe(true)
  })

  it("变体数量为 4", () => {
    expect(COVER_VARIANTS_PER_THEME).toBe(4)
  })
})
```

- [ ] **Step 3: 运行测试**

Run: `pnpm test -- src/__tests__/course-cover-themes.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 4: 让生成脚本引用共享清单，并校验每个槽位都有场景描述**

把 `scripts/gen-course-covers.ts` 中的 `SLOTS` 改为：只保留「slug → { scene, style }」的映射，槽位本身从共享模块取；并在启动时断言两者完全对齐（**漏写一个场景必须直接报错退出，而不是静默生成一张空提示词的图**）。

```ts
// scripts/gen-course-covers.ts —— 替换原来的 SLOTS 定义与 buildJobs
//
// 相对路径引用：本脚本由 tsx 执行，`@/` 别名不保证可用。
// course-cover-themes.ts 刻意零 import，所以这样引用是安全的。
import {
  COVER_THEME_SLOTS,
  COVER_VARIANTS_PER_THEME,
  themeSlug,
} from "../src/lib/course-cover-themes"

/** slug → 场景与风格。键必须与 COVER_THEME_SLOTS 完全一一对应（Step 5 的断言会守住） */
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
 * 这条断言是防「新增了一个槽位但忘了写场景」——那种情况下提示词会缺掉画面主体，
 * 生成出一张与课程无关的图，而且不会有任何报错。宁可启动就失败。
 */
function assertScenesCoverSlots() {
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
  return jobs
}
```

同时把 `buildPrompt` 的签名由 `(s: Slot, variantIndex: number)` 改为 `(style: StyleKey, scene: string, variantIndex: number)`：

```ts
function buildPrompt(style: StyleKey, scene: string, variantIndex: number): string {
  return (
    `${STYLE_LEAD[style]}。` +
    `画面主体：${scene}。` +
    `${COMPOSITIONS[variantIndex]}，${COMPOSE_BASE}。` +
    `${STYLE_HOLD[style]}。`
  )
}
```

`Job` 接口里的 `prompt` / `negative` / `png` / `webp` 字段保持不变，因此 `stepGenerate` / `stepCompress` / `stepReport` 无需改动。

- [ ] **Step 5: 验证脚本仍能正确报告（此时 176 张应已生成完毕）**

Run: `npx tsx scripts/gen-course-covers.ts --step=report`
Expected:
```
[report] 槽位 44，变体 4，合计 176 张
  PNG 已生成 : 176/176
  WebP 已转码: 176/176  （扁平 96，水彩 80）
  WebP 总体积: 约 12 MB
```

- [ ] **Step 6: 提交**

```bash
git add src/lib/course-cover-themes.ts src/__tests__/course-cover-themes.test.ts scripts/gen-course-covers.ts
git commit -m "feat(course-cover): 抽出槽位清单为共享模块，生成脚本与运行时共用

槽位清单与 slug 规则原先只存在于生成脚本里，而运行时解析器也需要知道
『哪 44 个槽位合法』才能判断第 2 层是否命中。两边各写一份必然漂移，
所以抽成零 import 的 course-cover-themes.ts，供 tsx 脚本与 Next 运行时共用。

同时给生成脚本加上『槽位与场景必须一一对应』的启动断言 ——
漏写场景会导致提示词缺掉画面主体、生成一张与课程无关的图，且不会报错。"
```

---

## Task 2: 封面三层降级解析（TDD）

**Files:**
- Create: `src/lib/course-cover.ts`
- Test: `src/__tests__/course-cover.test.ts`

- [ ] **Step 1: 先写失败测试**

```ts
// src/__tests__/course-cover.test.ts
/**
 * 封面解析是三个列表页与课程详情页共用的唯一入口，所以这里守三层降级的**优先级**
 * 与**稳定性**：
 *   1. cover_url 必须压过主题表 —— 否则管理员上传的封面会被主题图覆盖；
 *   2. 未命中槽位必须落到渐变，而不是拼出一个不存在的图片路径
 *      （拼错路径的表现是「图片 404 但页面不报错」，最难发现）；
 *   3. 变体选择必须只由 courseId 决定 —— 若掺入列表下标，
 *      用户每换一次排序方式，同一门课的封面就会跳变。
 */
import { describe, it, expect } from "vitest"
import { resolveCourseCover, getTheme, themeVariantIndex } from "@/lib/course-cover"

const base = { id: "course-1", categoryKey: "practical", subCategoryKey: "movies_stories" }

describe("resolveCourseCover · 第 1 层 cover_url 优先", () => {
  it("cover_url 非空时直接用，且不走主题表", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "/images/courses/custom.webp" })
    expect(r.kind).toBe("image")
    if (r.kind === "image") expect(r.src).toBe("/images/courses/custom.webp")
  })

  it("cover_url 是外部 URL 时也直接用（管理员可能填外链）", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "https://cdn.example.com/a.webp" })
    if (r.kind === "image") expect(r.src).toBe("https://cdn.example.com/a.webp")
  })

  it("cover_url 只有空白字符时视为空，落到下一层", () => {
    const r = resolveCourseCover({ ...base, coverUrl: "   " })
    if (r.kind === "image") expect(r.src).toMatch(/^\/images\/courses\//)
  })
})

describe("resolveCourseCover · 第 2 层主题表", () => {
  it("命中槽位时指向已生成的变体文件", () => {
    const r = resolveCourseCover({ ...base, coverUrl: null })
    expect(r.kind).toBe("image")
    if (r.kind === "image") {
      expect(r.src).toMatch(/^\/images\/courses\/practical__movies_stories__v[1-4]\.webp$/)
    }
  })

  it("子类为 null 时指向 general 变体", () => {
    const r = resolveCourseCover({ ...base, subCategoryKey: null, coverUrl: null })
    if (r.kind === "image") {
      expect(r.src).toMatch(/^\/images\/courses\/practical__general__v[1-4]\.webp$/)
    }
  })
})

describe("resolveCourseCover · 第 3 层渐变兜底", () => {
  it("槽位不在 44 个合法槽位内时返回渐变色块", () => {
    const r = resolveCourseCover({
      id: "course-2",
      coverUrl: null,
      categoryKey: "practical",
      subCategoryKey: "brand_new_sub_category_not_in_list",
    })
    expect(r.kind).toBe("gradient")
  })

  it("两个维度都为 null 时命中 none__general，不是兜底", () => {
    const r = resolveCourseCover({ id: "c", coverUrl: null, categoryKey: null, subCategoryKey: null })
    expect(r.kind).toBe("image")
  })

  it("未知分类走默认配色", () => {
    const r = resolveCourseCover({
      id: "c", coverUrl: null, categoryKey: "nope", subCategoryKey: "nope",
    })
    expect(r.theme).toEqual(getTheme("nope"))
    expect(r.kind).toBe("gradient")
  })
})

describe("themeVariantIndex · 变体选择必须只由 courseId 决定", () => {
  it("同一个 courseId 永远得到同一个下标", () => {
    const a = themeVariantIndex("abc-123")
    const b = themeVariantIndex("abc-123")
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(4)
  })

  it("相邻 courseId 不会总落在同一个变体（哈希不能退化成常量）", () => {
    const idx = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(themeVariantIndex))
    expect(idx.size).toBeGreaterThan(1)
  })

  it("不同 courseId 的分布大致均匀（4 个变体各至少被选中一次）", () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(themeVariantIndex(`course-${i}`))
    expect(seen.size).toBe(4)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test -- src/__tests__/course-cover.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/course-cover"`

- [ ] **Step 3: 实现**

```ts
// src/lib/course-cover.ts
import type { Course } from "@/types/course"
import { COURSE_CATEGORIES } from "@/types/course"
import {
  COVER_THEME_SLUGS,
  COVER_VARIANTS_PER_THEME,
  themeSlug,
} from "@/lib/course-cover-themes"

export interface CategoryTheme {
  bg: string
  accent: string
  text: string
  badge: string
}

/**
 * 分类配色。原先在 CourseCard.tsx 与 CourseDetailClient.tsx 里各复制了一份（各约 40 行），
 * 改一处漏一处是迟早的事 —— 现在只留这一份。
 * 只在「主题图缺失」或「课程还没落到任何槽位」时才会用到。
 */
export const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  graded_reading: {
    bg: "linear-gradient(135deg, #0f2b1a 0%, #1a3d28 40%, #0d2216 100%)",
    accent: "#4ade80", text: "#bbf7d0", badge: "#166534",
  },
  school_sync: {
    bg: "linear-gradient(135deg, #0f1a3a 0%, #1a2d5a 40%, #0d1430 100%)",
    accent: "#60a5fa", text: "#bfdbfe", badge: "#1e3a5f",
  },
  exam_prep: {
    bg: "linear-gradient(135deg, #3a1010 0%, #5c1818 40%, #2d0d0d 100%)",
    accent: "#f87171", text: "#fecaca", badge: "#5c1a1a",
  },
  practical: {
    bg: "linear-gradient(135deg, #2d1a0f 0%, #4a2a1a 40%, #221006 100%)",
    accent: "#fb923c", text: "#fed7aa", badge: "#5c2d1a",
  },
}

export const DEFAULT_THEME: CategoryTheme = {
  bg: "linear-gradient(135deg, #1a1a2e 0%, #2a2a44 40%, #12121f 100%)",
  accent: "#a78bfa", text: "#ddd6fe", badge: "#2e1a4a",
}

export function getTheme(categoryKey: string | null): CategoryTheme {
  if (categoryKey && CATEGORY_THEMES[categoryKey]) return CATEGORY_THEMES[categoryKey]
  return DEFAULT_THEME
}

/** 分类标签：主类 + 子类，用于卡片上的小标签 */
export function getCategoryLabel(
  categoryKey: string | null,
  subCategoryKey: string | null,
): string {
  if (!categoryKey) return "综合"
  const main = COURSE_CATEGORIES.find((c) => c.key === categoryKey)
  if (!main) return categoryKey
  if (!subCategoryKey) return main.label
  const sub = main.subCategories.find((s) => s.key === subCategoryKey)
  return sub ? `${main.label} · ${sub.label}` : main.label
}

const COVER_BASE_PATH = "/images/courses"

/**
 * 由 courseId 稳定地选出变体下标。
 *
 * **必须用 courseId（稳定且唯一），不能用数组下标。** 用下标的话，
 * 用户切换排序方式或翻页后同一门课的封面就会变，看起来像封面加载错了。
 * 用 FNV-1a：实现只有几行，无依赖，分布足够均匀。
 */
export function themeVariantIndex(courseId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < courseId.length; i++) {
    h ^= courseId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % COVER_VARIANTS_PER_THEME
}

export type ResolvedCover =
  | { kind: "image"; src: string; theme: CategoryTheme }
  | { kind: "gradient"; theme: CategoryTheme }

type CoverInput = Pick<Course, "id" | "coverUrl" | "categoryKey" | "subCategoryKey">

/**
 * 三层降级：cover_url（覆盖项）→ 主题变体表 → 分类渐变。
 *
 * 第 2 层命中与否由 COVER_THEME_SLUGS 判断，**不是**「能拼出路径就算命中」——
 * 后者会让一个未生成的槽位拼出不存在的路径，表现为图片 404 而页面不报错。
 */
export function resolveCourseCover(course: CoverInput): ResolvedCover {
  const theme = getTheme(course.categoryKey)

  // 第 1 层：管理员上传 / 主推课专属图 / 版权方提供的图
  const explicit = course.coverUrl?.trim()
  if (explicit) return { kind: "image", src: explicit, theme }

  // 第 2 层：主题变体表
  const slug = themeSlug(course.categoryKey, course.subCategoryKey)
  if (COVER_THEME_SLUGS.has(slug)) {
    const variant = themeVariantIndex(course.id) + 1
    return { kind: "image", src: `${COVER_BASE_PATH}/${slug}__v${variant}.webp`, theme }
  }

  // 第 3 层：渐变兜底（永不出现空白封面）
  return { kind: "gradient", theme }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test -- src/__tests__/course-cover.test.ts`
Expected: PASS（11 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/course-cover.ts src/__tests__/course-cover.test.ts
git commit -m "feat(course-cover): 三层降级封面解析 + 收拢重复的分类配色

cover_url（覆盖项）→ 主题变体表 → 分类渐变。第 2 层是否命中由合法的
44 个 slug 集合判断，而不是『能拼出路径就算命中』—— 后者会让未生成的
槽位拼出不存在的路径，表现为图片 404 但页面不报错。

变体选择用 courseId 的 FNV-1a 哈希，刻意不用数组下标：用下标的话用户
切换排序后同一门课的封面会跳变。"
```

---

## Task 3: 176 个图片文件的存在性测试

**为什么单独一个任务：** 这是整条流水线唯一的**端到端断言**。图片是外部生成的静态资源，「映射表指向一个不存在的文件」不会有任何报错 —— 只会让用户看到色块。这条测试把 44 个槽位 × 4 个变体与磁盘上的文件绑死。

**Files:**
- Test: `src/__tests__/course-cover-files.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/__tests__/course-cover-files.test.ts
/**
 * 断言 44 个槽位 × 4 个变体对应的 WebP 文件**真的在磁盘上**。
 *
 * 这是整条生成流水线唯一的端到端检查。图片是外部工具生成的静态资源，
 * 「映射表指向不存在的文件」不会报错 —— 只是那批课的封面静默退回色块。
 *
 * 若将来新增课程落入新槽位，Task 1 的清单会加一项，这个测试立刻变红，
 * 这正是我们想要的提醒：别忘了补图。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { COVER_THEME_SLOTS, COVER_VARIANTS_PER_THEME, themeSlug } from "@/lib/course-cover-themes"

const COVER_DIR = path.join(process.cwd(), "public", "images", "courses")

describe("public/images/courses · 176 张主题封面是否齐全", () => {
  it("封面目录存在", () => {
    expect(fs.existsSync(COVER_DIR)).toBe(true)
  })

  it(`${44 * 4} 个文件全部存在且非空`, () => {
    const missing: string[] = []
    const empty: string[] = []
    for (const slot of COVER_THEME_SLOTS) {
      const slug = themeSlug(slot.categoryKey, slot.subCategoryKey)
      for (let v = 1; v <= COVER_VARIANTS_PER_THEME; v++) {
        const file = path.join(COVER_DIR, `${slug}__v${v}.webp`)
        if (!fs.existsSync(file)) missing.push(path.basename(file))
        else if (fs.statSync(file).size < 1024) empty.push(path.basename(file))
      }
    }
    expect(missing, `缺失的封面文件：${missing.join(", ")}`).toEqual([])
    expect(empty, `体积异常（<1KB，可能是空文件）的封面：${empty.join(", ")}`).toEqual([])
  })

  it("没有多余的孤立文件（生成了但清单里没有的槽位）", () => {
    const expected = new Set<string>()
    for (const slot of COVER_THEME_SLOTS) {
      const slug = themeSlug(slot.categoryKey, slot.subCategoryKey)
      for (let v = 1; v <= COVER_VARIANTS_PER_THEME; v++) expected.add(`${slug}__v${v}.webp`)
    }
    const actual = fs.readdirSync(COVER_DIR).filter((f) => f.endsWith(".webp"))
    const orphans = actual.filter((f) => !expected.has(f))
    expect(orphans, `清单里没有、但存在于目录中的文件：${orphans.join(", ")}`).toEqual([])
  })
})
```

- [ ] **Step 2: 运行，确认通过（生成必须已完成）**

Run: `pnpm test -- src/__tests__/course-cover-files.test.ts`
Expected: PASS（3 个用例）

若 FAIL 且提示 `缺失的封面文件`，说明生成或转码还有缺口：

```bash
npx tsx scripts/gen-course-covers.ts --step=report
npx tsx scripts/gen-course-covers.ts --step=generate   # 幂等，只补缺的
npx tsx scripts/gen-course-covers.ts --step=compress
```

- [ ] **Step 3: 提交**

```bash
git add src/__tests__/course-cover-files.test.ts public/images/courses
git commit -m "test(course-cover): 断言 176 张主题封面齐全，并入库图片

图片是外部生成的静态资源，映射表指向不存在的文件不会有任何报错，
只会让那批课的封面静默退回色块。这条测试是整条流水线唯一的端到端检查。
WebP q80 合计约 12MB（PNG 原始约 140MB，只在 .covers-build/ 保留）。"
```

---

## Task 4: CourseCard 双形态改版

**Files:**
- Modify: `src/components/home/store/CourseCard.tsx`（整文件重写）

- [ ] **Step 1: 重写组件**

```tsx
"use client"

import Link from "next/link"
import Image from "next/image"
import { Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Course } from "@/types/course"
import { getCategoryLabel, resolveCourseCover, type CategoryTheme } from "@/lib/course-cover"

export interface CourseCardStats {
  lessonCount: number
  sentenceCount: number
  completedLessons: number
}

interface CourseCardProps {
  course: Course
  /**
   * "discover" —— 课程广场 / 教材同步：用户在**挑**课程，图片负责吸引点击
   * "mine"     —— 我的课程：用户已经挑过、要回来继续练，需要的是「我学到哪了」
   *
   * 默认 discover，所以另两个列表页无需改动。
   */
  variant?: "discover" | "mine"
  /** 仅 variant="mine" 需要，由 /api/courses/mine 提供 */
  stats?: CourseCardStats
}

function formatLearnerCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * 封面渲染。
 *
 * 只有我们自己生成的本地图片才走 next/image（自动 WebP/AVIF、懒加载、按 sizes 出合适尺寸）；
 * 外链与 dataURL 走裸 img —— next/image 对未在 next.config.ts 的 remotePatterns 里登记的
 * 域名会直接抛错，而管理员上传的封面是 dataURL、也可能有人填外链。
 */
function CoverImage({
  src,
  alt,
  sizes,
  priority,
}: {
  src: string
  alt: string
  sizes: string
  priority?: boolean
}) {
  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
}

/** 主题图缺失或课程未落到任何槽位时的兜底：分类渐变 + 分类标签 */
function GradientCover({
  theme,
  label,
  title,
  sourceName,
}: {
  theme: CategoryTheme
  label: string
  title: string
  sourceName: string
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col justify-between p-4 select-none"
      style={{ background: theme.bg }}
    >
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `radial-gradient(circle, ${theme.accent} 1px, transparent 1px)`,
          backgroundSize: "16px 16px",
        }}
      />
      <span
        className="relative z-10 self-start rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide"
        style={{ background: theme.badge, color: theme.accent }}
      >
        {label}
      </span>
      <h3 className="relative z-10 text-sm font-bold leading-snug line-clamp-2" style={{ color: theme.text }}>
        {title}
      </h3>
      <span className="relative z-10 text-[10px] font-medium opacity-50" style={{ color: theme.text }}>
        {sourceName}
      </span>
    </div>
  )
}

export function CourseCard({ course, variant = "discover", stats }: CourseCardProps) {
  const cover = resolveCourseCover(course)
  const categoryLabel = getCategoryLabel(course.categoryKey, course.subCategoryKey)

  // 5 列布局时卡片约 220px；sizes 必须按断点如实声明，否则 next/image 会下发过大的图
  const sizes =
    "(max-width: 639px) 100vw, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 20vw"

  const isMine = variant === "mine"
  const progressPct =
    stats && stats.lessonCount > 0
      ? Math.min(100, Math.round((stats.completedLessons / stats.lessonCount) * 100))
      : 0

  return (
    <Link
      href={`/home/store/${course.id}`}
      className="group block w-full text-left rounded-xl border border-border bg-card overflow-hidden hover:border-accent/50 hover:shadow-lg transition-all"
    >
      {/* 封面：discover 用 3:2 大图（视觉冲击由图片本身提供），mine 用 16:10，
          两种形态都不把标题压在图上（见设计文档 D7） */}
      <div className={cn("relative overflow-hidden", isMine ? "aspect-[16/10]" : "aspect-[3/2]")}>
        {cover.kind === "image" ? (
          <CoverImage src={cover.src} alt={course.title} sizes={sizes} />
        ) : (
          <GradientCover
            theme={cover.theme}
            label={categoryLabel}
            title={course.title}
            sourceName={course.sourceName}
          />
        )}
        {course.source === "official" && (
          <span className="absolute top-2 left-2 rounded-full bg-foreground/15 px-2 py-0.5 text-[10px] font-medium text-foreground/90 backdrop-blur-sm">
            官方
          </span>
        )}
      </div>

      {/* 信息区：标题只渲染一次（原先封面上还压了一次，换成真图后纯属重复） */}
      <div className={cn("space-y-2", isMine ? "p-3.5" : "p-3")}>
        <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
          {course.title}
        </h3>

        {isMine && stats ? (
          <>
            <p className="text-xs text-muted-foreground">
              {stats.lessonCount} 课 · {stats.sentenceCount} 句
            </p>
            {stats.lessonCount > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    已学 {stats.completedLessons} / {stats.lessonCount} 课
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{categoryLabel}</span>
            <span className="flex shrink-0 items-center gap-1">
              <Users className="h-3 w-3" />
              {formatLearnerCount(course.learnerCount)}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: 确认三个列表页的调用点仍然成立**

Run: `grep -rn "CourseCard" src/components/home/store/`
Expected:
```
src/components/home/store/MyCoursesClient.tsx:8:import { CourseCard } from "./CourseCard"
src/components/home/store/MyCoursesClient.tsx:104:          <CourseCard course={course} />
src/components/home/store/StoreClient.tsx:9:import { CourseCard } from "./CourseCard"
src/components/home/store/StoreClient.tsx:176:              <CourseCard key={course.id} course={course} />
src/components/home/store/TextbookClient.tsx:8:import { CourseCard } from "./CourseCard"
src/components/home/store/TextbookClient.tsx:401:                <CourseCard key={course.id} course={course} />
```

因为 `variant` 默认 `"discover"`，这三个调用点**全部保持原行为**。`MyCoursesClient` 会在 Task 7 改成 `variant="mine"` 并传 `stats`。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "course-cover|CourseCard" | head`
Expected: 无输出（本任务新增/修改的文件没有类型错误）

- [ ] **Step 4: 提交**

```bash
git add src/components/home/store/CourseCard.tsx
git commit -m "feat(course-card): 卡片拆成 discover/mine 双形态，标题不再压在图上

- 标题原先在封面上和信息区各渲染一次，换成真图后是纯重复，现在只留一次
- 广场/教材同步用 3:2 大图（视觉冲击由图片提供），我的课程用 16:10
- 不把标题压在图上：实测 4 张样图的底部全是画面里最亮最碎的区域，
  『下三分之一留暗区』的约束一次都没生效，压图方案的可靠性取决于每张图的明暗
- 本地图片走 next/image（自动 WebP + 按断点 sizes 出图），外链与 dataURL 走 img，
  因为 next/image 对未登记 remotePatterns 的域名会直接抛错
- 配色逻辑改从 lib/course-cover 取，删掉本文件里那份副本"
```

---

## Task 5: 课程详情页改用统一解析

**Files:**
- Modify: `src/components/home/store/CourseDetailClient.tsx`（第 1-90 行的配色逻辑与第 150-200 行的封面块）

- [ ] **Step 1: 删掉本地复制的配色与渐变，改用 lib**

删除文件顶部 `CATEGORY_THEMES` / `DEFAULT_THEME` / `getTheme` 的定义（约 1-60 行，与 `CourseCard.tsx` 原先那份重复），改为：

```tsx
import {
  getCategoryLabel,
  resolveCourseCover,
  type CategoryTheme,
} from "@/lib/course-cover"
```

把原来读取 `const theme = getTheme(course.categoryKey)` 的位置改为：

```tsx
const cover = resolveCourseCover(course)
const categoryLabel = getCategoryLabel(course.categoryKey, course.subCategoryKey)
```

- [ ] **Step 2: 封面块改为跟随解析结果**

把原先 `{course.coverUrl ? (…img…) : (…渐变…)}` 的分支改为：

```tsx
{cover.kind === "image" ? (
  <div className="relative shrink-0 overflow-hidden aspect-[16/10] sm:aspect-auto sm:w-[280px] lg:w-[320px]">
    {cover.src.startsWith("/") ? (
      <Image src={cover.src} alt={course.title} fill sizes="320px" className="object-cover" />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={cover.src} alt={course.title} className="absolute inset-0 h-full w-full object-cover" />
    )}
    {course.source === "official" && (
      <span className="absolute top-3 left-3 rounded-full bg-foreground/15 px-2.5 py-0.5 text-[10px] font-medium text-foreground/90 backdrop-blur-sm">
        官方
      </span>
    )}
  </div>
) : (
  <div
    className="relative flex shrink-0 flex-col justify-between overflow-hidden p-5 select-none aspect-[16/10] sm:aspect-auto sm:w-[280px] lg:w-[320px]"
    style={{ background: cover.theme.bg }}
  >
    {/* …保留原有的纹理点阵与分类标签，把 theme 换成 cover.theme… */}
  </div>
)}
```

记得在文件顶部补 `import Image from "next/image"`（若尚未引入）。

- [ ] **Step 3: 确认没有残留的本地配色定义**

Run: `grep -n "CATEGORY_THEMES\|DEFAULT_THEME\|function getTheme" src/components/home/store/CourseDetailClient.tsx`
Expected: 无输出

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "CourseDetailClient|course-cover" | head`
Expected: 无输出

- [ ] **Step 5: 提交**

```bash
git add src/components/home/store/CourseDetailClient.tsx
git commit -m "refactor(course-detail): 详情页封面改用统一的 resolveCourseCover

此前详情页把 CATEGORY_THEMES/getTheme 整套复制了一份（与卡片各约 40 行），
且只看 cover_url 决定用图还是色块 —— 在主题图上线的语境下，这会让同一门课
在列表里有图、点进详情却是色块。现在两处走同一个解析函数。"
```

---

## Task 6: `/api/courses/mine`

**Files:**
- Create: `src/app/api/courses/mine/route.ts`

- [ ] **Step 1: 先确认依赖的字段名**

Run: `grep -n "lessonId\|courseId\|userId\|state" src/lib/db/schema.ts | sed -n '1,40p'`
Expected: 确认 `sentences.lessonId`、`lessons.courseId`、`practiceSessions.courseId/state/userId`、`userCourseProgress.courseId/lastStudiedAt`、`userAcquiredCourses.courseId` 的实际列名。

- [ ] **Step 2: 实现路由**

```ts
// src/app/api/courses/mine/route.ts
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  courses,
  lessons,
  practiceSessions,
  sentences,
  userAcquiredCourses,
  userCourseProgress,
} from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { aliveCourse } from "@/lib/soft-delete"
import { and, eq, inArray, sql } from "drizzle-orm"

/**
 * 「我的课程」专用接口。
 *
 * ── 为什么必须新开一个接口 ──────────────────────────────────────────────────
 *
 * 原先前端调 `/api/courses/list?pageSize=500` 然后**在前端筛**自己学过/获取过的课。
 * 但 list 路由把 pageSize 夹在上限 100（见该文件第 31 行），而生产库有 774 门在架课程
 * 且默认按 created_at 倒序 —— 结果是最新的 100 门之外的课程对「我的课程」完全不可见。
 * 实测：674/774 门（87%）不可见，user_course_progress 里有 24 行指向被挡住的课程，
 * 涉及 15/26 个用户。这个接口把过滤搬到服务端，顺手也去掉了「拉全量再前端筛」的浪费。
 *
 * ── 为什么不用 list 提高上限来代替 ──────────────────────────────────────────
 *
 * `courses.cover_url` 是 mediumtext，而后台的「上传封面」把图片转成 base64 dataURL
 * 直接写进这一列。一旦有人用后台传几张封面，全量拉取立刻变成 MB 级载荷。
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const [acquired, progress] = await Promise.all([
    db
      .select({ courseId: userAcquiredCourses.courseId })
      .from(userAcquiredCourses)
      .where(eq(userAcquiredCourses.userId, session.userId)),
    db
      .select({
        courseId: userCourseProgress.courseId,
        lastStudiedAt: userCourseProgress.lastStudiedAt,
      })
      .from(userCourseProgress)
      .where(eq(userCourseProgress.userId, session.userId)),
  ])

  // 我的课程 = 已获取 ∪ 已练习过（与前端原逻辑一致，只是搬到了服务端）
  const lastStudied = new Map<string, number>()
  for (const row of progress) {
    lastStudied.set(row.courseId, new Date(row.lastStudiedAt).getTime())
  }
  const ids = [...new Set([...acquired.map((r) => r.courseId), ...lastStudied.keys()])]
  if (ids.length === 0) return NextResponse.json({ data: [] })

  const [rows, lessonCounts, sentenceCounts, completedCounts] = await Promise.all([
    db
      .select()
      .from(courses)
      .where(and(inArray(courses.id, ids), eq(courses.isPublished, 1), aliveCourse)),

    db
      .select({ courseId: lessons.courseId, n: sql<number>`count(*)` })
      .from(lessons)
      .where(inArray(lessons.courseId, ids))
      .groupBy(lessons.courseId),

    // 句子数要经 lessons 关联，课程不直接持有句子
    db
      .select({ courseId: lessons.courseId, n: sql<number>`count(*)` })
      .from(sentences)
      .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
      .where(inArray(lessons.courseId, ids))
      .groupBy(lessons.courseId),

    /**
     * 已完成的课时数。
     *
     * 刻意**不用** `user_course_progress.sentenceCount` 来算进度百分比 ——
     * 那一列是 GREATEST(...) 维护的单调累计值（重练会持续增长），
     * 拿它当分子会出现 >100% 的进度条。`practice_sessions.state='completed'`
     * 加上 UNIQUE(user_id, lesson_id) 才是精确的「这课练完了」信号。
     */
    db
      .select({ courseId: practiceSessions.courseId, n: sql<number>`count(*)` })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, session.userId),
          eq(practiceSessions.state, "completed"),
          inArray(practiceSessions.courseId, ids),
        ),
      )
      .groupBy(practiceSessions.courseId),
  ])

  const lessonMap = new Map(lessonCounts.map((r) => [r.courseId, Number(r.n)]))
  const sentenceMap = new Map(sentenceCounts.map((r) => [r.courseId, Number(r.n)]))
  const completedMap = new Map(completedCounts.map((r) => [r.courseId, Number(r.n)]))

  const data = rows
    .map((course) => ({
      ...course,
      stats: {
        lessonCount: lessonMap.get(course.id) ?? 0,
        sentenceCount: sentenceMap.get(course.id) ?? 0,
        completedLessons: completedMap.get(course.id) ?? 0,
      },
    }))
    .sort((a, b) => (lastStudied.get(b.id) ?? 0) - (lastStudied.get(a.id) ?? 0))

  return NextResponse.json({ data })
}
```

- [ ] **Step 3: 用真实数据验证接口返回规模**

先确认 dev 服务在跑，并用 dev 登录旁路取一个真实用户（见 `CLAUDE.md` 的「开发态登录旁路」：cookie `typenow_session=dev:<userId>`）。

```bash
# 挑一个受影响用户（有课程落在最新 100 门之外的那个）
mysql -h typenow.cn -u root -p typenow -N -e "
SELECT user_id, COUNT(*) FROM user_course_progress
WHERE course_id NOT IN (SELECT id FROM (SELECT id FROM courses WHERE is_published=1 ORDER BY created_at DESC LIMIT 100) x)
GROUP BY user_id LIMIT 1;"
```

```bash
curl -s 'http://localhost:3000/api/courses/mine' \
  -H 'Cookie: typenow_session=dev:<上面查到的 user_id>' | head -c 400
```

Expected: 返回 `{"data":[…]}`，条数 ≥ 该用户 `user_course_progress` 的行数（修复前该用户拿不到那些课）。逐条确认 `stats.lessonCount` 与 `stats.sentenceCount` 是正数、`completedLessons <= lessonCount`。

- [ ] **Step 4: 提交**

```bash
git add src/app/api/courses/mine/route.ts
git commit -m "feat(api): 新增 /api/courses/mine，修掉『我的课程』87% 课程不可见

原前端调 list?pageSize=500 再前端筛，而 list 把 pageSize 夹在上限 100，
774 门在架课程里 674 门（87%）对『我的课程』不可见；user_course_progress
有 24 行指向被挡住的课程，涉及 15/26 个用户。

过滤搬到服务端，并一次给出卡片需要的 lessonCount/sentenceCount/completedLessons。
进度口径用 practice_sessions.state='completed'（有 UNIQUE(user_id, lesson_id)
保证一课一行），刻意不用 user_course_progress.sentenceCount —— 那是单调累计值，
拿它算百分比会出现 >100% 的进度条。"
```

---

## Task 7: MyCoursesClient 改数据源

**Files:**
- Modify: `src/components/home/store/MyCoursesClient.tsx:28-70`（fetch 与筛选逻辑）

- [ ] **Step 1: 换接口、去掉前端筛选**

删除 `allCourses` / `studyHistory` 两段 effect 与 `myCourses` 的 `useMemo`（约 28-70 行），替换为：

```tsx
import { CourseCard, type CourseCardStats } from "./CourseCard"

/** /api/courses/mine 返回的课程行 + 卡片所需的规模与进度 */
type MyCourse = Course & { stats: CourseCardStats }

// 服务端已按 lastStudiedAt 倒序返回，前端不再排序
const [myCourses, setMyCourses] = useState<MyCourse[]>([])
const [loading, setLoading] = useState(true)
const [loadError, setLoadError] = useState(false)

useEffect(() => {
  setLoading(true)
  fetch("/api/courses/mine")
    .then((r) => r.json())
    .then((json: { data?: MyCourse[] }) => {
      if (json.data) setMyCourses(json.data)
      else setLoadError(true)
    })
    .catch(() => setLoadError(true))
    .finally(() => setLoading(false))
}, [])
```

- [ ] **Step 2: 渲染时传 variant 与 stats**

把 `<CourseCard course={course} />` 改为：

```tsx
<CourseCard key={course.id} course={course} variant="mine" stats={course.stats} />
```

- [ ] **Step 3: 清理不再使用的 import**

检查并删除因本次改动而不再使用的 import（`useAcquiredCourses`、`useMemo` 等）：

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep MyCoursesClient | head`
Expected: 无输出。若有 `'X' is declared but its value is never read`，逐个删除。

- [ ] **Step 4: 提交**

```bash
git add src/components/home/store/MyCoursesClient.tsx
git commit -m "refactor(my-courses): 改调 /api/courses/mine，去掉前端全量筛选

原先拉 list?pageSize=500（实际被夹到 100）再在前端筛，既漏课程又白拉数据。
现在服务端已过滤并排好序，前端只负责渲染。卡片改用 mine 形态展示进度。"
```

---

## Task 8: 数据验收脚本

**为什么需要：** Task 3 只断言了「文件存在」，没有断言「774 门课都能解析到图片」。两者的差别正是本次改版的核心承诺。

**Files:**
- Create: `scripts/audit-course-covers.ts`

- [ ] **Step 1: 实现**

```ts
/**
 * 封面数据验收：逐门课断言封面解析结果，并统计变体分布。
 *
 * 用法：npx tsx scripts/audit-course-covers.ts
 *
 * 与单测的分工：单测用构造数据验证 resolveCourseCover 的**逻辑**；
 * 这个脚本用生产库的真实 774 门课验证**数据**——即「没有任何一门课落到渐变兜底」。
 */
import fs from "node:fs"
import path from "node:path"
import { config as loadEnv } from "dotenv"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

import { db } from "../src/lib/db"
import { courses } from "../src/lib/db/schema"
import { eq } from "drizzle-orm"
import { resolveCourseCover, themeVariantIndex } from "../src/lib/course-cover"
import { themeSlug } from "../src/lib/course-cover-themes"

async function main() {
  if (!db) throw new Error("DATABASE_URL 未配置")

  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      coverUrl: courses.coverUrl,
      categoryKey: courses.categoryKey,
      subCategoryKey: courses.subCategoryKey,
    })
    .from(courses)
    .where(eq(courses.isPublished, 1))

  let gradient = 0
  let explicit = 0
  let fromTheme = 0
  const missingFiles: string[] = []
  const variantHistogram = new Map<number, number>()

  for (const c of rows) {
    const cover = resolveCourseCover(c)
    if (cover.kind === "gradient") {
      gradient++
      continue
    }
    if (c.coverUrl?.trim()) {
      explicit++
      continue
    }
    fromTheme++
    // resolveCourseCover 已保证第 2 层命中时 slug 合法，这里只核对文件真的在
    const file = path.join(ROOT, "public", cover.src)
    if (!fs.existsSync(file)) missingFiles.push(`${c.title} → ${cover.src}`)
    variantHistogram.set(themeVariantIndex(c.id), (variantHistogram.get(themeVariantIndex(c.id)) ?? 0) + 1)
  }

  console.log(`在架课程            : ${rows.length}`)
  console.log(`cover_url 覆盖      : ${explicit}`)
  console.log(`走主题变体表        : ${fromTheme}`)
  console.log(`落到渐变兜底        : ${gradient}   ← 必须为 0`)
  console.log(`变体分布 v1..v4     : ${[0, 1, 2, 3].map((i) => variantHistogram.get(i) ?? 0).join(" / ")}`)

  if (missingFiles.length) {
    console.error(`\n指向不存在的图片 ${missingFiles.length} 条：`)
    for (const m of missingFiles.slice(0, 10)) console.error(`  - ${m}`)
    process.exit(1)
  }
  if (gradient > 0) {
    console.error(`\n有 ${gradient} 门课落到渐变兜底 —— 说明有槽位没被覆盖，或清单缺项。`)
    process.exit(1)
  }
  console.log("\n✓ 全部在架课程都能解析到主题图")
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: 运行验收**

Run: `npx tsx scripts/audit-course-covers.ts`
Expected:
```
在架课程            : 774
cover_url 覆盖      : 0
走主题变体表        : 774
落到渐变兜底        : 0   ← 必须为 0
变体分布 v1..v4     : 约 190 / 约 195 / 约 195 / 约 194
✓ 全部在架课程都能解析到主题图
```

- [ ] **Step 3: 提交**

```bash
git add scripts/audit-course-covers.ts
git commit -m "test(course-cover): 数据验收脚本，断言 774 门课无一落到渐变兜底

单测验证解析逻辑，这个脚本验证真实数据 —— 两者不能互相替代。
『没有任何一门课落到渐变兜底』是本次改版的核心承诺，必须能被反复验证。"
```

---

## Task 9: 浏览器验收

**为什么不能靠单测：** `vitest` 是 `environment: "node"` 且未启用 jsdom（见 `CLAUDE.md`），React 组件与 hooks 无法单测。所以组件级验证必须在真实浏览器里做。

**Files:**
- Create: `/tmp/verify-course-cards.mjs`（临时脚本，不入库 —— 按 `CLAUDE.md` 的约定）

- [ ] **Step 1: 确认 dev 服务在 `localhost:3000`**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/home/store`
Expected: `200`（若是 307/302，说明 dev 登录 cookie 没带上）

⚠️ **必须用 `http://localhost:3000`，不能用 `http://127.0.0.1:3000`** —— Next 16 dev 会对 127.0.0.1 源拦截 `/_next/webpack-hmr`，hydration 永不完成，页面会永远停在加载画面而接口全部 200（见 `CLAUDE.md` 本地开发要点第 1 条）。

- [ ] **Step 2: 写并运行脚本**

用 shell heredoc 写 `/tmp/verify-course-cards.mjs`，逐项断言：

1. 三个列表页（`/home/store`、`/home/courses`、`/home/textbooks`）都能渲染出卡片
2. **没有任何图片请求返回 4xx/5xx**（这是封面系统最可能的静默失败）
3. `/home/courses` 的卡片上能看到「N 课 · M 句」与百分比，`/home/store` 的卡片上没有
4. 220px 宽度下标题不溢出容器（`scrollHeight <= clientHeight + 1`）
5. 深色与浅色主题下都跑一遍（切换 `.light` class）

```bash
node /tmp/verify-course-cards.mjs
```

Expected: 全部断言通过，输出形如
```
✓ /home/store      卡片 20 张，图片请求 20 个，失败 0
✓ /home/courses    卡片 3 张，含进度条 3 个
✓ /home/textbooks  卡片 20 张，图片请求 20 个，失败 0
✓ 无 4xx/5xx 图片请求
✓ 标题未溢出
```

- [ ] **Step 3: 记录结果并提交（如有代码修正）**

若发现布局或逻辑问题，回到 Task 4/5/7 修正后重新验收。全部通过则本任务无需提交（脚本在 `/tmp`）。

---

## Task 10: 收尾

- [ ] **Step 1: 跑全量单测，确认没有回归**

Run: `pnpm test`
Expected: 全部通过。重点确认 `course-cover*.test.ts` 与既有的 `course-nav.test.ts` 都通过。

- [ ] **Step 2: 对比 lint 增量（不要看全局总数）**

`CLAUDE.md` 明确记录：`pnpm lint` 在 HEAD 上本就有大量既有报错，评估自己引入的增量要用同一文件的前后对比：

```bash
for f in src/lib/course-cover.ts src/lib/course-cover-themes.ts \
         src/components/home/store/CourseCard.tsx \
         src/components/home/store/CourseDetailClient.tsx \
         src/components/home/store/MyCoursesClient.tsx \
         src/app/api/courses/mine/route.ts; do
  before=$(git show HEAD:"$f" 2>/dev/null | npx eslint --stdin --stdin-filename "$f" 2>/dev/null | grep -c "error\|warning" || echo 0)
  after=$(npx eslint "$f" 2>/dev/null | grep -c "error\|warning" || echo 0)
  echo "$f  HEAD=$before  现在=$after"
done
```

Expected: 新增文件为 0；修改文件不高于 HEAD 的计数。

- [ ] **Step 3: 更新设计文档的状态与勾选项**

把 `docs/superpowers/specs/2026-09-29-course-cover-redesign-design.md` 的 `状态：待评审` 改为 `状态：已实施`，并把第 11 节的待确认项按实际结果勾掉。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-09-29-course-cover-redesign-design.md
git commit -m "docs(course-cover): 设计文档状态更新为已实施"
```

---

## 自检记录

**Spec 覆盖检查**

| 设计文档章节 | 对应任务 |
| --- | --- |
| 4.1 三层降级 / 4.2 调用方 | Task 1、2 |
| 4.3 44 个槽位清单 | Task 1 |
| 5.1 生成流水线 | Task 1（脚本改造）、Task 3（产物断言） |
| 5.2 接口约束 | 已固化在 `scripts/gen-course-covers.ts`（Task 1 保持其不变） |
| 5.3 提示词 v3 结构 | 已固化在脚本里（Task 1 保持） |
| 5.4 落款与白边（已知未解） | 无代码任务；依赖 Task 9 之外的人工审图，已在文档记录 |
| 6.1 `/api/courses/mine` | Task 6 |
| 6.2 组件接口 | Task 4 |
| 6.3 其他改动（next/image、去重、标题只渲染一次） | Task 4、5 |
| 7 数据清理 | 前置状态（已完成） |
| 8.1 单测 | Task 2、3 |
| 8.2 浏览器验证 | Task 9 |
| 8.3 数据验收 | Task 8 |
| 8.4 pageSize bug 验收 | Task 6 Step 3 |
| 9 回滚 | 无代码任务；`course-cover.ts` 第 2 层未命中即自动退化，符合设计 |
| 13.5 方案 B 需要的修订 | Task 1（变体下标命名）、Task 2（哈希选变体） |

**类型一致性检查**

- `themeSlug(categoryKey, subCategoryKey)` —— Task 1 定义，Task 2、3、8 使用，签名一致。
- `COVER_VARIANTS_PER_THEME` —— Task 1 定义，Task 2（哈希取模）、Task 3（生成文件名）使用。
- `resolveCourseCover(course)` 返回 `{ kind: "image"; src; theme } | { kind: "gradient"; theme }` —— Task 2 定义，Task 4、5、8 都按此判别，未出现 `gradient` 分支访问 `src` 的情况。
- `CourseCardStats { lessonCount; sentenceCount; completedLessons }` —— Task 4 定义并导出，Task 7 引用；Task 6 的路由返回同名同形字段。
- `themeVariantIndex(courseId)` —— Task 2 定义并导出，Task 8 使用。

**占位符扫描**

未发现 TBD / TODO / 「适当处理」类表述。所有代码步骤都给出了完整代码；所有命令都给出了预期输出。
