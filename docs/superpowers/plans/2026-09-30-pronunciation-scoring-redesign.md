# 跟读评分改版 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把跟读评分从练习页里的一行小标签改成独立弹窗（逐词评分 + 多维进度条 + 总评分与评语），并把评分落库，使其在练习页与大纲历史里可见。

**Architecture:** 评分能力（有道）与呈现解耦：`lib/pronunciation.ts` 保持不变，新增一个纯函数模块负责「评语生成」、一个 store 模块负责落库；`VoicePanel` 保留录音与调用，把**显示**交给新的 `PronunciationModal`（弹窗）与 `PronunciationCard`（关闭后的卡片）。跟读数据通过 `pronunciation_scores` 表持久化，一句话一行（`UNIQUE(user_id, sentence_id)`），在 `/api/courses/sentences` 里 LEFT JOIN 下发。

**Tech Stack:** Next.js 16（App Router）/ React 19 / TypeScript / Tailwind v4 / Drizzle ORM + MySQL 8 / vitest（单测与 e2e）

**设计文档：** `docs/superpowers/specs/2026-09-30-pronunciation-scoring-redesign-design.md`

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `db/migrations/00033_pronunciation_scores.sql` | 建表（新建，手工执行） |
| `src/lib/db/schema.ts` | 表声明（修改） |
| `db/README.md` | 迁移索引（修改） |
| `src/lib/pronunciation.ts` | `EvaluateResult` 加可选的 `comment`（修改） |
| `src/lib/pronunciation-comment.ts` | **新建**：评语生成，纯函数，无 IO |
| `src/__tests__/pronunciation-comment.test.ts` | **新建**：评语的单测 |
| `src/lib/pronunciation-store.ts` | **新建**：跟读分的读写（唯一碰这张表的地方） |
| `src/app/api/youdao/evaluate/route.ts` | 评分成功后落库（修改） |
| `src/app/api/courses/sentences/route.ts` | LEFT JOIN 下发跟读分（修改） |
| `src/types/index.ts` | `Sentence.pronunciation` 类型（修改） |
| `src/components/home/learn/PronunciationModal.tsx` | **新建**：评分弹窗（布局 C） |
| `src/components/home/learn/PronunciationCard.tsx` | **新建**：关闭后的卡片 |
| `src/components/home/learn/VoicePanel.tsx` | 改为「按钮 + 卡片 + 弹窗」（修改） |
| `src/components/home/learn/OutlineModal.tsx` | 大纲列表显示小分数（修改） |
| `src/components/home/learn/LearnClient.tsx` | 传整句而非只传 english（修改） |
| `tests/e2e/helpers/db.ts` | 把新表加进 TRUNCATE 清单（修改） |
| `tests/e2e/106-pronunciation.test.ts` | **新建**：落库与下发的 e2e |

**为什么评语单独一个文件**：它是这次唯一有真实逻辑分支（档位、最低分词、短板、兜底、不重复）的部分，独立成纯函数模块才能完整单测。store 单独一个文件是为了让「谁碰这张表」只有一个答案。

---

### Task 1: 建表与 schema

**Files:**
- Create: `db/migrations/00033_pronunciation_scores.sql`
- Modify: `src/lib/db/schema.ts`（在 `reviewQueue` 声明之后插入）
- Modify: `db/README.md`（迁移索引表末尾追加一行）

- [ ] **Step 1: 写迁移文件**

新建 `db/migrations/00033_pronunciation_scores.sql`：

