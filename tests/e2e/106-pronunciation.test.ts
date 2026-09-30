/**
 * 跟读评分的持久化与下发。
 *
 * ⚠️ e2e 环境屏蔽了 YOUDAO_APP_KEY，评分接口会返回 503（unconfigured），
 * 所以这里**不测真实评分调用**，只测「落库 → 下发」这条链路：
 * 直接往表里写，再看接口下发什么。
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest"
import { ApiClient } from "./helpers/api"
import { seedFixtures, q, FIXTURE } from "./helpers/db"
import { insertUser } from "./helpers/factories"
import { TEST_DB_URL, assertTestDatabase } from "./helpers/env"
import type { EvaluateResult } from "@/lib/pronunciation"

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
    // ⚠️ 这条守的是「本库里各表排序规则一致」，**不是**「与生产一致」。
    // 本库的表由 drizzle-kit push 生成，取的是容器服务器默认
    // （scripts/e2e/db-up.sh 的 --collation-server=utf8mb4_0900_ai_ci）；
    // 生产由迁移文件生成，显式写 utf8mb4_unicode_ci。两者的排序规则**永远不同**，
    // 详见 db/README.md「drizzle-kit push 不会应用表级 COLLATE」。
    // 判断生产排序规则只能查线上库，别拿这里的结果推断。
    //
    // 在本库它仍然抓得到真问题：手工执行迁移（而不是 push）会把这张表建成
    // utf8mb4_unicode_ci，与 users 不一致 → LEFT JOIN 直接 1267，整课 500。
    // 这次改版就是这么被抓出来的。
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

/**
 * ── 跟读评分 · 直连 store 的写路径 ───────────────────────────────────────────
 *
 * 上面三个 describe 都是「自己拼 SQL 往表里写 → 读接口下发什么」，它们**一次都没有
 * 执行过 savePronunciationScore / getPreviousComment**：e2e 屏蔽了 YOUDAO_APP_KEY，
 * /api/youdao/evaluate 在碰到 store 之前就返回 503（unconfigured）。于是 upsert 的
 * 更新列集合、!db 早退、失败只记日志不抛错的约定、读旧评语与写新评语的先后顺序、
 * 以及定宽列的收敛，全都没有自动化保护 —— 而这套代码出问题的失败形态恰好是最贵的
 * 那一种：用户每次都看到分数，行却永远没写进去（见 00033 迁移文件头）。
 *
 * ── 为什么要在本文件里自己注入 DATABASE_URL ─────────────────────────────────
 *
 * src/lib/db 在**模块初始化时**读 process.env.DATABASE_URL，而 e2e 的 vitest worker
 * 里它是 undefined —— 测试库地址只注入了被 spawn 的 dev 服务端（helpers/env.ts 的
 * buildE2eEnv 返回的是副本，不改本进程）。不注入的话 db 恒为 null，
 * savePronunciationScore 会直接走 !db 早退返回 false，测到的只是哨兵分支本身。
 * 所以这里必须在 import store 之前注入，且只能动态 import（静态 import 会被提升到
 * 注入语句之前）。
 *
 * 注入前先跑 assertTestDatabase()：它与 helpers/db 用的是同一道闸，万一将来有人把
 * .env.local 的生产地址带进 worker，这里会直接抛错，而不是往生产库写分数。
 * 注入只影响本 worker 进程（worker_threads 各自持有 process.env 副本），既改不到
 * 已经 spawn 好的服务端，也不会把别的 e2e 文件连到测试库上。
 *
 * ── 清库 ────────────────────────────────────────────────────────────────────
 *
 * 每个用例前的 seedFixtures() 会 TRUNCATE pronunciation_scores（见 helpers/db.ts
 * 的 TABLES 清单与 USER_ID_TABLES），所以本块不需要自己删行，也不依赖用例执行顺序。
 */
