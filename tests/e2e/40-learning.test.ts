/**
 * 链路三：学习主流程（课程广场 → 课时 → 句子 → 练习打点 → 进度）
 *
 * 这一段的重点是「内容可见性」与「数据口径」：
 *   - 未发布课程/课时/句子绝不能从任何公开接口泄露；
 *   - 练习分数只能由服务端按 mistakes 推导，客户端不能直接提交分数；
 *   - 学习进度是 upsert + 取大值，不能被重复调用刷小，也不能重复累加 learner_count。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser } from "./helpers/factories"

beforeEach(async () => {
  await seedFixtures()
})

describe("课程广场 /api/courses/list", () => {
  it("公开接口：未登录可访问，且只返回已发布课程", async () => {
    const res = await ApiClient.anonymous().get<{
      data: Array<{ id: string; title: string; isPublished: number }>
      total: number
    }>("/api/courses/list")

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.data.map((c) => c.id)).toEqual([FIXTURE.coursePublished])
    expect(res.body.data.every((c) => c.isPublished === 1)).toBe(true)
  })

  it("关键词搜索命中标题，未命中返回空", async () => {
    const hit = await ApiClient.anonymous().get<{ total: number }>(
      "/api/courses/list?search=已发布"
    )
    expect(hit.body.total).toBe(1)

    const miss = await ApiClient.anonymous().get<{ total: number; data: unknown[] }>(
      "/api/courses/list?search=不存在的课程名"
    )
    expect(miss.body.total).toBe(0)
    expect(miss.body.data).toEqual([])
  })

  it("search 里的 LIKE 通配符被当成普通字符（% 不应返回全部）", async () => {
    const res = await ApiClient.anonymous().get<{ total: number }>("/api/courses/list?search=%25")
    expect(res.body.total).toBe(0)
  })

  it("分页参数生效，pageSize 有上限（不能一次拖走整张表）", async () => {
    const res = await ApiClient.anonymous().get<{ data: unknown[] }>(
      "/api/courses/list?current=1&pageSize=100000"
    )
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeLessThanOrEqual(100)
  })

  it("非法的 page/pageSize 不会 500（NaN 不能进 SQL）", async () => {
    for (const qs of ["current=abc", "pageSize=abc", "current=-5", "pageSize=0"]) {
      const res = await ApiClient.anonymous().get<{ data: unknown[] }>(`/api/courses/list?${qs}`)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    }
  })

  it("categoryKey=all 与具体分类：不存在的分类返回空", async () => {
    const all = await ApiClient.anonymous().get<{ total: number }>(
      "/api/courses/list?categoryKey=all"
    )
    expect(all.body.total).toBe(1)

    const none = await ApiClient.anonymous().get<{ total: number }>(
      "/api/courses/list?categoryKey=__no_such_category__"
    )
    expect(none.body.total).toBe(0)
  })

  it("排序模式 name / most_used / latest 均可用", async () => {
    for (const sortMode of ["name", "most_used", "latest", "unknown_mode"]) {
      const res = await ApiClient.anonymous().get<{ total: number }>(
        `/api/courses/list?sortMode=${sortMode}`
      )
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
    }
  })
})

describe("课程详情 /api/courses/[id]", () => {
  it("已发布 → 200；未发布 → 404；不存在 → 404", async () => {
    const ok = await ApiClient.anonymous().get<{ data: { id: string } }>(
      `/api/courses/${FIXTURE.coursePublished}`
    )
    expect(ok.status).toBe(200)
    expect(ok.body.data.id).toBe(FIXTURE.coursePublished)

    expect(
      (await ApiClient.anonymous().get(`/api/courses/${FIXTURE.courseUnpublished}`)).status
    ).toBe(404)
    expect((await ApiClient.anonymous().get(`/api/courses/not-a-real-id`)).status).toBe(404)
  })
})

describe("课时列表 /api/courses/[id]/lessons", () => {
  it("已发布课程 → 返回全部课时并按 sort_order 升序", async () => {
    const res = await ApiClient.anonymous().get<{
      data: Array<{ id: string; sortOrder: number }>
    }>(`/api/courses/${FIXTURE.coursePublished}/lessons`)

    expect(res.status).toBe(200)
    expect(res.body.data.map((l) => l.id)).toEqual([
      FIXTURE.lessonA1,
      FIXTURE.lessonA2,
      FIXTURE.lessonEmpty,
    ])
    const orders = res.body.data.map((l) => l.sortOrder)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
  })

  it("未发布课程 → 404（不泄露课时）", async () => {
    expect(
      (await ApiClient.anonymous().get(`/api/courses/${FIXTURE.courseUnpublished}/lessons`)).status
    ).toBe(404)
  })
})

describe("句子列表 /api/courses/sentences", () => {
  it("未登录 → 401；缺 lessonId → 400", async () => {
    expect((await ApiClient.anonymous().get("/api/courses/sentences")).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userPro).get("/api/courses/sentences")).status).toBe(
      400
    )
  })

  it("未发布课程的课时 → 404；不存在的课时 → 404", async () => {
    for (const lessonId of [FIXTURE.lessonB1, "not-a-real-lesson"]) {
      const res = await ApiClient.asUser(FIXTURE.userPro).get(
        `/api/courses/sentences?lessonId=${lessonId}`
      )
      expect(res.status).toBe(404)
    }
  })

  it("非会员拿不到句子内容 → 403（课程 API 是唯一公开面，句子是付费内容）", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).get(
      `/api/courses/sentences?lessonId=${FIXTURE.lessonA1}`
    )
    expect(res.status).toBe(403)
    expect(res.body).not.toHaveProperty("sentences")
  })

  it("会员：句子按 sort_order 升序返回，并带上分词结果", async () => {
    const res = await ApiClient.asUser(FIXTURE.userPro).get<{
      sentences: Array<{
        id: string
        english: string
        sortOrder: number
        words: Array<{ english: string; pos: string }>
      }>
    }>(`/api/courses/sentences?lessonId=${FIXTURE.lessonA1}`)

    expect(res.status).toBe(200)
    expect(res.body.sentences.map((s) => s.id)).toEqual([
      FIXTURE.sentA1Plain,
      FIXTURE.sentA1Curly,
      FIXTURE.sentA1Dash,
    ])

    const curly = res.body.sentences.find((s) => s.id === FIXTURE.sentA1Curly)
    // don’t 必须是一个 token，不能裂成 don / t（否则用户要分两格输入）
    expect(curly?.words.map((w) => w.english)).toContain("don\u2019t")

    const plain = res.body.sentences.find((s) => s.id === FIXTURE.sentA1Plain)
    // 夹具的 words 是 `words()` 造的，它把标点全删了（replace(/[.,!?;:]/g, " ")），
    // 正是线上导入语料的真实形态。接口必须以 english 为骨架把句末句号补回来，
    // 否则练习页那行会少一个标点格（线上 335,291 条带 words 的句子里有 40% 对不上）。
    expect(plain?.words.map((w) => w.english)).toEqual([
      "I",
      "study",
      "English",
      "every",
      "day",
      ".",
    ])
    expect(plain?.words.at(-1)?.pos).toBe("标点")
  })

  it("words 为 null 的句子现场分词兜底（不返回空数组）", async () => {
    await q("UPDATE sentences SET words = NULL WHERE id = ?", [FIXTURE.sentA2Plain])
    const res = await ApiClient.asUser(FIXTURE.userPro).get<{
      sentences: Array<{ id: string; words: Array<{ english: string }> }>
    }>(`/api/courses/sentences?lessonId=${FIXTURE.lessonA2}`)

    const s = res.body.sentences.find((x) => x.id === FIXTURE.sentA2Plain)
    expect(s?.words.map((w) => w.english)).toEqual(["She", "is", "a", "teacher", "."])
  })

  it("题干不可用的句子不返回（中文=英文 / 中文里根本没有中文）", async () => {
    // 线上 1,674 条这种句子，正是「中译英模式下中文栏显示英文」的来源
    await q(
      `INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, words, words_count) VALUES
       ('55555555-5555-4555-8555-000000000001', 'mark', 'mark', ?, 1, NULL, 0),
       ('55555555-5555-4555-8555-000000000002', 'S3090', 'three o nine o', ?, 2, NULL, 0)`,
      [FIXTURE.lessonA2, FIXTURE.lessonA2]
    )
    const res = await ApiClient.asUser(FIXTURE.userPro).get<{
      sentences: Array<{ id: string; chinese: string }>
    }>(`/api/courses/sentences?lessonId=${FIXTURE.lessonA2}`)

    expect(res.status).toBe(200)
    expect(res.body.sentences.map((s) => s.id)).toEqual([FIXTURE.sentA2Plain])
  })

  it("整节课题干都不可用时兜底原样返回，绝不返回空课（字母课 / 学普通话 就是这种）", async () => {
    // 这两种课时是**正常内容**，只是不符合「中文题干」假设：
    //   a/a b/b … 字母本身就是题干；维语题干 + 中文 english 压根不是中译英。
    // 它们与用户抱怨的 I/I 在数据上无法区分，所以只能按整节课兜底。
    await q(
      `INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, words, words_count) VALUES
       ('55555555-5555-4555-8555-000000000011', 'a', 'a', ?, 0, NULL, 0),
       ('55555555-5555-4555-8555-000000000012', 'b', 'b', ?, 1, NULL, 0)`,
      [FIXTURE.lessonEmpty, FIXTURE.lessonEmpty]
    )
    const res = await ApiClient.asUser(FIXTURE.userPro).get<{
      sentences: Array<{ id: string; chinese: string; words: Array<{ english: string }> }>
    }>(`/api/courses/sentences?lessonId=${FIXTURE.lessonEmpty}`)

    expect(res.status).toBe(200)
    expect(res.body.sentences.map((s) => s.chinese)).toEqual(["a", "b"])
    // 题干不可用也要照常重建 words，否则练习页无格可敲
    expect(res.body.sentences[0].words.map((w) => w.english)).toEqual(["a"])
  })
})

describe("练习打点 /api/practice/record", () => {
  it("未登录 → 401；缺 sentenceId → 400", async () => {
    expect(
      (await ApiClient.anonymous().post("/api/practice/record", { sentenceId: "x" })).status
    ).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userPro).post("/api/practice/record", {})).status).toBe(
      400
    )
  })

  it("分数由 mistakes 服务端推导，客户端提交的 score 无效", async () => {
    const api = ApiClient.asUser(FIXTURE.userPro)
    const cases: Array<[number, number, string]> = [
      [0, 10, "perfect"],
      [1, 6, "good"],
      [2, 6, "good"],
      [3, 2, "keep_trying"],
      [99, 2, "keep_trying"],
    ]

    for (const [mistakes, score, grade] of cases) {
      const res = await api.post<{ score: number; grade: string }>("/api/practice/record", {
        sentenceId: FIXTURE.sentA1Plain,
        mistakes,
      })
      expect(res.status).toBe(200)
      expect(res.body.score).toBe(score)
      expect(res.body.grade).toBe(grade)
    }

    // 伪造 score 不会落库
    await api.post("/api/practice/record", {
      sentenceId: FIXTURE.sentA1Plain,
      mistakes: 5,
      score: 10,
    })
    const row = await one<{ score: number; mistakes: number }>(
      "SELECT score, mistakes FROM practice_records WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [FIXTURE.userPro]
    )
    expect(Number(row?.score)).toBe(2)
    expect(Number(row?.mistakes)).toBe(5)
  })

  it("异常的 mistakes（负数/小数/NaN/字符串）被归一化成非负整数", async () => {
    const api = ApiClient.asUser(FIXTURE.userPro)
    for (const mistakes of [-5, 1.9, Number.NaN, "abc", null]) {
      const res = await api.post("/api/practice/record", {
        sentenceId: FIXTURE.sentA1Plain,
        mistakes,
      })
      expect(res.status).toBe(200)
    }

    const rows = await q<Array<{ mistakes: number; score: number }>>(
      "SELECT mistakes, score FROM practice_records WHERE user_id = ?",
      [FIXTURE.userPro]
    )
    for (const r of rows) {
      expect(Number.isInteger(Number(r.mistakes))).toBe(true)
      expect(Number(r.mistakes)).toBeGreaterThanOrEqual(0)
      expect([10, 6, 2]).toContain(Number(r.score))
    }
    // -5 / NaN / "abc" / null 都应为 0 次错误 → 10 分；1.9 → 1 次 → 6 分
    expect(rows.filter((r) => Number(r.mistakes) === 0).length).toBe(4)
    expect(rows.filter((r) => Number(r.mistakes) === 1).length).toBe(1)
  })

  it("isReview 正确落库，userInput 可以为空", async () => {
    const api = ApiClient.asUser(FIXTURE.userPro)
    await api.post("/api/practice/record", {
      sentenceId: FIXTURE.sentA1Plain,
      mistakes: 0,
      isReview: true,
    })
    await api.post("/api/practice/record", { sentenceId: FIXTURE.sentA2Plain, mistakes: 0 })

    const rows = await q<Array<{ is_review: number; user_input: string | null }>>(
      "SELECT is_review, user_input FROM practice_records WHERE user_id = ?",
      [FIXTURE.userPro]
    )
    expect(rows.length).toBe(2)
    expect(rows.filter((r) => Number(r.is_review) === 1).length).toBe(1)
    expect(rows.every((r) => r.user_input === null)).toBe(true)
  })

  it("记录只能写到自己名下", async () => {
    await ApiClient.asUser(FIXTURE.userFree).post("/api/practice/record", {
      sentenceId: FIXTURE.sentA1Plain,
      mistakes: 0,
    })
    const row = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM practice_records WHERE user_id = ?",
      [FIXTURE.userPro]
    )
    expect(Number(row?.c)).toBe(0)
  })
})

describe("学习进度 /api/user/progress", () => {
  it("未登录 → 401；缺 courseId → 400", async () => {
    expect((await ApiClient.anonymous().get("/api/user/progress")).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userPro).post("/api/user/progress", {})).status
    ).toBe(400)
  })

  it("首次学习：写入进度并把课程的学习人数 +1", async () => {
    const res = await ApiClient.asUser(FIXTURE.userPro).post("/api/user/progress", {
      courseId: FIXTURE.coursePublished,
      sentenceCount: 3,
    })
    expect(res.status).toBe(200)

    const row = await one<{ sentence_count: number }>(
      "SELECT sentence_count FROM user_course_progress WHERE user_id = ? AND course_id = ?",
      [FIXTURE.userPro, FIXTURE.coursePublished]
    )
    expect(Number(row?.sentence_count)).toBe(3)

    const course = await one<{ learner_count: number }>(
      "SELECT learner_count FROM courses WHERE id = ?",
      [FIXTURE.coursePublished]
    )
    expect(Number(course?.learner_count)).toBe(1)
  })

  it("重复学习：learner_count 不重复累加，sentenceCount 只增不减", async () => {
    const api = ApiClient.asUser(FIXTURE.userPro)
    await api.post("/api/user/progress", { courseId: FIXTURE.coursePublished, sentenceCount: 5 })
    await api.post("/api/user/progress", { courseId: FIXTURE.coursePublished, sentenceCount: 2 })
    await api.post("/api/user/progress", { courseId: FIXTURE.coursePublished, sentenceCount: 9 })

    const course = await one<{ learner_count: number }>(
      "SELECT learner_count FROM courses WHERE id = ?",
      [FIXTURE.coursePublished]
    )
    expect(Number(course?.learner_count)).toBe(1)

    const row = await one<{ sentence_count: number }>(
      "SELECT sentence_count FROM user_course_progress WHERE user_id = ? AND course_id = ?",
      [FIXTURE.userPro, FIXTURE.coursePublished]
    )
    expect(Number(row?.sentence_count)).toBe(9)

    const count = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM user_course_progress WHERE user_id = ? AND course_id = ?",
      [FIXTURE.userPro, FIXTURE.coursePublished]
    )
    expect(Number(count?.c)).toBe(1)
  })

  it("GET 只返回自己的进度，并按最近学习时间倒序", async () => {
    await q(
      `INSERT INTO user_course_progress (id, user_id, course_id, last_studied_at, sentence_count)
       VALUES (UUID(), ?, ?, ?, 1), (UUID(), ?, ?, ?, 2)`,
      [
        FIXTURE.userPro,
        FIXTURE.coursePublished,
        new Date(Date.now() - 86400_000),
        FIXTURE.userPro,
        FIXTURE.courseUnpublished,
        new Date(),
      ]
    )
    // 别人的进度不能串进来
    await q(
      `INSERT INTO user_course_progress (id, user_id, course_id, last_studied_at, sentence_count)
       VALUES (UUID(), ?, ?, ?, 9)`,
      [FIXTURE.userFree, FIXTURE.coursePublished, new Date()]
    )

    const res = await ApiClient.asUser(FIXTURE.userPro).get<{
      data: Array<{ courseId: string }>
    }>("/api/user/progress")

    expect(res.status).toBe(200)
    expect(res.body.data.map((r) => r.courseId)).toEqual([
      FIXTURE.courseUnpublished,
      FIXTURE.coursePublished,
    ])
  })

  it("不同用户学习同一门课：learner_count 各自 +1", async () => {
    await ApiClient.asUser(FIXTURE.userPro).post("/api/user/progress", {
      courseId: FIXTURE.coursePublished,
    })
    const other = await insertUser({ isPro: 1 })
    await ApiClient.asUser(other).post("/api/user/progress", { courseId: FIXTURE.coursePublished })

    const course = await one<{ learner_count: number }>(
      "SELECT learner_count FROM courses WHERE id = ?",
      [FIXTURE.coursePublished]
    )
    expect(Number(course?.learner_count)).toBe(2)
  })
})