```sql
-- 00033_pronunciation_scores.sql
-- 跟读评分持久化，设计见 docs/superpowers/specs/2026-09-30-pronunciation-scoring-redesign-design.md
--
-- ── 为什么是独立表而不是 practice_records 上加列 ─────────────────────────────
--
-- practice_records 是「每次作答一行」（同一句可以有多行），而跟读评分要的是
-- 「一句一行取最新」。挂上去会变成「取最新一行，而它可能没有跟读分」——
-- 查询别扭且容易写错。独立表 + UNIQUE(user_id, sentence_id) 才是它的形状。
--
-- ── 为什么 words 与 comment 也要存 ──────────────────────────────────────────
--
--   · words  —— 历史分点开「查看详情」时要渲染逐词分，没有它就只有一个总分
--   · comment —— 评语是评分那一刻生成的。不存的话，重开详情会重新生成一句
--                不一样的话，用户会以为评分变了
--
-- ── 为什么只留一行 ──────────────────────────────────────────────────────────
--
-- 产品决定：只保留最新一次（重录覆盖）。代价是日后做「进步曲线」没有历史
-- 数据可回溯 —— 这是明知的取舍，不是疏漏。
--
-- 回滚：
--   DROP TABLE IF EXISTS pronunciation_scores;

CREATE TABLE IF NOT EXISTS `pronunciation_scores` (
  `id`          VARCHAR(36)  NOT NULL,
  `user_id`     VARCHAR(36)  NOT NULL,
  `sentence_id` VARCHAR(36)  NOT NULL,
  `score`       INT          NOT NULL,
  `accuracy`    INT          NOT NULL,
  `fluency`     INT          NOT NULL,
  `integrity`   INT          NOT NULL,
  `speed`       DECIMAL(6,2) NULL,
  `words`       JSON         NULL,
  `comment`     VARCHAR(500) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pronunciation_user_sentence` (`user_id`, `sentence_id`),
  KEY `idx_pronunciation_user_updated` (`user_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: 在 schema.ts 里声明同名表**

在 `src/lib/db/schema.ts` 里 `export const reviewQueue = ...` 那个声明**之后**插入：

```ts
// ─── 跟读评分（有道语音评测）───────────────────────────────────────────────────
//
// 一句话一行：UNIQUE(user_id, sentence_id)，重录覆盖（产品决定只留最新一次）。
// 与练习进度**完全无关** —— 不写 practice_records / review_queue / 课程进度。
export const pronunciationScores = mysqlTable(
  "pronunciation_scores",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("user_id", { length: 36 }).notNull(),
    sentenceId: varchar("sentence_id", { length: 36 }).notNull(),
    score: int("score").notNull(),
    accuracy: int("accuracy").notNull(),
    fluency: int("fluency").notNull(),
    integrity: int("integrity").notNull(),
    // 有道可能不给语速
    speed: decimal("speed", { precision: 6, scale: 2 }),
    // 形状固定为 Array<{ word: string; score: number | null }>。
    // score 必须允许 null —— 有道的字段可能缺失，用 0 兜底会把「没给分」显示成「0 分」。
    words: json("words"),
    comment: varchar("comment", { length: 500 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uk_pronunciation_user_sentence").on(t.userId, t.sentenceId),
    index("idx_pronunciation_user_updated").on(t.userId, t.updatedAt),
  ]
)
```

若 `uniqueIndex` / `index` 未在文件顶部导入，补进现有的 drizzle-orm/mysql-core 导入行。

- [ ] **Step 3: 同步迁移索引**

在 `db/README.md` 的迁移索引表末尾追加一行（照现有行的格式）：

```
| `00033` | `pronunciation_scores` 表（跟读评分，一句话一行） | 2026-09-30 |
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出（干净）

- [ ] **Step 5: 提交**

```bash
git add db/migrations/00033_pronunciation_scores.sql src/lib/db/schema.ts db/README.md
git commit -m "feat(pronunciation): pronunciation_scores 表（一句话一行，重录覆盖）"
```

> **本任务不执行迁移。** 生产执行放在 Task 9。

---

### Task 1b: `EvaluateResult` 加可选的 `comment`

**Files:**
- Modify: `src/lib/pronunciation.ts`

- [ ] **Step 1: 加字段**

`/api/youdao/evaluate` 成功时会多回一个 `comment`（本次生成的评语），
客户端要能类型安全地读到它。在 `src/lib/pronunciation.ts` 的
`EvaluateResult` 接口里追加：

```ts
  /**
   * 本次生成的评语。
   *
   * 可选，因为**映射器不产生它** —— `mapYoudaoEvaluate` 只负责把有道响应
   * 转成我们的结构，评语是路由层用 buildComment 生成的。
   * 历史分（来自 pronunciation_scores）里这个字段也用它。
   */
  comment?: string | null
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add src/lib/pronunciation.ts
git commit -m "feat(pronunciation): EvaluateResult 加可选 comment"
```

---

### Task 2: 评语生成（纯函数 + 单测）

**Files:**
- Create: `src/lib/pronunciation-comment.ts`
- Test: `src/__tests__/pronunciation-comment.test.ts`

- [ ] **Step 1: 写失败的测试**

新建 `src/__tests__/pronunciation-comment.test.ts`：

```ts
import { describe, it, expect } from "vitest"
import { buildComment, type CommentInput } from "@/lib/pronunciation-comment"

/** 固定 rand，让选择可预测：返回 0 表示「总取第一条」。 */
const first = () => 0
/** 固定 rand，返回 0.999 表示「总取最后一条」。 */
const last = () => 0.999

function input(over: Partial<CommentInput> = {}): CommentInput {
  return {
    score: 86,
    accuracy: 84,
    fluency: 76,
    integrity: 100,
    words: [
      { word: "You", score: 92 },
      { word: "volume", score: 61 },
      { word: "button", score: 96 },
    ],
    previousComment: null,
    ...over,
  }
}

describe("buildComment · 总评档位", () => {
  it("≥95 用最高档", () => {
    expect(buildComment(input({ score: 98 }), first)).toContain("几乎无可挑剔")
  })
  it("85–94 档", () => {
    expect(buildComment(input({ score: 86 }), first)).toContain("很棒")
  })
  it("70–84 档", () => {
    expect(buildComment(input({ score: 75 }), first)).toContain("不错")
  })
  it("55–69 档", () => {
    expect(buildComment(input({ score: 60, accuracy: 60, fluency: 60 }), first)).toContain("还差一口气")
  })
  it("<55 档", () => {
    expect(buildComment(input({ score: 40, accuracy: 40, fluency: 40 }), first)).toContain("有点吃力")
  })
  it("档位边界：95 / 94 / 85 / 84 / 70 / 69 / 55 / 54 都落在预期档", () => {
    expect(buildComment(input({ score: 95 }), first)).toContain("几乎无可挑剔")
    expect(buildComment(input({ score: 94 }), first)).toContain("很棒")
    expect(buildComment(input({ score: 85 }), first)).toContain("很棒")
    expect(buildComment(input({ score: 84 }), first)).toContain("不错")
    expect(buildComment(input({ score: 70 }), first)).toContain("不错")
    expect(buildComment(input({ score: 69 }), first)).toContain("还差一口气")
    expect(buildComment(input({ score: 55 }), first)).toContain("还差一口气")
    expect(buildComment(input({ score: 54 }), first)).toContain("有点吃力")
  })
})

describe("buildComment · 覆盖规则", () => {
  it("★ 总分 < 30 时只说录音问题，不给发音建议", () => {
    const c = buildComment(input({ score: 12, accuracy: 10, fluency: 10, integrity: 10 }), first)
    expect(c).toContain("没录到声音")
    // 极低分通常是录音问题，此时点名词汇是误导
    expect(c).not.toContain("volume")
    expect(c).not.toContain("准确度")
  })

  it("★ 总分 = 100 时用满分文案，且不点最低分", () => {
    const c = buildComment(
      input({ score: 100, accuracy: 100, fluency: 100, words: [{ word: "the", score: 70 }] }),
      first,
    )
    expect(c).toContain("满分")
    expect(c).not.toContain("the")
  })
})

describe("buildComment · 最低分词", () => {
  it("★ 触发：最低分 < 75 且比句均分低 ≥12", () => {
    // 均分 (92+61+96)/3 = 83 → 83-61 = 22 ≥ 12，且 61 < 75 → 触发
    expect(buildComment(input(), first)).toContain("volume")
  })

  it("★ 不触发：最低分不算低（全句都很好）", () => {
    const c = buildComment(
      input({
        score: 90,
        accuracy: 90,
        fluency: 90,
        words: [
          { word: "You", score: 90 },
          { word: "volume", score: 82 },
          { word: "button", score: 92 },
        ],
      }),
      first,
    )
    expect(c).not.toContain("volume")
  })

  it("★ 不触发：低于 75 但差距不够（12 分是硬边界）", () => {
    // 均分 (70+74+74)/3 = 72.67 → 72.67-70 = 2.67 < 12 → 不触发
    const c = buildComment(
      input({
        words: [
          { word: "alpha", score: 70 },
          { word: "beta", score: 74 },
          { word: "gamma", score: 74 },
        ],
      }),
      first,
    )
    expect(c).not.toContain("alpha")
  })

  it("忽略 score 为 null 的词（不能当成 0 分去选它）", () => {
    const c = buildComment(
      input({
        words: [
          { word: "You", score: 92 },
          { word: "unknown", score: null },
          { word: "button", score: 96 },
        ],
      }),
      first,
    )
    expect(c).not.toContain("unknown")
  })
})

describe("buildComment · 短板维度", () => {
  it("准确度 < 75 时出现", () => {
    expect(buildComment(input({ accuracy: 60, fluency: 90, integrity: 100 }), first)).toContain("准确度")
  })
  it("流利度 < 75 时出现", () => {
    expect(buildComment(input({ accuracy: 90, fluency: 60, integrity: 100 }), first)).toContain("流利度")
  })
  it("完整度 < 100 时出现（完整度的门槛是 100）", () => {
    expect(buildComment(input({ accuracy: 90, fluency: 90, integrity: 80 }), first)).toContain("完整")
  })
  it("三维度都不低时不出现任何维度建议", () => {
    const c = buildComment(input({ accuracy: 90, fluency: 90, integrity: 100 }), first)
    expect(c).not.toContain("准确度")
    expect(c).not.toContain("流利度")
    expect(c).not.toContain("完整")
  })
})

describe("buildComment · 边界与健壮性", () => {
  it("words 为空时不出现逐词段，也不提示「没有逐词数据」", () => {
    const c = buildComment(input({ words: [] }), first)
    expect(c).not.toContain("逐词")
    expect(c.length).toBeGreaterThan(0)
  })

  it("★ 不与上一句完全相同", () => {
    const prev = buildComment(input(), first)
    const next = buildComment(input({ previousComment: prev }), first)
    expect(next).not.toBe(prev)
  })

  it("上一句为空时正常生成", () => {
    expect(buildComment(input({ previousComment: null }), first).length).toBeGreaterThan(0)
  })

  it("rand 取到最后一条时也是池内文案（不越界）", () => {
    const c = buildComment(input(), last)
    expect(c.length).toBeGreaterThan(0)
    expect(c).not.toContain("undefined")
  })
})

describe("buildComment · 文案池", () => {
  it("★ 每档至少 6 条且互不相同（防复制粘贴漏改）", async () => {
    const mod = await import("@/lib/pronunciation-comment")
    const pool = mod.__COMMENT_POOL_FOR_TEST__
    for (const [band, list] of Object.entries(pool.overall)) {
      expect(list.length, `${band} 档条数不足`).toBeGreaterThanOrEqual(6)
      expect(new Set(list).size, `${band} 档有重复文案`).toBe(list.length)
    }
  })

  it("★ 池内所有文案互不相同，也不含 undefined 占位", () => {
    const mod = (globalThis as unknown as { __pool?: unknown }).__pool
    void mod
  })
})
```

> 最后一条用例里 `__COMMENT_POOL_FOR_TEST__` 是刻意导出的：池子是这个功能里唯一"靠人工维护"的东西，重复或漏改只能靠断言发现。`(globalThis as ...)` 那两行是无效断言，**实施时删掉第二条用例**（保留第一条即可）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/pronunciation-comment.test.ts`
Expected: FAIL —— `Failed to resolve import "@/lib/pronunciation-comment"`

- [ ] **Step 3: 实现**

新建 `src/lib/pronunciation-comment.ts`：

```ts
/**
 * 跟读评语的生成。
 *
 * ── 为什么是规则而不是调 AI ──────────────────────────────────────────────────
 *
 * 规则能给出的信息已经覆盖了 AI 的价值：总分档位、最低分词、短板维度
 * （见 docs/superpowers/specs/2026-09-30-pronunciation-scoring-redesign-design.md §3.4）。
 * AI 真正的增量在**音标级诊断**（"volume 的 /v/ 发成了 /w/"），那需要音素级
 * 数据，是另一个功能。
 *
 * ⚠️ **措辞的边界**：没有音素级数据，所以只能说"读得最不清楚"，
 * 绝不能说"某个音发成了另一个音" —— 那是编造。
 *
 * ── 为什么注入 rand ─────────────────────────────────────────────────────────
 *
 * 纯随机会让单测变成"跑十次看有没有出现"这种脆弱写法。注入 rand 之后，
 * 测试可以固定取第一条或最后一条，断言是确定的。
 */

export interface CommentWord {
  word: string
  score: number | null
}

export interface CommentInput {
  score: number
  accuracy: number
  fluency: number
  integrity: number
  words: CommentWord[]
  /** 上一次的评语（同一句的上一条记录）。用于避免连着两次说同一句话。 */
  previousComment?: string | null
}

/** 最低分词要低于这个值才点出来。 */
const LOW_WORD_THRESHOLD = 75
/** 最低分词要比句均分低这么多才点出来，避免"全句都很好却单挑一个词"。 */
const LOW_WORD_GAP = 12
/** 维度低于这个值才算短板。 */
const WEAK_DIMENSION_THRESHOLD = 75
/** 低于这个总分基本是录音问题，不是发音问题。 */
const RECORDING_PROBLEM_SCORE = 30

const OVERALL: Record<"top" | "great" | "good" | "pass" | "weak", readonly string[]> = {
  top: [
    "几乎无可挑剔，这句读得跟示范音一样。",
    "非常出色！发音和节奏都很到位。",
    "满分水准，这个句子你已经拿下了。",
    "近乎完美，听不出明显问题。",
    "这一遍非常干净，保持住。",
    "发音准确、节奏自然，很好。",
  ],
  great: [
    "很棒！整体清晰流畅。",
    "读得不错，个别词还能再打磨一下。",
    "整体很稳，发音清楚。",
    "完成得很好，只有小地方可以更讲究。",
    "流畅自然，继续保持。",
    "很不错，细节上再抠一抠就更好。",
  ],
  good: [
    "不错，意思都读出来了，但还能更清楚些。",
    "基本到位，注意几处容易含糊的地方。",
    "整体可以，节奏或个别音还可以更好。",
    "读对了，但还不够利落。",
    "听懂没问题，打磨一下会更好。",
    "已经上路了，把下面几点改掉会有明显进步。",
  ],
  pass: [
    "还差一口气，先慢下来把每个词读准。",
    "能听出你在读什么，但有几处明显偏了。",
    "别急，先求准再求快。",
    "有些词含糊过去了，逐个抠一下。",
    "还可以，但需要再练两遍。",
    "方向对了，准确度还得提上来。",
  ],
  weak: [
    "这句有点吃力，建议先听两遍示范音再录。",
    "不用急，先把句子读慢一点、读完整。",
    "有几处差得比较多，跟着示范音逐句跟读会更快。",
    "先别追求速度，把音读准是第一位的。",
    "这句还没过关，再听一遍示范音试试。",
    "慢慢来，一个词一个词过。",
  ],
}

const LOW_WORD: readonly string[] = [
  "${word} 这个词可以重点练一下。",
  "其中 ${word} 读得最不清楚。",
  "${word} 的发音再注意一下。",
  "卡在 ${word} 上了，单独读几遍。",
  "${word} 是这句里最弱的一环。",
  "下次重点盯一下 ${word}。",
]

const WEAK: Record<"accuracy" | "fluency" | "integrity", readonly string[]> = {
  accuracy: [
    "准确度偏低，注意每个词的音要发全。",
    "有些音发得不够到位，慢一点会更好。",
    "先把音读准，再考虑速度。",
    "个别词的口型没打开，音就飘了。",
    "准确度是这次的主要短板。",
  ],
  fluency: [
    "流利度偏低，试着连贯一些、少停顿。",
    "中间停顿有点多，可以顺着读下去。",
    "读得有点断，试着把词连起来。",
    "节奏可以再顺一点，不用一个词一个词地蹦。",
  ],
  integrity: [
    "有词没读全，注意别漏读。",
    "句子没读完整，最后几个词也要读出来。",
    "有吞音或漏读，把每个词都交代清楚。",
    "完整度不够，读的时候别跳词。",
  ],
}

const RECORDING_PROBLEM = "可能是没录到声音，或者离麦克风太远 —— 确认一下再试。"
const PERFECT = "满分，示范级表现。"

/** 按位置取一条，输入固定时输出固定。 */
function pick(list: readonly string[], rand: () => number): string {
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)))
  return list[i]
}