describe("跟读评分 · 直连 store 的写路径", () => {
  let store: typeof import("@/lib/pronunciation-store")

  beforeAll(async () => {
    assertTestDatabase()
    process.env.DATABASE_URL = TEST_DB_URL
    store = await import("@/lib/pronunciation-store")

    // 前置断言：注入失败时 db 为 null，store 走 !db 早退，表现成"每条用例都莫名
    // 写不进去"。这里先拦下来，并指出真正的原因。
    const { isDbConfigured } = await import("@/lib/db")
    if (!isDbConfigured()) {
      throw new Error("[106] 注入的 DATABASE_URL 没生效，@/lib/db 拿到的是 null")
    }
  })

  interface ScoreRow {
    id: string
    sentence_id: string
    score: number
    accuracy: number | null
    fluency: number | null
    integrity: number | null
    speed: string | null
    words: unknown
    comment: string | null
  }

  /** 造一份形状合法的评测结果；逐词分里刻意留一个 null（与维度同一套空值策略）。 */
  function evaluate(overrides: Partial<EvaluateResult> = {}): EvaluateResult {
    return {
      score: 84,
      accuracy: 90,
      fluency: 72,
      integrity: 100,
      speed: 132.5,
      words: [
        { word: "You", score: 92 },
        { word: "volume", score: 61 },
        { word: "the", score: null },
      ],
      ...overrides,
    }
  }

  function save(userId: string, sentenceId: string, result: EvaluateResult, comment: string) {
    return store.savePronunciationScore({ userId, sentenceId, result, comment, now: new Date() })
  }

  async function readRow(userId: string, sentenceId: string): Promise<ScoreRow | undefined> {
    const rows = await q<ScoreRow[]>(
      `SELECT id, sentence_id, score, accuracy, fluency, integrity, speed, words, comment
         FROM pronunciation_scores WHERE user_id = ? AND sentence_id = ?`,
      [userId, sentenceId],
    )
    return rows[0]
  }

  async function countRows(userId: string, sentenceId: string): Promise<number> {
    const rows = await q<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM pronunciation_scores WHERE user_id = ? AND sentence_id = ?",
      [userId, sentenceId],
    )
    return Number(rows[0].n)
  }

  /**
   * mysql2 读 JSON 列可能给已解析的对象、也可能给原始字符串（取决于协议/驱动版本）。
   * 两种都接住 —— 要断言的是"库里存的内容"，不是驱动的序列化细节。
   */
  function jsonOf(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value
  }

  it("往返：写进去的值原样读得回来（含 words JSON 与 comment）", async () => {
    const userId = await insertUser({ name: "store 往返用户" })
    const result = evaluate()

    expect(await save(userId, SENTENCE, result, "很棒！整体清晰流畅。")).toBe(true)

    const row = await readRow(userId, SENTENCE)
    expect(row).toBeTruthy()
    expect(row?.score).toBe(84)
    expect(row?.accuracy).toBe(90)
    expect(row?.fluency).toBe(72)
    expect(row?.integrity).toBe(100)
    // DECIMAL(6,2) 读回来是字符串，比较数值才算断言"存的是这个语速"
    expect(Number(row?.speed)).toBe(132.5)
    // 整份逐词分逐一比对：其中的 score: null 也必须原样留着，不能被写成 0
    expect(jsonOf(row?.words)).toEqual(result.words)
    expect(row?.comment).toBe("很棒！整体清晰流畅。")
  })

  it("getPreviousComment 反映刚落库的评语；没有行时返回 null", async () => {
    const userId = await insertUser({ name: "读旧评语用户" })

    // 第一次录这句 → 没有行 → null（路由靠它决定"有没有上一句评语"）
    expect(await store.getPreviousComment(userId, SENTENCE)).toBeNull()
    expect(await store.getPreviousComment(userId, FIXTURE.sentA2Plain)).toBeNull()

    await save(userId, SENTENCE, evaluate(), "第一句评语")
    expect(await store.getPreviousComment(userId, SENTENCE)).toBe("第一句评语")

    // 顺序敏感：路由是**先读旧评语、再 upsert 覆盖**。覆盖之后读到的必须是新的那句
    // （读旧值的调用必须发生在写入之前，否则"避免重复评语"这个前提就不成立）。
    await save(userId, SENTENCE, evaluate({ score: 90 }), "第二句评语")
    expect(await store.getPreviousComment(userId, SENTENCE)).toBe("第二句评语")
  })

  it("★ 覆盖写：同一句两次只留一行，且每一列都是第二次的值", async () => {
    const userId = await insertUser({ name: "覆盖写用户" })
    const first = evaluate({
      score: 61,
      accuracy: 50,
      fluency: 40,
      integrity: 30,
      speed: 80,
      words: [{ word: "First", score: 10 }],
    })
    const second = evaluate({
      score: 84,
      accuracy: 88,
      fluency: 90,
      integrity: 95,
      speed: 141.25,
      words: [{ word: "Second", score: 77 }, { word: "time", score: null }],
    })

    // 自检：两次调用的**每个**字段都不同。少了这层，"某一列没进 onDuplicateKeyUpdate
    // 的 set"就会退化成读到第一次的值 —— 而那看起来跟"正确"一模一样。
    const flat = (r: EvaluateResult) => [
      r.score,
      r.accuracy,
      r.fluency,
      r.integrity,
      r.speed,
      JSON.stringify(r.words),
    ]
    flat(second).forEach((v, i) => expect(v).not.toEqual(flat(first)[i]))

    expect(await save(userId, SENTENCE, first, "第一句评语")).toBe(true)
    expect(await save(userId, SENTENCE, second, "第二句评语")).toBe(true)

    expect(await countRows(userId, SENTENCE)).toBe(1)
    const row = await readRow(userId, SENTENCE)
    expect(row?.comment).toBe("第二句评语")
    expect(jsonOf(row?.words)).toEqual(second.words)
    expect(row?.score).toBe(84)
    expect(row?.accuracy).toBe(88)
    expect(row?.fluency).toBe(90)
    expect(row?.integrity).toBe(95)
    expect(Number(row?.speed)).toBe(141.25)
  })

  it("★ 维度为 null 时存 NULL，绝不落成 0", async () => {
    const userId = await insertUser({ name: "缺维度用户" })

    expect(
      await save(
        userId,
        SENTENCE,
        evaluate({ score: 80, accuracy: null, fluency: 70, integrity: null, speed: null }),
        "评语",
      ),
    ).toBe(true)

    // 必须直接问库"这一列是不是 SQL NULL"：落成 0 一样能让 `toBe(0)` 之类的写法变绿，
    // 而 0 恰恰是这套设计要禁止的东西 —— 它会显示成一个真实分数，还会命中
    // 「该维度 < 75 就出短板建议」的评语规则，给字段缺失的用户生成误导性评语。
    const rows = await q<
      {
        accNull: number
        fluNull: number
        intNull: number
        speedNull: number
        accuracy: number | null
        fluency: number | null
        integrity: number | null
      }[]
    >(
      `SELECT accuracy IS NULL AS accNull, fluency IS NULL AS fluNull,
              integrity IS NULL AS intNull, speed IS NULL AS speedNull,
              accuracy, fluency, integrity
         FROM pronunciation_scores WHERE user_id = ? AND sentence_id = ?`,
      [userId, SENTENCE],
    )
    const r = rows[0]
    expect(r.accNull).toBe(1)
    expect(r.intNull).toBe(1)
    expect(r.speedNull).toBe(1)
    expect(r.fluNull).toBe(0)
    expect(r.fluency).toBe(70)
    expect(r.accuracy).toBeNull()
    expect(r.integrity).toBeNull()
  })

  it("★ id 走库级默认值：INSERT 不带 id 也能落行，两行 id 互不相同", async () => {
    // 写入方刻意不传 id，指望的是 DEFAULT (UUID())。生产库的结构来自手写迁移而不是
    // schema.ts，这条默认值一旦漏在迁移里，生产表现为"每次评分都正常显示、但永远
    // 存不进去"，且 e2e 全绿 —— 所以这里得真的写两行、再把 id 读回来。
    const a = await insertUser({ name: "默认 id 甲" })
    const b = await insertUser({ name: "默认 id 乙" })

    expect(await save(a, SENTENCE, evaluate(), "甲")).toBe(true)
    expect(await save(b, SENTENCE, evaluate(), "乙")).toBe(true)

    const rows = await q<{ id: string }[]>(
      "SELECT id FROM pronunciation_scores WHERE user_id IN (?, ?)",
      [a, b],
    )
    expect(rows).toHaveLength(2)
    for (const { id } of rows) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
    expect(rows[0].id).not.toBe(rows[1].id)
  })

  it("★ 超长 sentence_id 拒写且不留行；正好 64 字符按原值写入", async () => {
    // sentence_id 是 UNIQUE(user_id, sentence_id) 的一部分，列宽 VARCHAR(64)。
    // 超长只能拒写：截断不是"少存几个字符"，而是把这行**改挂到另一个 key 上**，
    // 用户的分数会记到别的文字头上 —— 比丢行严格更坏。
    const userId = await insertUser({ name: "超长 id 用户" })

    for (const len of [65, 80]) {
      const tooLong = "x".repeat(len)
      expect(await save(userId, tooLong, evaluate(), "评语")).toBe(false)
    }

    const rows = await q<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM pronunciation_scores WHERE user_id = ?",
      [userId],
    )
    expect(Number(rows[0].n)).toBe(0)
    // 明确挡住"悄悄截断到 64 字符后照写"这条歧路
    const truncated = await q<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM pronunciation_scores WHERE sentence_id LIKE ?",
      [`${"x".repeat(64)}%`],
    )
    expect(Number(truncated[0].n)).toBe(0)

    // 边界另一侧：正好 64 字符（列宽上限）必须**原样**写入。
    // 这正是"宁可拒写也不截断"安全的前提 —— 合法 id 永远落在 64 以内。
    const exact = "y".repeat(64)
    expect(await save(userId, exact, evaluate({ score: 77 }), "边界评语")).toBe(true)

    const row = await readRow(userId, exact)
    expect(row?.sentence_id).toBe(exact)
    expect(row?.score).toBe(77)
  })

  it("★ 分块练习项 id（`<原句>_c0`，39 字符）能各自成行，不会互相覆盖", async () => {
    // 这是"按练习项计分"这条产品决定的核心：带 chunks 的句子被展开成多个分块，
    // 每个分块是独立朗读的一段文字，必须各占一行。若按原句 id 存，一句只有一个
    // 分数格 —— 录完分块 1 再录分块 2 会把 1 覆盖掉，先录的那段分永久丢失。
    const userId = await insertUser({ name: "分块句用户" })
    const parent = FIXTURE.sentA1Plain

    const c0 = `${parent}_c0`
    const c1 = `${parent}_c1`
    // 36 字符 UUID + `_c0` = 39，正是列宽写 36 就会翻车的长度
    expect(c0.length).toBeGreaterThan(36)
    expect(c0.length).toBeLessThanOrEqual(64)

    expect(await save(userId, c0, evaluate({ score: 90 }), "分块一评语")).toBe(true)
    expect(await save(userId, c1, evaluate({ score: 60 }), "分块二评语")).toBe(true)

    // 三行并存：两个分块各一行，且都是自己的分（互不覆盖）
    expect(await countRows(userId, c0)).toBe(1)
    expect(await countRows(userId, c1)).toBe(1)
    expect((await readRow(userId, c0))?.score).toBe(90)
    expect((await readRow(userId, c1))?.score).toBe(60)

    // 上一句评语也按练习项隔离：录分块 2 时不该看到分块 1 的评语
    expect(await store.getPreviousComment(userId, c0)).toBe("分块一评语")
    expect(await store.getPreviousComment(userId, c1)).toBe("分块二评语")

    // 父句 id 是**另一个**练习项（只有整句没被展开时才存在），不与分块互相干扰
    expect(await countRows(userId, parent)).toBe(0)
  })

  it("★ 不同用户各自的上一句评语互不串号", async () => {
    const a = await insertUser({ name: "评语用户甲" })
    const b = await insertUser({ name: "评语用户乙" })

    expect(await save(a, SENTENCE, evaluate(), "甲的评语")).toBe(true)
    expect(await save(b, SENTENCE, evaluate(), "乙的评语")).toBe(true)

    // 唯一键是 (user_id, sentence_id)：同一句在两个用户下必须是两行，
    // 否则后写的人会把前一个人的分数覆盖掉。
    const rows = await q<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM pronunciation_scores WHERE sentence_id = ?",
      [SENTENCE],
    )
    expect(Number(rows[0].n)).toBe(2)

    expect(await store.getPreviousComment(a, SENTENCE)).toBe("甲的评语")
    expect(await store.getPreviousComment(b, SENTENCE)).toBe("乙的评语")
  })
})
