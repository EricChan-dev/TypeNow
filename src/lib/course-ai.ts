/**
 * 课程详情 AI 元数据（任务④）的纯函数层：类型、提示词构建、LLM 输出校验。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────────────
 *
 * 与 lib/lesson-insight.ts 同一条理由：决定「什么内容能进库/上屏」的规则必须
 * 无副作用、可单测。模型偶尔会在 JSON 外裹说明文字、漏字段、给错类型——
 * 这里逐块校验：合法的块照存，非法的块置 NULL，前端渲染「暂未生成」占位
 * （沿用 m20696 决议：不造假数据）。
 *
 * ── 与派生数据（lib/lesson-insight.ts）的分工 ────────────────────────────────
 *
 * 核心词汇/短语从 sentences JSON 现算（快、免费、每次请求都跑）；语法点与
 * 句子复杂度必须 LLM 生成（慢、花 token、单课节只算一次），产物落
 * lesson_ai_insights 缓存。两层数据在 /api/lessons/[id]/insight（派生）与
 * /api/lessons/[id]/ai（AI）两个接口分别下发，互不阻塞。
 */

/** 课节语法点（每课节 3-6 条）。 */
export interface GrammarPoint {
  /** 语法点名称（中文，如「一般过去时」） */
  point: string
  /** 面向学习者的中文解释（≤80 字） */
  explanation: string
  /** 例句（英文，优先取自本课节） */
  example?: string
  /** 例句中译 */
  exampleZh?: string
}

/** 课节句子复杂度（课节级总评）。 */
export interface LessonComplexity {
  /** 一句话中文总评 */
  summary: string
  /** 难度分布（easy/medium/hard 的句子数，合计应等于送入句数） */
  distribution: { easy: number; medium: number; hard: number }
  /** 最难例句（英文，取自本课节） */
  hardestExample?: string
  hardestExampleZh?: string
  /** 难在哪（中文，≤40 字） */
  hardestReason?: string
}

/**
 * 送入 LLM 的课节句数上限——控制 token 与延迟，课节超长时只分析前 18 句。
 *
 * 为什么是 18 而不是更大的 40：实测自定义路由（routers.opays.ai，on-premise
 * deepseek-v4.1-flash）生成约 16-20 token/s，40 句的提示词会产出 1200+ token 的
 * JSON，总耗时 ~120s 触发路由网关超时（502）。18 句把总时长压回 60s 内，
 * 且足够代表一课节的语法面貌（distribution 只统计送入样本）。
 */
export const MAX_ANALYZE_SENTENCES = 18

/** 课程简介送入的课节标题数上限。 */
export const MAX_INTRO_LESSON_TITLES = 30

/** 课程简介送入的示例句数上限。 */
export const MAX_INTRO_SAMPLE_SENTENCES = 20

// ─── LLM 输出校验（逐块放行，非法置 null）────────────────────────────────────

function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= maxLen
}

function asCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** 校验语法点数组；返回 null 表示整块不可用（前端渲染占位）。 */
export function validateGrammar(raw: unknown): GrammarPoint[] | null {
  if (!Array.isArray(raw)) return null
  const out: GrammarPoint[] = []
  for (const item of raw.slice(0, 8)) {
    if (typeof item !== "object" || item === null) continue
    const o = item as Record<string, unknown>
    if (!isNonEmptyString(o.point, 40) || !isNonEmptyString(o.explanation, 200)) continue
    out.push({
      point: o.point.trim(),
      explanation: o.explanation.trim(),
      ...(isNonEmptyString(o.example, 300) ? { example: o.example.trim() } : {}),
      ...(isNonEmptyString(o.exampleZh, 300) ? { exampleZh: o.exampleZh.trim() } : {}),
    })
  }
  return out.length > 0 ? out : null
}

/** 校验句子复杂度块；返回 null 表示整块不可用。 */
export function validateComplexity(raw: unknown): LessonComplexity | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  if (!isNonEmptyString(o.summary, 200)) return null
  if (typeof o.distribution !== "object" || o.distribution === null) return null
  const d = o.distribution as Record<string, unknown>
  const easy = asCount(d.easy)
  const medium = asCount(d.medium)
  const hard = asCount(d.hard)
  if (easy === null || medium === null || hard === null) return null
  return {
    summary: o.summary.trim(),
    distribution: { easy, medium, hard },
    ...(isNonEmptyString(o.hardestExample, 300) ? { hardestExample: o.hardestExample.trim() } : {}),
    ...(isNonEmptyString(o.hardestExampleZh, 300)
      ? { hardestExampleZh: o.hardestExampleZh.trim() }
      : {}),
    ...(isNonEmptyString(o.hardestReason, 80) ? { hardestReason: o.hardestReason.trim() } : {}),
  }
}