/**
 * 选一条**与上一句不同**的。
 *
 * 先按 rand 取，若与上一句相同就顺次往后挪一位 —— 池子至少 2 条时必定能挪开。
 * 这比"重新随机直到不同"更可控（不会有理论上不终止的循环）。
 */
function pickAvoiding(
  list: readonly string[],
  rand: () => number,
  avoid: string | null | undefined,
): string {
  if (list.length === 0) return ""
  const start = Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)))
  for (let k = 0; k < list.length; k++) {
    const candidate = list[(start + k) % list.length]
    if (candidate !== avoid) return candidate
  }
  return list[start]
}

function bandOf(score: number): keyof typeof OVERALL {
  if (score >= 95) return "top"
  if (score >= 85) return "great"
  if (score >= 70) return "good"
  if (score >= 55) return "pass"
  return "weak"
}

/** 找出最低分的词；忽略 score 为 null 的词（"没给分"不等于"读得差"）。 */
function lowestWord(words: CommentWord[]): { word: string; score: number } | null {
  let best: { word: string; score: number } | null = null
  for (const w of words) {
    if (w.score === null || w.word === "") continue
    if (best === null || w.score < best.score) best = { word: w.word, score: w.score }
  }
  return best
}

function scoredValues(words: CommentWord[]): number[] {
  return words.filter((w) => w.score !== null && w.word !== "").map((w) => w.score as number)
}

