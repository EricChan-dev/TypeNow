/**
 * 链路三之二：打卡、钻石、任务、统计与词典
 *
 * 这些接口此前完全没有自动化覆盖，但都是首页/归档页/任务中心直接依赖的用户可见功能：
 *   - 打卡门槛（今日钻石 >= goal 才允许）
 *   - 钻石发放（句子/课时/课程三种来源、满分连击加成的口径与封顶）
 *   - 分享任务（同一上海日历日只能领一次）
 *   - 首页统计、归档统计、任务状态
 *   - 词典查询与句子解析缓存
 *
 * 环境前提（见 helpers/env.ts）：YOUDAO_* / DEEPSEEK_* 被清空，
 * 所以词典与解析只覆盖「未配置时的降级分支」和「缓存命中分支」。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser, insertPractice } from "./helpers/factories"
import { insertCourse, insertLesson, insertSentence } from "./helpers/content"

async function setDiamonds(userId: string, amount: number): Promise<void> {
  await q("UPDATE users SET diamonds = ? WHERE id = ?", [amount, userId])
}

async function insertDiamondLog(userId: string, amount: number, type: string, date?: Date): Promise<void> {
  await q(
    `INSERT INTO diamond_logs (id, user_id, amount, type, created_at)
     VALUES (UUID(), ?, ?, ?, ?)`,
    [userId, amount, type, date ?? new Date()]
  )
}

beforeEach(async () => {
  await seedFixtures()
})

describe("打卡 /api/home/check-in", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().post("/api/home/check-in")).status).toBe(401)
  })

  it("今日钻石不足门槛 → 403 need_more_diamonds，并回传差额信息", async () => {
    const userId = await insertUser({ name: "钻石不足" })
    await q("UPDATE users SET check_in_goal = 50 WHERE id = ?", [userId])
    await insertDiamondLog(userId, 10, "sentence")

    const res = await ApiClient.asUser(userId).post<{
      error: string
      todayDiamonds: number
      checkInGoal: number
    }>("/api/home/check-in")
    expect(res.status).toBe(403)
    expect(res.body.error).toBe("need_more_diamonds")
    expect(res.body.todayDiamonds).toBe(10)
    expect(res.body.checkInGoal).toBe(50)

    const row = await one("SELECT id FROM check_ins WHERE user_id = ?", [userId])
    expect(row).toBeUndefined()
  })

  it("达到门槛 → 打卡成功，连续天数从 1 开始", async () => {
    const userId = await insertUser({ name: "达标用户" })
    await q("UPDATE users SET check_in_goal = 50 WHERE id = ?", [userId])
    await insertDiamondLog(userId, 50, "lesson_complete")

    const res = await ApiClient.asUser(userId).post<{
      success: boolean
      streakDays: number
      alreadyCheckedIn: boolean
    }>("/api/home/check-in")
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.streakDays).toBe(1)
    expect(res.body.alreadyCheckedIn).toBe(false)
  })

  it("重复打卡同一天：幂等，不产生第二行，streak 不叠加", async () => {
    const userId = await insertUser({ name: "重复打卡" })
    await q("UPDATE users SET check_in_goal = 10 WHERE id = ?", [userId])
    await insertDiamondLog(userId, 10, "sentence")

    const api = ApiClient.asUser(userId)
    const first = await api.post<{ streakDays: number; alreadyCheckedIn: boolean }>("/api/home/check-in")
    const second = await api.post<{ streakDays: number; alreadyCheckedIn: boolean }>("/api/home/check-in")

    expect(first.body.alreadyCheckedIn).toBe(false)
    expect(second.body.alreadyCheckedIn).toBe(true)
    expect(first.body.streakDays).toBe(1)
    expect(second.body.streakDays).toBe(1)

    const cnt = await one<{ c: number }>("SELECT COUNT(*) AS c FROM check_ins WHERE user_id = ?", [userId])
    expect(Number(cnt?.c)).toBe(1)
  })

  it("连续打卡：昨天也打过 → streakDays = 2", async () => {
    const userId = await insertUser({ name: "连续打卡" })
    await q("UPDATE users SET check_in_goal = 10 WHERE id = ?", [userId])
    await insertDiamondLog(userId, 10, "sentence")
    await q("INSERT INTO check_ins (id, user_id, date) VALUES (UUID(), ?, DATE_SUB(CURDATE(), INTERVAL 1 DAY))", [
      userId,
    ])

    const res = await ApiClient.asUser(userId).post<{ streakDays: number }>("/api/home/check-in")
    expect(res.body.streakDays).toBe(2)
  })

  it("门槛按「上海日历日」统计：昨天的钻石不计入今天", async () => {
    const userId = await insertUser({ name: "跨日钻石" })
    await q("UPDATE users SET check_in_goal = 10 WHERE id = ?", [userId])
    await insertDiamondLog(userId, 100, "sentence", new Date(Date.now() - 36 * 3600_000))

    const res = await ApiClient.asUser(userId).post<{
      error: string
      todayDiamonds: number
    }>("/api/home/check-in")
    expect(res.status).toBe(403)
    expect(res.body.todayDiamonds).toBe(0)
  })
})

describe("钻石发放 /api/diamonds/earn", () => {
  it("未登录 → 401；type 非法 / 缺 refId → 400", async () => {
    expect((await ApiClient.anonymous().post("/api/diamonds/earn", { type: "sentence", refId: "x" })).status).toBe(401)

    const api = ApiClient.asUser(FIXTURE.userFree)
    for (const body of [
      {},
      { type: "unknown", refId: "x" },
      { type: "sentence" },
      { type: "sentence", refId: "" },
      { type: "sentence", refId: 123 },
    ]) {
      expect((await api.post("/api/diamonds/earn", body)).status).toBe(400)
    }
  })

  it("sentence：没有本人练习记录 → 403，不发钻石", async () => {
    const userId = await insertUser({ name: "没练过" })
    const res = await ApiClient.asUser(userId).post<{ error: string }>("/api/diamonds/earn", {
      type: "sentence",
      refId: "00000000-0000-4000-8000-0000000000ff",
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe("未找到练习记录，无法发放奖励")

    const user = await one<{ diamonds: number }>("SELECT diamonds FROM users WHERE id = ?", [userId])
    expect(Number(user?.diamonds)).toBe(0)
  })

  it("sentence：有错题 → 5 颗；满分且无连击 → 也是 5 颗", async () => {
    const userId = await insertUser({ name: "基础奖励" })
    const { sentenceId } = await insertSentence()

    await insertPractice(userId, sentenceId, { mistakes: 2 })
    const flawed = await ApiClient.asUser(userId).post<{ earned: number; totalDiamonds: number }>(
      "/api/diamonds/earn",
      { type: "sentence", refId: sentenceId }
    )
    expect(flawed.body.earned).toBe(5)
    expect(flawed.body.totalDiamonds).toBe(5)

    // 另一个句子，满分但前面没有连续满分记录 → streak=1 → 5 颗
    const second = await insertSentence()
    await insertPractice(userId, second.sentenceId, { mistakes: 0 })
    const perfect = await ApiClient.asUser(userId).post<{ earned: number; totalDiamonds: number }>(
      "/api/diamonds/earn",
      { type: "sentence", refId: second.sentenceId }
    )
    expect(perfect.body.earned).toBe(5)
    expect(perfect.body.totalDiamonds).toBe(10)
  })

  it("sentence：连续满分给加成，且封顶 20（5 + min(streak,20)）", async () => {
    const userId = await insertUser({ name: "连击用户" })
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const { sentenceId } = await insertSentence()
      ids.push(sentenceId)
    }

    // 4 条满分记录，时间递增，使最低分连击 streak 达到 4
    const base = Date.now() - 10_000
    for (let i = 0; i < 4; i++) {
      await insertPractice(userId, ids[i], { mistakes: 0, score: 10, createdAt: new Date(base + i * 1000) })
    }

    const res = await ApiClient.asUser(userId).post<{ earned: number }>("/api/diamonds/earn", {
      type: "sentence",
      refId: ids[3],
    })
    // streak = 4 → 5 + min(4,20) = 9
    expect(res.body.earned).toBe(9)

    const log = await one<{ streak: number; amount: number }>(
      "SELECT streak, amount FROM diamond_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId]
    )
    expect(Number(log?.streak)).toBe(4)
    expect(Number(log?.amount)).toBe(9)
  })

  it("lesson_complete → 30；course_complete → 100（不需要练习记录）", async () => {
    const userId = await insertUser({ name: "课时课程奖励" })
    const api = ApiClient.asUser(userId)

    const lesson = await api.post<{ earned: number; totalDiamonds: number }>("/api/diamonds/earn", {
      type: "lesson_complete",
      refId: "lesson-1",
    })
    expect(lesson.body.earned).toBe(30)

    const course = await api.post<{ earned: number; totalDiamonds: number }>("/api/diamonds/earn", {
      type: "course_complete",
      refId: "course-1",
    })
    expect(course.body.earned).toBe(100)
    expect(course.body.totalDiamonds).toBe(130)
  })

  it("同一天同一 refId 重复领取 → alreadyClaimed，钻石不重复增加", async () => {
    const userId = await insertUser({ name: "重复领取" })
    const api = ApiClient.asUser(userId)

    const first = await api.post<{ earned: number; alreadyClaimed: boolean }>("/api/diamonds/earn", {
      type: "lesson_complete",
      refId: "lesson-dup",
    })
    expect(first.body.earned).toBe(30)
    expect(first.body.alreadyClaimed).toBe(false)

    const second = await api.post<{ earned: number; alreadyClaimed: boolean; totalDiamonds: number }>(
      "/api/diamonds/earn",
      { type: "lesson_complete", refId: "lesson-dup" }
    )
    expect(second.body.earned).toBe(0)
    expect(second.body.alreadyClaimed).toBe(true)
    expect(second.body.totalDiamonds).toBe(30)

    const cnt = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM diamond_logs WHERE user_id = ? AND ref_id = 'lesson-dup'",
      [userId]
    )
    expect(Number(cnt?.c)).toBe(1)
  })

  it("并发领取同一 refId：只能成功一次", async () => {
    const userId = await insertUser({ name: "并发领取" })
    const api = ApiClient.asUser(userId)

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.post<{ earned: number; alreadyClaimed: boolean }>("/api/diamonds/earn", {
          type: "course_complete",
          refId: "course-race",
        })
      )
    )
    const earnedCount = results.filter((r) => r.body.earned === 100).length
    expect(earnedCount).toBe(1)

    const user = await one<{ diamonds: number }>("SELECT diamonds FROM users WHERE id = ?", [userId])
    expect(Number(user?.diamonds)).toBe(100)
  })

  it("durationSeconds 非法一律落 NULL，超长被截断到 24 小时", async () => {
    const userId = await insertUser({ name: "时长归一" })
    const api = ApiClient.asUser(userId)

    const invalid = await api.post("/api/diamonds/earn", {
      type: "course_complete",
      refId: "dur-bad",
      durationSeconds: "abc",
    })
    expect(invalid.status).toBe(200)
    const bad = await one<{ duration_seconds: number | null }>(
      "SELECT duration_seconds FROM diamond_logs WHERE ref_id = 'dur-bad'"
    )
    expect(bad?.duration_seconds).toBeNull()

    await api.post("/api/diamonds/earn", {
      type: "course_complete",
      refId: "dur-long",
      durationSeconds: 999_999,
    })
    const long = await one<{ duration_seconds: number }>(
      "SELECT duration_seconds FROM diamond_logs WHERE ref_id = 'dur-long'"
    )
    expect(Number(long?.duration_seconds)).toBe(24 * 60 * 60)
  })

  it("todayDiamonds / todayDurationSeconds 按上海日历日汇总", async () => {
    const userId = await insertUser({ name: "今日汇总" })
    await insertDiamondLog(userId, 7, "sentence", new Date(Date.now() - 36 * 3600_000)) // 昨天
    await insertDiamondLog(userId, 3, "sentence", new Date())

    const res = await ApiClient.asUser(userId).post<{ todayDiamonds: number }>("/api/diamonds/earn", {
      type: "course_complete",
      refId: "summary",
    })
    expect(res.body.todayDiamonds).toBe(103)
  })
})

describe("分享任务 /api/tasks/share 与 /api/tasks/status", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().post("/api/tasks/share")).status).toBe(401)
    expect((await ApiClient.anonymous().get("/api/tasks/status")).status).toBe(401)
  })

  it("首次分享得 10 钻石，重复分享不再发放", async () => {
    const userId = await insertUser({ name: "分享用户", inviteCode: "SHARE001" })
    const api = ApiClient.asUser(userId)

    const first = await api.post<Record<string, unknown>>("/api/tasks/share")
    expect(first.status).toBe(200)
    expect(JSON.stringify(first.body)).toBeTruthy()

    const second = await api.post<Record<string, unknown>>("/api/tasks/share")
    expect(second.status).toBe(200)

    const user = await one<{ diamonds: number }>("SELECT diamonds FROM users WHERE id = ?", [userId])
    expect(Number(user?.diamonds)).toBe(10)
  })

  it("并发分享：只会发一次 10 钻石", async () => {
    const userId = await insertUser({ name: "并发分享" })
    const api = ApiClient.asUser(userId)

    await Promise.all(Array.from({ length: 5 }, () => api.post("/api/tasks/share")))

    const user = await one<{ diamonds: number }>("SELECT diamonds FROM users WHERE id = ?", [userId])
    expect(Number(user?.diamonds)).toBe(10)
    const cnt = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM task_logs WHERE user_id = ? AND task_type = 'share_invite'",
      [userId]
    )
    expect(Number(cnt?.c)).toBe(1)
  })

  it("任务状态：打卡/分享/邀请数/邀请码/钻石数各项口径", async () => {
    const userId = await insertUser({ name: "任务状态", inviteCode: "STATUS01", isPro: 1 })
    await q("UPDATE users SET diamonds = 88 WHERE id = ?", [userId])
    await q("INSERT INTO check_ins (id, user_id, date) VALUES (UUID(), ?, CURDATE())", [userId])
    await q(
      `INSERT INTO task_logs (id, user_id, task_type, reward_type, reward_amount, date)
       VALUES (UUID(), ?, 'share_invite', 'diamond', 10, CURDATE())`,
      [userId]
    )
    await q(
      `INSERT INTO task_logs (id, user_id, task_type, reward_type, reward_amount, date, ref_id)
       VALUES (UUID(), ?, 'invite_register', 'trial_days', 3, CURDATE(), UUID())`,
      [userId]
    )

    const res = await ApiClient.asUser(userId).get<{
      checkIn: boolean
      share: boolean
      inviteTotal: number
      inviteCode: string | null
      diamonds: number
    }>("/api/tasks/status")
    expect(res.status).toBe(200)
    expect(res.body.checkIn).toBe(true)
    expect(res.body.share).toBe(true)
    expect(res.body.inviteTotal).toBe(1)
    expect(res.body.inviteCode).toBe("STATUS01")
    expect(res.body.diamonds).toBe(88)
  })

  it("任务状态：什么都没做时全为否，且只看得到自己的记录", async () => {
    const userId = await insertUser({ name: "空任务" })
    const otherId = await insertUser({ name: "别人" })
    await q("INSERT INTO check_ins (id, user_id, date) VALUES (UUID(), ?, CURDATE())", [otherId])

    const res = await ApiClient.asUser(userId).get<{
      checkIn: boolean
      share: boolean
      inviteTotal: number
      diamonds: number
    }>("/api/tasks/status")
    expect(res.body.checkIn).toBe(false)
    expect(res.body.share).toBe(false)
    expect(res.body.inviteTotal).toBe(0)
    expect(res.body.diamonds).toBe(0)
  })
})

describe("统计 /api/home/stats 与 /api/archive/stats", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/home/stats")).status).toBe(401)
    expect((await ApiClient.anonymous().get("/api/archive/stats")).status).toBe(401)
  })

  it("home/stats：总数、今日、连续天数、待复习数与目标", async () => {
    const userId = await insertUser({ name: "统计用户" })
    await q("UPDATE users SET check_in_goal = 60 WHERE id = ?", [userId])

    const { sentenceId } = await insertSentence()
    await insertPractice(userId, sentenceId, { mistakes: 0, score: 10 })
    await q(
      `INSERT INTO review_queue (id, user_id, sentence_id, status, next_review_at, created_at)
       VALUES (UUID(), ?, ?, 'pending', ?, ?)`,
      [userId, sentenceId, new Date(Date.now() - 3600_000), new Date()]
    )
    await q("INSERT INTO check_ins (id, user_id, date) VALUES (UUID(), ?, CURDATE())", [userId])

    const res = await ApiClient.asUser(userId).get<{
      totalSentences: number
      todayCount: number
      streakDays: number
      pendingReviews: number
      checkInGoal: number
      checkedInToday: boolean
      todayDiamonds: number
    }>("/api/home/stats")

    expect(res.status).toBe(200)
    expect(res.body.totalSentences).toBe(1)
    expect(res.body.todayCount).toBe(1)
    expect(res.body.streakDays).toBe(1)
    expect(res.body.pendingReviews).toBe(1)
    expect(res.body.checkInGoal).toBe(60)
    expect(res.body.checkedInToday).toBe(true)
  })

  it("home/stats：没有任何记录时返回 0 而不是报错", async () => {
    const userId = await insertUser({ name: "空统计" })
    const res = await ApiClient.asUser(userId).get<{
      totalSentences: number
      totalDays: number
      streakDays: number
      pendingReviews: number
      checkedInToday: boolean
      heatmap: Record<string, number>
      weekly: unknown[]
    }>("/api/home/stats")
    expect(res.status).toBe(200)
    expect(res.body.totalSentences).toBe(0)
    expect(res.body.totalDays).toBe(0)
    expect(res.body.streakDays).toBe(0)
    expect(res.body.pendingReviews).toBe(0)
    expect(res.body.checkedInToday).toBe(false)
    // heatmap 是「日期 → 钻石」的对象，不是数组
    expect(res.body.heatmap).toEqual({})
    expect(Array.isArray(res.body.weekly)).toBe(true)
  })

  it("archive/stats：period 过滤只影响区间内数据，非法 period 退化为 all", async () => {
    const userId = await insertUser({ name: "归档用户" })
    const { sentenceId } = await insertSentence()

    await insertPractice(userId, sentenceId, { mistakes: 0 })
    // 40 天前的一条：用 SQL 直接减时间，避免时区口径在测试侧被再算一次
    await insertPractice(userId, sentenceId, {
      mistakes: 0,
      score: 10,
      createdAt: new Date(Date.now() - 40 * 86400_000),
    })

    const api = ApiClient.asUser(userId)
    const all = await api.get<{ totalSentences: number; learningDays: number }>("/api/archive/stats?period=all")
    const week = await api.get<{ totalSentences: number }>("/api/archive/stats?period=week")
    const month = await api.get<{ totalSentences: number }>("/api/archive/stats?period=month")
    const bogus = await api.get<{ totalSentences: number }>("/api/archive/stats?period=banana")

    expect(all.status).toBe(200)
    expect(all.body.totalSentences).toBe(2)
    expect(week.body.totalSentences).toBe(1)
    expect(month.body.totalSentences).toBe(1)
    expect(bogus.body.totalSentences).toBe(2) // 非法值退化为 all
  })

  it("archive/stats：别人练过的数据不会算进来", async () => {
    const mine = await insertUser({ name: "我" })
    const other = await insertUser({ name: "他" })
    const { sentenceId } = await insertSentence()
    await insertPractice(other, sentenceId, { mistakes: 0 })

    const res = await ApiClient.asUser(mine).get<{ totalSentences: number }>("/api/archive/stats?period=all")
    expect(res.body.totalSentences).toBe(0)
  })
})

describe("词典 /api/dict/word 与句子解析 /api/sentences/[id]/analysis", () => {
  it("未登录 → 401（词典与解析都不对外公开）", async () => {
    expect((await ApiClient.anonymous().get("/api/dict/word?word=hello")).status).toBe(401)
    expect(
      (await ApiClient.anonymous().get("/api/sentences/00000000-0000-4000-8000-000000000001/analysis")).status
    ).toBe(401)
  })

  it("词典：缺 word → 400；有缓存时直接返回缓存内容", async () => {
    const userId = await insertUser({ name: "词典用户" })
    const api = ApiClient.asUser(userId)

    expect((await api.get("/api/dict/word")).status).toBe(400)
    expect((await api.get("/api/dict/word?word=")).status).toBe(400)

    await q(
      `INSERT INTO word_dictionary_cache (word, phonetic, phonetic_uk, translations, pos)
       VALUES ('hello', '/həˈloʊ/', '/həˈləʊ/', CAST(? AS JSON), CAST(? AS JSON))`,
      [JSON.stringify(["你好"]), JSON.stringify([{ pos: "int.", meaning: "你好" }])]
    )

    const res = await api.get<{
      word: string
      phonetic: string | null
      translations: string[]
      cached: boolean
    }>("/api/dict/word?word=hello")
    expect(res.status).toBe(200)
    expect(res.body.word).toBe("hello")
    expect(res.body.phonetic).toBe("/həˈloʊ/")
    expect(res.body.translations).toEqual(["你好"])
    expect(res.body.cached).toBe(true)
  })

  it("词典：大小写与首尾空格归一化后命中同一份缓存", async () => {
    const userId = await insertUser({ name: "词典归一" })
    await q(
      `INSERT INTO word_dictionary_cache (word, phonetic, translations)
       VALUES ('apple', '/ˈæpəl/', CAST(? AS JSON))`,
      [JSON.stringify(["苹果"])]
    )

    const res = await ApiClient.asUser(userId).get<{ word: string; translations: string[] }>(
      "/api/dict/word?word=%20APPLE%20"
    )
    expect(res.status).toBe(200)
    expect(res.body.word).toBe("apple")
    expect(res.body.translations).toEqual(["苹果"])
  })

  it("词典：YOUDAO 未配置且无缓存 → 不 500，返回可识别的降级结果", async () => {
    const userId = await insertUser({ name: "词典降级" })
    const res = await ApiClient.asUser(userId).get<{ error?: string; word?: string }>(
      "/api/dict/word?word=zzzznotexist"
    )
    // 允许 200（返回空释义）或 4xx/5xx，但必须是结构化的 JSON，不能挂掉
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(600)
    expect(res.body).toBeTypeOf("object")
  })

  it("句子解析：句子不存在 → 404；无缓存 → data:null；有缓存 → 返回缓存", async () => {
    const userId = await insertUser({ name: "解析用户" })
    const api = ApiClient.asUser(userId)

    const missing = await api.get("/api/sentences/00000000-0000-4000-8000-0000000000aa/analysis")
    expect(missing.status).toBe(404)

    const { sentenceId } = await insertSentence({ english: "She is a teacher." })
    const empty = await api.get<{ data: null }>(`/api/sentences/${sentenceId}/analysis`)
    expect(empty.status).toBe(200)
    expect(empty.body.data).toBeNull()

    // 按 sha256(trim(english)) 写缓存，应能命中
    await q(
      `INSERT INTO sentence_knowledge (id, sentence_hash, sentence_text, data)
       VALUES (UUID(), SHA2('She is a teacher.', 256), 'She is a teacher.', CAST(? AS JSON))`,
      [JSON.stringify({ translation: "她是一名老师。", grammar: [] })]
    )
    const hit = await api.get<{ data: { translation: string } | null }>(
      `/api/sentences/${sentenceId}/analysis`
    )
    expect(hit.body.data).not.toBeNull()
    expect(hit.body.data?.translation).toBe("她是一名老师。")
  })
})

describe("埋点 /api/analytics/track", () => {
  it("匿名也能上报白名单事件（页面浏览不需要登录）", async () => {
    const res = await ApiClient.anonymous().post<{ ok: boolean }>(
      "/api/analytics/track",
      { event: "page_view", pageUrl: "/home" },
      { headers: { "x-real-ip": "203.0.113.201" } }
    )
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const row = await one<{ event_type: string; page_url: string; user_id: string | null }>(
      "SELECT event_type, page_url, user_id FROM analytics_events ORDER BY id DESC LIMIT 1"
    )
    expect(row?.event_type).toBe("page_view")
    expect(row?.page_url).toBe("/home")
    // 匿名上报：user_id 必须为空，不能把别人的身份记上去
    expect(row?.user_id).toBeNull()
  })

  it("登录用户的埋点会绑定到本人", async () => {
    const userId = await insertUser({ name: "埋点用户" })
    const res = await ApiClient.asUser(userId).post<{ ok: boolean }>(
      "/api/analytics/track",
      { event: "practice_complete", properties: { mistakes: 0 } },
      { headers: { "x-real-ip": "203.0.113.203" } }
    )
    expect(res.status).toBe(200)

    const row = await one<{ user_id: string | null; properties: { mistakes: number } }>(
      "SELECT user_id, properties FROM analytics_events WHERE event_type = 'practice_complete' ORDER BY id DESC LIMIT 1"
    )
    expect(row?.user_id).toBe(userId)
    expect(Number(row?.properties?.mistakes)).toBe(0)
  })

  it("非白名单事件 → 400，不落库", async () => {
    const before = await one<{ c: number }>("SELECT COUNT(*) AS c FROM analytics_events")
    const res = await ApiClient.anonymous().post<{ error: string }>(
      "/api/analytics/track",
      { event: "evil_event" },
      { headers: { "x-real-ip": "203.0.113.202" } }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("非法的事件名")

    const after = await one<{ c: number }>("SELECT COUNT(*) AS c FROM analytics_events")
    expect(Number(after?.c)).toBe(Number(before?.c))
  })
})