/** 校验课程简介；返回 null 表示不可用。 */
export function validateIntro(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const t = raw.trim()
  // 下限放宽到 80：目标 200-350 字是软约束，太短说明模型没干活，宁可不收
  return t.length >= 80 && t.length <= 1000 ? t : null
}

// ─── 提示词构建 ──────────────────────────────────────────────────────────────

const LESSON_SYSTEM_PROMPT = `你是一名专业的英语教研。根据给出的课节句子列表，产出这份课节的「语法点分析」与「句子复杂度分析」。

只返回纯 JSON，不要包含任何 markdown 标记或其他文字。JSON 格式：
{
  "grammar": [
    { "point": "语法点名称（中文）", "explanation": "面向学习者的中文解释，不超过80字", "example": "例句（英文，优先从给出的句子中选取)", "exampleZh": "例句中文翻译" }
  ],
  "complexity": {
    "summary": "对这份课节句子难度的一句话中文总评",
    "distribution": { "easy": 0, "medium": 0, "hard": 0 },
    "hardestExample": "最难的一句（英文，从给出的句子中选取）",
    "hardestExampleZh": "该句中文翻译",
    "hardestReason": "难在哪里（中文，不超过40字）"
  }
}

要求：
- grammar 给 3-5 条，只挑句子里真实出现的语法现象，按对学习者的重要性排序，explanation 不超过 60 字；
- distribution 的三个数必须非负且合计等于给出的句子总数，逐句判级后计数；
- hardestExample 必须逐字取自给出的句子，不要自编，hardestReason 不超过 30 字；
- 全部文字尽量精炼：输出的 JSON 总量控制在 600 字以内，避免超时。`

/** 课节分析的提示词。句子按 sortOrder 截到 MAX_ANALYZE_SENTENCES。 */
export function buildLessonAiPrompt(
  lessonTitle: string,
  sentences: Array<{ english: string; chinese: string | null }>
): { systemPrompt: string; userMessage: string } {
  const lines = sentences
    .slice(0, MAX_ANALYZE_SENTENCES)
    .map((s, i) => `${i + 1}. ${s.english}${s.chinese ? `（${s.chinese}）` : ""}`)
  return {
    systemPrompt: LESSON_SYSTEM_PROMPT,
    userMessage: `课节标题：${lessonTitle}\n句子列表（共 ${lines.length} 句）：\n${lines.join("\n")}`,
  }
}

const INTRO_SYSTEM_PROMPT = `你是一名专业的英语课程策划。根据给出的课程信息与内容样本，为学习者写一段导学性的课程简介。

只返回纯 JSON，不要包含任何 markdown 标记或其他文字。JSON 格式：
{ "intro": "课程简介正文" }

要求：
- 中文，200-350 字，分成 2-4 个自然段（用换行分隔，不要用序号或小标题）；
- 说清这门课适合谁、能学到什么、内容是怎么组织的、学完大概到什么水平；
- 口吻亲切务实，不夸大宣传，不出现「本课程」以外的站名或品牌名。`

/** 课程简介的提示词。 */
export function buildIntroPrompt(course: {
  title: string
  description?: string | null
  lessonTitles: string[]
  sampleSentences: string[]
}): { systemPrompt: string; userMessage: string } {
  const lessons = course.lessonTitles.slice(0, MAX_INTRO_LESSON_TITLES).map((t, i) => `${i + 1}. ${t}`)
  const samples = course.sampleSentences.slice(0, MAX_INTRO_SAMPLE_SENTENCES).map((s) => `- ${s}`)
  return {
    systemPrompt: INTRO_SYSTEM_PROMPT,
    userMessage: [
      `课程标题：${course.title}`,
      course.description ? `课程短描述：${course.description}` : null,
      `课节列表：\n${lessons.join("\n")}`,
      `内容样本（来自课节句子）：\n${samples.join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  }
}