export function buildComment(input: CommentInput, rand: () => number = Math.random): string {
  const { score, accuracy, fluency, integrity, words, previousComment } = input

  // ── 覆盖规则：命中时直接返回，不再拼其它段 ──────────────────────────────────
  if (score < RECORDING_PROBLEM_SCORE) return RECORDING_PROBLEM
  if (score === 100) return PERFECT

  const parts: string[] = [pickAvoiding(OVERALL[bandOf(score)], rand, previousComment)]

  // ── 最低分词：要真的拖了后腿才点出来 ────────────────────────────────────────
  const low = lowestWord(words)
  const values = scoredValues(words)
  if (low && values.length > 0) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    if (low.score < LOW_WORD_THRESHOLD && avg - low.score >= LOW_WORD_GAP) {
      parts.push(pick(LOW_WORD, rand).replace("${word}", low.word))
    }
  }

  // ── 短板维度：准确度/流利度门槛 75，完整度门槛 100 ──────────────────────────
  if (accuracy < WEAK_DIMENSION_THRESHOLD) parts.push(pick(WEAK.accuracy, rand))
  if (fluency < WEAK_DIMENSION_THRESHOLD) parts.push(pick(WEAK.fluency, rand))
  if (integrity < 100) parts.push(pick(WEAK.integrity, rand))

  return parts.join("")
}

/** 只给单测用：池子是这个功能里唯一靠人工维护的东西，重复与漏改只能靠断言发现。 */
export const __COMMENT_POOL_FOR_TEST__ = { overall: OVERALL, lowWord: LOW_WORD, weak: WEAK }
```

- [ ] **Step 4: 删掉测试里那条无效用例**

把 Step 1 里 `it("★ 池内所有文案互不相同，也不含 undefined 占位", ...)` 整个 `it(...)` 块删掉 —— 它没有实际断言（是写计划时的残留）。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/__tests__/pronunciation-comment.test.ts`
Expected: PASS（约 18 条）

- [ ] **Step 6: 提交**

```bash
git add src/lib/pronunciation-comment.ts src/__tests__/pronunciation-comment.test.ts
git commit -m "feat(pronunciation): 评语生成（规则拼 + 不与上一句重复）"
```

---

### Task 3: 落库 store + 接入评分路由

**Files:**
- Create: `src/lib/pronunciation-store.ts`
- Modify: `src/app/api/youdao/evaluate/route.ts`

- [ ] **Step 1: 实现 store**

新建 `src/lib/pronunciation-store.ts`：

```ts
import { db } from "@/lib/db"
import { pronunciationScores } from "@/lib/db/schema"
import type { EvaluateResult } from "@/lib/pronunciation"

/**
 * 跟读评分的持久化。**这是唯一碰 pronunciation_scores 的模块** ——
 * 读写都经这里，避免查询逻辑散落在路由与组件里。
 */

export interface StoredPronunciation {
  score: number
  accuracy: number
  fluency: number
  integrity: number
  speed: number | null
  words: { word: string; score: number | null }[]
  comment: string | null
  updatedAt: Date
}

/**
 * 写入（覆盖式）。
 *
 * 一句话一行：`UNIQUE(user_id, sentence_id)` + `onDuplicateKeyUpdate`，
 * 重录即覆盖。产品决定只留最新一次，所以这里是 upsert 而不是 insert。
 *
 * **返回 boolean 而不是抛错**：调用方是评分接口，写库失败**不该让用户看不到分数**。
 * 分数已经算出来了，存不上是我们的问题，要记日志但不该毁掉这次响应。
 */
export async function savePronunciationScore(params: {
  userId: string
  sentenceId: string
  result: EvaluateResult
  comment: string
  now: Date
}): Promise<boolean> {
  if (!db) return false
  const { userId, sentenceId, result, comment, now } = params
  try {
    await db
      .insert(pronunciationScores)
      .values({
        userId,
        sentenceId,
        score: result.score,
        accuracy: result.accuracy,
        fluency: result.fluency,
        integrity: result.integrity,
        speed: result.speed === null ? null : String(result.speed),
        words: result.words,
        comment,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          score: result.score,
          accuracy: result.accuracy,
          fluency: result.fluency,
          integrity: result.integrity,
          speed: result.speed === null ? null : String(result.speed),
          words: result.words,
          comment,
          updatedAt: now,
        },
      })
    return true
  } catch (e) {
    console.error("[pronunciation-store] 写入失败:", e)
    return false
  }
}

/** 读上一次的评语 —— 生成新评语时用来避免连着两次说同一句话。 */
export async function getPreviousComment(
  userId: string,
  sentenceId: string,
): Promise<string | null> {
  if (!db) return null
  try {
    const [row] = await db
      .select({ comment: pronunciationScores.comment })
      .from(pronunciationScores)
      .where(
        and(eq(pronunciationScores.userId, userId), eq(pronunciationScores.sentenceId, sentenceId)),
      )
      .limit(1)
    return row?.comment ?? null
  } catch (e) {
    console.error("[pronunciation-store] 读取上一次评语失败:", e)
    return null
  }
}
```

在文件顶部补上 `import { and, eq } from "drizzle-orm"`。

- [ ] **Step 2: 接入评分路由**

在 `src/app/api/youdao/evaluate/route.ts` 里，把结尾的：

```ts
  const result = mapYoudaoEvaluate(youdaoData)
  if (!result) {
    // errorCode 为 "0" 却映射不出结果 —— 响应结构变了。必须留痕，
    // 否则又会退化成"用户看到 0 分、我们不知道发生了什么"。
    console.error("[youdao/evaluate] 成功响应无法映射:", JSON.stringify(youdaoData).slice(0, 500))
    return NextResponse.json({ error: "评分结果解析失败" }, { status: 502 })
  }

  return NextResponse.json(result)
}
```

改成：

```ts
  const result = mapYoudaoEvaluate(youdaoData)
  if (!result) {
    // errorCode 为 "0" 却映射不出结果 —— 响应结构变了。必须留痕，
    // 否则又会退化成"用户看到 0 分、我们不知道发生了什么"。
    console.error("[youdao/evaluate] 成功响应无法映射:", JSON.stringify(youdaoData).slice(0, 500))
    return NextResponse.json({ error: "评分结果解析失败" }, { status: 502 })
  }

  // ── 落库（覆盖式）────────────────────────────────────────────────────────
  //
  // 写在这里而不是让客户端再发一次请求：额度校验已经在这个路由里，评分结果
  // 也已经在这里组装好，多一次往返没有任何收益。
  //
  // ⚠️ 写库失败**不影响返回**：分数已经算出来了（而且配额已经扣了），
  // 因为存不上就不给用户看，是拿我们的故障惩罚用户。失败记日志。
  // ⚠️ 只在客户端给了 sentenceId 时才写：没有句子就没有归属。
  //    `text` 是本路由发给有道的**英文字符串**（body 类型是 `{ audio?: string; text?: string }`），
  //    它不含句子 id —— 所以 sentenceId 必须由前端单独传上来（Task 6 已改）。
  //    老客户端不传时静默跳过落库，不影响评分返回。
  if (sentenceId) {
    const previousComment = await getPreviousComment(session.userId, sentenceId)
    const comment = buildComment({
      score: result.score,
      accuracy: result.accuracy,
      fluency: result.fluency,
      integrity: result.integrity,
      words: result.words,
      previousComment,
    })
    const saved = await savePronunciationScore({
      userId: session.userId,
      sentenceId,
      result,
      comment,
      now: new Date(),
    })
    // 落库失败时仍然把评语回给用户（这一次的体验不该变差），只是下次进来会没有历史分
    return NextResponse.json({ ...result, comment, saved })
  }

  return NextResponse.json(result)
}
```

- [ ] **Step 3: 让路由接收 sentenceId**

`route.ts` 里的 body 类型与解构（**已核实**：当前是 `{ audio?: string; text?: string }`）：

```ts
  let body: { audio?: string; text?: string; sentenceId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const { audio, text, sentenceId } = body
```

`text` 的长度校验保持原样（它仍然是发给有道的英文字符串）。
`audio` / `text` 的存在性校验也不动 —— **不把 `sentenceId` 加成必填**，
否则老客户端会被判 400。

- [ ] **Step 3: 补 import**

在 `route.ts` 顶部追加：

```ts
import { buildComment } from "@/lib/pronunciation-comment"
import { getPreviousComment, savePronunciationScore } from "@/lib/pronunciation-store"
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 5: 提交**

```bash
git add src/lib/pronunciation-store.ts src/app/api/youdao/evaluate/route.ts
git commit -m "feat(pronunciation): 评分成功后覆盖式落库，并把评语一并返回"
```

---

### Task 4: sentences 路由下发跟读分

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/app/api/courses/sentences/route.ts`

- [ ] **Step 1: 加类型**

在 `src/types/index.ts` 的 `Sentence` 接口里追加：

```ts
  /**
   * 跟读评分（有道语音评测）。**没有跟读过的句子这个字段不存在** ——
   * 不是 null、不是 0。界面据此决定「显示一个小分数」还是「什么都不显示」。
   */
  pronunciation?: {
    score: number
    accuracy: number
    fluency: number
    integrity: number
    speed: number | null
    words: { word: string; score: number | null }[]
    comment: string | null
    /** ISO 字符串。界面上的「3 天前」用它。 */
    updatedAt: string
  }
```

- [ ] **Step 2: 改 sentences 路由**

把 `const forLesson = (where: SQL<unknown>) => database.select().from(sentences)...` 改成带 LEFT JOIN 的版本：

```ts
    // 跟读分随句子一起下发（LEFT JOIN，且**只 JOIN 当前用户自己的**记录）：
    //   · LEFT 而不是 INNER —— 绝大多数句子没有跟读分，INNER 会把它们滤掉
    //   · JOIN 条件必须带 userId，否则会取到别人的分
    // 省掉「每句再请求一次」的 N 次往返。
    const forLesson = (where: SQL<unknown>) =>
      database
        .select({
          ...getTableColumns(sentences),
          pronunciationScore: pronunciationScores.score,
          pronunciationAccuracy: pronunciationScores.accuracy,
          pronunciationFluency: pronunciationScores.fluency,
          pronunciationIntegrity: pronunciationScores.integrity,
          pronunciationSpeed: pronunciationScores.speed,
          pronunciationWords: pronunciationScores.words,
          pronunciationComment: pronunciationScores.comment,
          pronunciationUpdatedAt: pronunciationScores.updatedAt,
        })
        .from(sentences)
        .leftJoin(
          pronunciationScores,
          and(
            eq(pronunciationScores.sentenceId, sentences.id),
            eq(pronunciationScores.userId, session.userId),
          ),
        )
        .where(and(eq(sentences.lessonId, lessonId), aliveSentence, where))
        .orderBy(asc(sentences.sortOrder))
```

- [ ] **Step 3: 组装时把「没有分」的字段去掉**

把 `const normalized = visible.map(...)` 改成：

```ts
    const normalized = visible.map((s) => {
      const {
        pronunciationScore,
        pronunciationAccuracy,
        pronunciationFluency,
        pronunciationIntegrity,
        pronunciationSpeed,
        pronunciationWords,
        pronunciationComment,
        pronunciationUpdatedAt,
        ...rest
      } = s
      return {
        ...rest,
        words: alignWordsWithEnglish(s.english, s.words),
        // ⚠️ 没有跟读分时**字段完全不出现**（而不是 null / 0）。
        // 界面只要写 `if (s.pronunciation)` 就行，不会有人误把 0 当成"读了得 0 分"。
        ...(pronunciationScore != null
          ? {
              pronunciation: {
                score: pronunciationScore,
                accuracy: pronunciationAccuracy ?? 0,
                fluency: pronunciationFluency ?? 0,
                integrity: pronunciationIntegrity ?? 0,
                speed: pronunciationSpeed === null ? null : Number(pronunciationSpeed),
                words: (pronunciationWords as { word: string; score: number | null }[] | null) ?? [],
                comment: pronunciationComment ?? null,
                updatedAt: (pronunciationUpdatedAt as Date).toISOString(),
              },
            }
          : {}),
      }
    })
```

- [ ] **Step 4: 补 import**

在 `route.ts` 顶部补：

```ts
import { getTableColumns } from "drizzle-orm"
import { pronunciationScores } from "@/lib/db/schema"
```

（`and` / `eq` 若已导入则不重复。）

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 6: 提交**

```bash
git add src/types/index.ts src/app/api/courses/sentences/route.ts
git commit -m "feat(pronunciation): 句子上随带跟读分（LEFT JOIN，无分则字段不出现）"
```

---

### Task 5: 评分弹窗（布局 C）

**Files:**
- Create: `src/components/home/learn/PronunciationModal.tsx`

- [ ] **Step 1: 实现弹窗**

新建 `src/components/home/learn/PronunciationModal.tsx`：

```tsx
"use client"

import { X, Volume2 } from "lucide-react"
import type { EvaluateResult } from "@/lib/pronunciation"
import { cn } from "@/lib/utils"

/**
 * 跟读评分弹窗（布局 C：句子为骨架、分数挂在词下面）。
 *
 * 设计见 docs/superpowers/specs/2026-09-30-pronunciation-scoring-redesign-design.md §3.1。
 * 这个组件是**纯展示**：录音、评分、听发音都由调用方负责，它只接收数据与回调。
 * 这样它不需要处理 MediaRecorder 的生命周期，也就能被单独推理。
 */

interface PronunciationModalProps {
  /** 逐词分。**用有道返回的 words[]**，不用句子字段切词 —— 那边标点是独立 token。 */
  words: { word: string; score: number | null }[]
  result: {
    score: number
    accuracy: number
    fluency: number
    integrity: number
    speed: number | null
    comment?: string | null
  }
  /** 本次会话内上一次的分数，用于显示「61 → 84」。没有就不显示。 */
  previousScore?: number | null
  speaking: boolean
  evaluating: boolean
  onSpeak: () => void
  onRetry: () => void
  onClose: () => void
}

/** 分数→颜色。null 用中性灰：**绝不显示成"0 分红"**（字段缺失不是读错了）。 */
function scoreColor(score: number | null): string {
  if (score === null) return "#94a3b8"
  if (score >= 80) return "#22c55e"
  if (score >= 60) return "#f59e0b"
  return "#ef4444"
}

function Bar({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? scoreColor(value) }}
        />
      </div>
      <b className="w-8 shrink-0 text-right text-xs tabular-nums">{value}</b>
    </div>
  )
}

export function PronunciationModal({
  words,
  result,
  previousScore,
  speaking,
  evaluating,
  onSpeak,
  onRetry,
  onClose,
}: PronunciationModalProps) {
  const { score, accuracy, fluency, integrity, speed, comment } = result

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* 标题栏：「听发音」常驻在右侧（设计 §5 的约定） */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">跟读评分</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onSpeak}
              disabled={evaluating}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                speaking
                  ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
                  : "border-accent/50 text-accent hover:bg-accent/10",
                evaluating && "opacity-40 cursor-not-allowed",
              )}
            >
              <Volume2 className="h-3.5 w-3.5" />
              {speaking ? "停止" : "听发音"}
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 逐词分：词在上、分在下 */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-5">
          {words.length === 0 ? (
            <p className="text-xs text-muted-foreground">这次没有拿到逐词分析</p>
          ) : (
            words.map((w, i) => (
              <span
                key={`${w.word}-${i}`}
                className="text-center"
                style={
                  w.score !== null && w.score < 60
                    ? { background: "rgba(239,68,68,.12)", borderRadius: 6, padding: "0 4px" }
                    : undefined
                }
              >
                <span className="block text-base text-foreground">{w.word}</span>
                <span className="block text-sm font-bold tabular-nums" style={{ color: scoreColor(w.score) }}>
                  {w.score === null ? "—" : w.score}
                </span>
              </span>
            ))
          )}
        </div>

        {/* 多维进度条 */}
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Bar label="准确度" value={accuracy} />
          <Bar label="流利度" value={fluency} />
          <Bar label="完整度" value={integrity} />
          <div className="flex items-center gap-2.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">语速</span>
            <div className="h-2 flex-1 rounded-full bg-foreground/10" />
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {speed === null ? "—" : `${Math.round(speed)} 词/分`}
            </span>
          </div>
        </div>

        {/* 总分 + 评语（评语为 null 时整块不渲染，不留空行） */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-4">
          <b className="text-2xl tabular-nums" style={{ color: scoreColor(score) }}>
            {score}
          </b>
          <div className="min-w-0 text-xs leading-relaxed text-foreground">
            {previousScore != null && previousScore !== score && (
              <span className="mr-2 text-muted-foreground tabular-nums">
                {previousScore} → {score}
              </span>
            )}
            {comment}
          </div>
        </div>

        <div className="flex gap-3 border-t border-border px-4 py-3">
          <button
            onClick={onRetry}
            disabled={evaluating}
            className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            再试一次
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: lint**

Run: `npx eslint src/components/home/learn/PronunciationModal.tsx`
Expected: 无 error

- [ ] **Step 4: 提交**

```bash
git add src/components/home/learn/PronunciationModal.tsx
git commit -m "feat(pronunciation): 评分弹窗（句子为骨架、分数挂在词下、多维进度条）"
```

---

### Task 6: 关闭后的卡片 + 接入 VoicePanel

**Files:**
- Create: `src/components/home/learn/PronunciationCard.tsx`
- Modify: `src/components/home/learn/VoicePanel.tsx`
- Modify: `src/components/home/learn/LearnClient.tsx:1977`

- [ ] **Step 1: 实现卡片**

新建 `src/components/home/learn/PronunciationCard.tsx`：

```tsx
"use client"

import { cn } from "@/lib/utils"

/**
 * 关闭弹窗后留在练习页上的评分卡片。
 *
 * 有历史分时也用它（附「3 天前」），见设计 §3.6。
 */
interface PronunciationCardProps {
  score: number
  accuracy: number
  fluency: number
  integrity: number
  /** 已经有值时会显示「3 天前」这种相对时间。 */
  updatedAt?: Date | null
  onClick: () => void
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e"
  if (score >= 60) return "#f59e0b"
  return "#ef4444"
}

/** 相对时间。只给到"天"，更细的对用户没有意义。 */
function relativeDay(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0) return "刚刚"
  if (days === 1) return "昨天"
  return `${days} 天前`
}

export function PronunciationCard({
  score,
  accuracy,
  fluency,
  integrity,
  updatedAt,
  onClick,
}: PronunciationCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-accent/60 bg-accent/5 px-3.5 py-3 text-left transition-colors hover:bg-accent/10",
      )}
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] text-sm font-black tabular-nums"
        style={{ borderColor: scoreColor(score), color: scoreColor(score) }}
      >
        {score}
      </span>
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block text-sm font-semibold text-foreground">跟读评分 {score}</span>
        <span className="block text-xs text-muted-foreground">
          准确 {accuracy} · 流利 {fluency} · 完整 {integrity}
          {updatedAt ? ` · ${relativeDay(updatedAt)}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-accent">查看详情 ›</span>
    </button>
  )
}
```

- [ ] **Step 2: 改 VoicePanel 的 props 与状态**

把 `export function VoicePanel({ english }: { english: string })` 改成接收整句：

```tsx
export function VoicePanel({ sentence }: { sentence: Sentence }) {
  const english = sentence.english
  const sentenceId = sentence.id
```

并在 `result` state 旁边加：

```tsx
  /** 本次会话内上一次的分数（用于卡片与弹窗上的「61 → 84」）。重录前先存这里。 */
  const [previousScore, setPreviousScore] = useState<number | null>(null)
  /** 弹窗开关。有评分或正在录音/评分时为 true。 */
  const [modalOpen, setModalOpen] = useState(false)
```

- [ ] **Step 3: 记录上一次分数 + 请求带上 sentenceId**

在 `recorder.onstop` 里，`setEvaluating(true)` **之前**加：

```tsx
      // 记下上一次的分数（如果这次会话里录过），用于弹窗上的变化显示
      setPreviousScore(shownResult?.score ?? null)
```

把 `fetch("/api/youdao/evaluate", ...)` 的 body 改成：

```tsx
          body: JSON.stringify({ audio, text: english, sentenceId }),
```

并在拿到结果后同时打开弹窗：

```tsx
        setResult({ forSentence: english, data: data as EvaluateResult })
        setModalOpen(true)
```

> `comment` 字段已在 **Task 1b** 里加进 `EvaluateResult`，所以这里可以
> 直接写成 `setResult({ forSentence: english, data: data as EvaluateResult })`，
> 不需要额外的 `as` 断言。

- [ ] **Step 4: 渲染卡片与弹窗**

把 `return` 里原来的内联结果块（`{shownResult && (...)}` 那一整段圆形分数 + 维度小字 + 词标签）**删除**，替换为：

```tsx
      {/* 有评分时显示卡片；点击重开弹窗 */}
      {shownResult && !modalOpen && (
        <PronunciationCard
          score={shownResult.score}
          accuracy={shownResult.accuracy}
          fluency={shownResult.fluency}
          integrity={shownResult.integrity}
          updatedAt={historyUpdatedAt}
          onClick={() => setModalOpen(true)}
        />
      )}

      {modalOpen && shownResult && (
        <PronunciationModal
          words={shownResult.words}
          result={shownResult}
          previousScore={previousScore}
          speaking={speaking}
          evaluating={evaluating}
          onSpeak={handleTTS}
          onRetry={handleRecord}
          onClose={() => setModalOpen(false)}
        />
      )}
```

其中 `historyUpdatedAt` 在组件顶部算：

```tsx
  /** 历史分的记录时间（本次会话录的没有"3 天前"，传 null）。 */
  const historyUpdatedAt =
    !shownResult && sentence.pronunciation ? new Date(sentence.pronunciation.updatedAt) : null
```

- [ ] **Step 5: 没有本次评分但有历史分时，也显示卡片**

在卡片渲染之前加：

```tsx
      {/* 本次没录、但库里有历史分（设计 §3.6）：显示历史卡片，点开看详情 */}
      {!shownResult && !modalOpen && sentence.pronunciation && (
        <PronunciationCard
          score={sentence.pronunciation.score}
          accuracy={sentence.pronunciation.accuracy}
          fluency={sentence.pronunciation.fluency}
          integrity={sentence.pronunciation.integrity}
          updatedAt={new Date(sentence.pronunciation.updatedAt)}
          onClick={() => setModalOpen(true)}
        />
      )}
```

并在 `modalOpen && shownResult` 之后补一个「历史分详情」的弹窗分支：

```tsx
      {modalOpen && !shownResult && sentence.pronunciation && (
        <PronunciationModal
          words={sentence.pronunciation.words}
          result={sentence.pronunciation}
          previousScore={null}
          speaking={speaking}
          evaluating={evaluating}
          onSpeak={handleTTS}
          onRetry={handleRecord}
          onClose={() => setModalOpen(false)}
        />
      )}
```

- [ ] **Step 6: 改 LearnClient 的调用**

把 `src/components/home/learn/LearnClient.tsx` 第 1977 行附近：

```tsx
            <VoicePanel english={sentence.english} />
```

改成：

```tsx
            <VoicePanel sentence={sentence} />
```

- [ ] **Step 7: 类型检查 + lint**

Run: `npx tsc --noEmit && npx eslint src/components/home/learn/VoicePanel.tsx src/components/home/learn/PronunciationCard.tsx src/components/home/learn/LearnClient.tsx`
Expected: tsc 无输出；eslint 的错误数**不比改动前多**（用 `git show HEAD:<file> | npx eslint --stdin --stdin-filename <file>` 对比同文件）

- [ ] **Step 8: 提交**

```bash
git add src/components/home/learn/PronunciationCard.tsx src/components/home/learn/VoicePanel.tsx src/components/home/learn/LearnClient.tsx
git commit -m "feat(pronunciation): 关闭后留卡片、点击重开详情、支持再试一次与历史分"
```

---

### Task 7: 大纲列表显示小分数

**Files:**
- Modify: `src/components/home/learn/OutlineModal.tsx`

- [ ] **Step 1: 在列表项里加分数**

在 `OutlineModal.tsx` 里渲染 `已完成` 标签的那段（`{revealed && i !== currentIndex && (...)}`）**之后**追加：

```tsx
                  {/* 跟读分：**有才显示**。没有就不显示任何占位 —— 不显示 0 分、
                      也不显示「—」（设计 §3.5）。已完成标记只由练习进度决定，
                      跟读有没有分都不影响它。 */}
                  {s.pronunciation && (
                    <span className="ml-2 text-[10px] font-medium text-accent/70 tabular-nums">
                      跟读 {s.pronunciation.score}
                    </span>
                  )}
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npx tsc --noEmit && npx eslint src/components/home/learn/OutlineModal.tsx`
Expected: tsc 无输出；eslint 无新增 error

- [ ] **Step 3: 提交**

```bash
git add src/components/home/learn/OutlineModal.tsx
git commit -m "feat(pronunciation): 大纲列表显示跟读分（有才显示，不影响已完成标记）"
```

---

### Task 8: e2e 夹具里清掉新表

**Files:**
- Modify: `tests/e2e/helpers/db.ts`（`TABLES` 数组）

- [ ] **Step 1: 把新表加进 TRUNCATE 清单**

`seedFixtures()` 靠 `TABLES` 数组清库。新表不加进去，用例之间会互相污染 ——
具体到本次：`没有跟读分时字段不出现` 这条用例会被上一个用例留下的分数搞失败，
而失败信息会指向接口，让人去查错地方。

在 `tests/e2e/helpers/db.ts` 的 `TABLES` 数组里，按字母序插到
`practice_records` **之前**（数组本身大致按字母序排列）：

```ts
  "pronunciation_scores",
  "practice_records",
```

- [ ] **Step 2: 跑一次现有 e2e 确认没弄坏夹具**

Run: `npx vitest run --config vitest.e2e.config.ts tests/e2e/00-smoke.test.ts`
Expected: PASS（5 条）

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/helpers/db.ts
git commit -m "test(pronunciation): 夹具 TRUNCATE 清单加上 pronunciation_scores"
```

---

### Task 9: e2e

**Files:**
- Create: `tests/e2e/106-pronunciation.test.ts`

- [ ] **Step 1: 写测试**

新建 `tests/e2e/106-pronunciation.test.ts`：

```ts
/**
 * 跟读评分的持久化与下发。
 *
 * ⚠️ e2e 环境屏蔽了 YOUDAO_APP_KEY，评分接口会返回 503（unconfigured），
 * 所以这里**不测真实评分调用**，只测「落库 → 下发」这条链路：
 * 直接往表里写，再看接口下发什么。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { seedFixtures, q, FIXTURE } from "./helpers/db"
import { insertUser } from "./helpers/factories"

// 用夹具里现成的课时与句子，不临时查库：
//   · 夹具是稳定的，查库的结果会随 seedFixtures 的改动而变
//   · NOT NULL 的 sentence_id 需要一个**真实存在**的句子（夹具里有）
const LESSON = FIXTURE.lessonA1
const SENTENCE = FIXTURE.sentA1Plain

beforeEach(async () => {
  await seedFixtures()
})

async function writeScore(userId: string, sentenceId: string, score: number, comment: string) {
  await q(
    `INSERT INTO pronunciation_scores
       (id, user_id, sentence_id, score, accuracy, fluency, integrity, speed, words, comment)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE score = VALUES(score), accuracy = VALUES(accuracy),
       fluency = VALUES(fluency), integrity = VALUES(integrity), speed = VALUES(speed),
       words = VALUES(words), comment = VALUES(comment)`,
    [
      userId,
      sentenceId,
      score,
      score - 2,
      score - 10,
      100,
      132.5,
      JSON.stringify([{ word: "You", score: 92 }, { word: "volume", score: 61 }]),
      comment,
    ],
  )
}

describe("跟读评分 · 持久化", () => {
  it("★ 同一句写两次只留一行，且内容是最新那次", async () => {
    const userId = await insertUser({ name: "跟读用户" })

    await writeScore(userId, SENTENCE, 61, "第一句评语")
    await writeScore(userId, SENTENCE, 84, "第二句评语")

    const rows = await q<{ n: number; score: number; comment: string }[]>(
      "SELECT COUNT(*) AS n, MAX(score) AS score, MAX(comment) AS comment FROM pronunciation_scores WHERE user_id = ? AND sentence_id = ?",
      [userId, SENTENCE],
    )
    expect(Number(rows[0].n)).toBe(1)
    expect(Number(rows[0].score)).toBe(84)
    expect(rows[0].comment).toBe("第二句评语")
  })

  it("唯一键是 (user_id, sentence_id)", async () => {
    const cols = await q<{ c: string }[]>(
      `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS c
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pronunciation_scores'
          AND INDEX_NAME = 'uk_pronunciation_user_sentence'`,
    )
    expect(cols[0].c).toBe("user_id,sentence_id")
  })

  it("表与 users 排序规则一致（否则 JOIN 会 Illegal mix of collations）", async () => {
    const rows = await q<{ t: string; c: string }[]>(
      `SELECT TABLE_NAME AS t, TABLE_COLLATION AS c FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('pronunciation_scores','users')`,
    )
    const byName = Object.fromEntries(rows.map((r) => [r.t, r.c]))
    expect(byName.pronunciation_scores).toBe(byName.users)
  })
})

describe("跟读评分 · 随句子下发", () => {
  it("★ 有跟读分时带上 pronunciation 字段", async () => {
    const userId = await insertUser({ name: "下发用户", isPro: 1 })
    await writeScore(userId, SENTENCE, 84, "很棒！整体清晰流畅。")

    const res = await ApiClient.asUser(userId).get<{
      sentences: {
        id: string
        pronunciation?: {
          score: number
          comment: string | null
          words: { word: string; score: number | null }[]
        }
      }[]
    }>(`/api/courses/sentences?lessonId=${LESSON}`)

    expect(res.status).toBe(200)
    const hit = res.body.sentences.find((x) => x.id === SENTENCE)
    expect(hit).toBeTruthy()
    expect(hit?.pronunciation?.score).toBe(84)
    expect(hit?.pronunciation?.comment).toBe("很棒！整体清晰流畅。")
    // 逐词分也要下发 —— 历史分点开「查看详情」要用它
    expect(hit?.pronunciation?.words?.length ?? 0).toBeGreaterThan(0)
  })

  it("★ 没有跟读分时字段**完全不出现**（不是 null、不是 0）", async () => {
    const userId = await insertUser({ name: "无分用户", isPro: 1 })

    const res = await ApiClient.asUser(userId).get<{
      sentences: Record<string, unknown>[]
    }>(`/api/courses/sentences?lessonId=${LESSON}`)

    const hit = res.body.sentences.find((x) => x.id === SENTENCE)
    expect(hit).toBeTruthy()
    expect("pronunciation" in (hit as object)).toBe(false)
  })

  it("★ 只下发当前用户自己的分，不串号", async () => {
    const owner = await insertUser({ name: "有分的人", isPro: 1 })
    const other = await insertUser({ name: "没分的人", isPro: 1 })
    await writeScore(owner, SENTENCE, 99, "别人的分")

    const res = await ApiClient.asUser(other).get<{
      sentences: Record<string, unknown>[]
    }>(`/api/courses/sentences?lessonId=${LESSON}`)

    const hit = res.body.sentences.find((x) => x.id === SENTENCE)
    expect("pronunciation" in (hit as object)).toBe(false)
  })
})

describe("跟读评分 · 与练习进度解耦", () => {
  it("★ 写入跟读分不产生任何 practice_records", async () => {
    const userId = await insertUser({ name: "解耦用户" })
    const before = await q<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM practice_records WHERE user_id = ?",
      [userId],
    )
    await writeScore(userId, SENTENCE, 90, "评语")
    const after = await q<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM practice_records WHERE user_id = ?",
      [userId],
    )
    expect(Number(after[0].n)).toBe(Number(before[0].n))
  })
})
```

> 已核实过的 helper：`ApiClient.asUser(userId)`（内部写 `typenow_session=dev:<id>` 旁路，
> 见 `tests/e2e/helpers/api.ts:26`）、`ApiClient.anonymous()`、`FIXTURE.sentA1Plain`
> 与 `FIXTURE.lessonA1`（`tests/e2e/helpers/db.ts:149`）、`insertUser`（factories）。
> **没有** `ApiClient.withCookie` 这个方法，不要用。

- [ ] **Step 2: 先跑一次确认真实失败原因**

Run: `npx vitest run --config vitest.e2e.config.ts tests/e2e/106-pronunciation.test.ts`
Expected: 若表已建好且代码已改完 → PASS；否则 FAIL 并给出具体缺什么
（e2e 的库由 `drizzle-kit push` 建表，**新表需要重新 push 或手工建**：
见 Step 3）

- [ ] **Step 3: 让 e2e 库也有这张表**

若 e2e 报「表不存在」，在 e2e 的库上执行一次与迁移等价的 DDL：

```bash
docker exec -i typenow-test-mysql mysql -uroot -ptypenow_test_pw typenow_test < db/migrations/00033_pronunciation_scores.sql
```

（`db/README.md` 已记录：e2e 库由 `drizzle-kit push` 维护，
但 push 表达不了 FULLTEXT 等结构；这张表没有特殊结构，
下次 `pnpm e2e:db:reset` 会由 schema.ts 自动建出来。）

- [ ] **Step 4: 跑 e2e**

Run: `npx vitest run --config vitest.e2e.config.ts tests/e2e/106-pronunciation.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/e2e/106-pronunciation.test.ts
git commit -m "test(pronunciation): 落库覆盖、按用户隔离、无分不下发字段、与进度解耦"
```

---

### Task 10: 全量验证 + 生产迁移 + 部署

- [ ] **Step 1: 全量单测**

Run: `pnpm test`
Expected: 全绿（若 `course-cover-*` 之类并行开发的用例失败，确认不是本次引入的后再继续）

- [ ] **Step 2: 全量 e2e**

Run: `npx vitest run --config vitest.e2e.config.ts`
Expected: 全绿。若出现"所有路由 404"，是 `.next-e2e` 缓存坏了：`rm -rf .next-e2e` 后重跑

- [ ] **Step 3: tsc 与 lint 增量**

Run: `npx tsc --noEmit`
Expected: 无输出

对每个改动过的 ts/tsx 文件对比 lint 增量：

```bash
git show HEAD:<file> | npx eslint --stdin --stdin-filename <file> | grep -c "error\|warning"
npx eslint <file> | grep -c "error\|warning"
```

Expected: 后者不大于前者

- [ ] **Step 4: 生产迁移**

```bash
# 先备份（按 db-backup/ 的惯例）
mkdir -p db-backup/pre-00033-$(date +%Y%m%d-%H%M%S)
# 执行迁移（连接参数从 .env.local 的 DATABASE_URL 取）
mysql ... < db/migrations/00033_pronunciation_scores.sql
```

Expected: 秒级完成（纯新建表，不碰既有表，无需 INSTANT 算法）

- [ ] **Step 5: 校验生产表结构**

```sql
SELECT TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='pronunciation_scores';
-- 期望 utf8mb4_unicode_ci

SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA='typenow' AND TABLE_NAME='pronunciation_scores'
   AND INDEX_NAME='uk_pronunciation_user_sentence';
-- 期望 user_id,sentence_id
```

- [ ] **Step 6: 提交并推送**

```bash
git add -A ':!scripts/gen-free-covers.ts'   # 只加本次的文件；并行开发的产物不要带进来
git status                                   # 人工确认一遍暂存内容
git commit -m "chore(pronunciation): 完成跟读评分改版"
git push origin main
```

- [ ] **Step 7: 观察部署**

Run:
```bash
ssh root@typenow.cn "su - admin -c 'tail -4 /home/admin/TypeNow/deploy.log'"
```
Expected: `=== 部署完成 ===`，且服务端 HEAD 是本次提交

- [ ] **Step 8: 线上验证**

- 打开一节课，录一次跟读，确认：弹窗出现、逐词有分、三条进度条、总分与评语
- 关掉弹窗 → 卡片留在页上 → 点击能重开
- 刷新页面 → 卡片还在（历史分）
- 打开大纲 → 该句显示「跟读 NN」
- 另一句没录过 → 大纲里**没有**任何跟读字样

---

## 实施前必须确认的三件事

1. **有道的 `words[]` 是否覆盖整句所有词**（设计 §6.3）。
   拿一句含标点的真实句子（如 `Seven , eight , don't be late !`）录一次，
   对比 `words[]` 的条数与内容。若漏词，逐词区按"有道给了分的词"渲染，
   **不补空位** —— 这条已经写在 `PronunciationModal` 的渲染里（直接 map `words`）。

2. ~~`/api/youdao/evaluate` 的 body 里有没有句子标识~~ —— **已核实**：
   body 是 `{ audio?: string; text?: string }`，`text` 是发给有道的英文字符串，
   **不含句子 id**。所以 Task 3 与 Task 6 都要求前端**多传一个 `sentenceId`**。
   不把它设成必填（老客户端不该被判 400），缺失时静默跳过落库。

3. ~~e2e helper 的实际名字~~ —— **已核实**：用 `ApiClient.asUser(userId)`；
   **没有** `withCookie`。夹具用 `FIXTURE.lessonA1` / `FIXTURE.sentA1Plain`。

4. **`tests/e2e/helpers/db.ts` 的 `TABLES` 数组要加 `pronunciation_scores`**
   （Task 8）。不加的话用例之间会互相污染，而失败信息会指向接口，
   让人去查错地方。

---

## 回滚

- 代码回滚即可：界面退回内联评分，`pronunciation_scores` 留着不读不写，无副作用
- 不需要回滚迁移（新表不影响任何既有查询）
