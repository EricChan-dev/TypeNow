/**
 * 复习本与间隔重复（/api/review/*）
 *
 * 复习是与会员无关的功能（/home/review 没有 Pro 门禁），所以这一组用例都按
 * 普通免费账号来跑，确保「免费用户也能正常复习」这条产品口径不被误伤。
 *
 * 间隔算法 sm2 的期望值直接按 src/lib/spaced-repetition.ts 的规则推导：
 *   grade<=2 → interval=1, consecutive=0
 *   grade=3  → interval=ceil(interval*1.2), consecutive-1
 *   grade=4  → interval=ceil(interval*ease), consecutive+1
 *   grade=5  → interval=min(30, ceil(interval*ease*1.15)), ease+0.1（上限 3.0）
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, one, q } from "./helpers/db"
import { insertReviewItem } from "./helpers/factories"

const PAST = new Date(Date.now() - 60_000)
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000)

async function item(userId: string, sentenceId: string) {
  return one<{
    status: string
    interval_days: number
    ease_factor: string
    consecutive_ok: number
    review_count: number
    next_review_at: Date | null
  }>(
    "SELECT status, interval_days, ease_factor, consecutive_ok, review_count, next_review_at FROM review_queue WHERE user_id = ? AND sentence_id = ?",
    [userId, sentenceId]
  )
}

beforeEach(async () => {
  await seedFixtures()
})

describe("复习列表 /api/review/list", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/review/list")).status).toBe(401)
  })

  it("due 只返回已到期的 pending，done 只返回已掌握", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, { nextReviewAt: PAST })
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA2Plain, { nextReviewAt: FUTURE })
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentB1Plain, { status: "done" })

    const api = ApiClient.asUser(FIXTURE.userFree)
    const due = await api.get<{ items: Array<{ sentenceId: string }>; dueCount: number }>(
      "/api/review/list?status=due"
    )
    expect(due.body.items.map((i) => i.sentenceId)).toEqual([FIXTURE.sentA1Plain])

    const done = await api.get<{ items: Array<{ sentenceId: string }> }>(
      "/api/review/list?status=done"
    )
    expect(done.body.items.map((i) => i.sentenceId)).toEqual([FIXTURE.sentB1Plain])

    const all = await api.get<{ items: unknown[]; allCount: number }>("/api/review/list?status=all")
    expect(all.body.items.length).toBe(3)
    expect(Number(all.body.allCount)).toBe(3)
  })

  it("三个计数与当前筛选无关，始终返回全量口径（侧边栏角标依赖它）", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, { nextReviewAt: PAST })
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA2Plain, { nextReviewAt: FUTURE })
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentB1Plain, { status: "done" })

    for (const status of ["due", "done", "all"]) {
      const res = await ApiClient.asUser(FIXTURE.userFree).get<{
        dueCount: number
        doneCount: number
        allCount: number
      }>(`/api/review/list?status=${status}`)
      expect(Number(res.body.dueCount)).toBe(1)
      expect(Number(res.body.doneCount)).toBe(1)
      expect(Number(res.body.allCount)).toBe(3)
    }
  })

  it("带出句子正文与来源课程，便于前端直接展示", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain)
    const res = await ApiClient.asUser(FIXTURE.userFree).get<{
      items: Array<{ english: string; chinese: string; courseId: string; courseTitle: string }>
    }>("/api/review/list?status=due")

    const row = res.body.items[0]
    expect(row.english).toBe("I study English every day.")
    expect(row.chinese).toBe("我每天学习英语。")
    expect(row.courseId).toBe(FIXTURE.coursePublished)
    expect(row.courseTitle).toBe("测试课程·已发布")
  })

  it("题干不可用的句子不进复习本，且列表与角标口径一致（不能角标有、点进去没有）", async () => {
    // 线上有 7 条这种复习项：chinese 就是答案本身，用户看不到任何中文提示。
    // 关键在「一致」：列表过滤了而计数没过滤，就会出现「角标 2 条待复习、点进去只有 1 条」。
    await q(
      `INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, words, words_count) VALUES
       ('55555555-5555-4555-8555-000000000021', 'mark', 'mark', ?, 3, NULL, 0)`,
      [FIXTURE.lessonA1]
    )
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, { nextReviewAt: PAST })
    await insertReviewItem(FIXTURE.userFree, "55555555-5555-4555-8555-000000000021", {
      nextReviewAt: PAST,
    })

    const res = await ApiClient.asUser(FIXTURE.userFree).get<{
      items: Array<{ sentenceId: string }>
      dueCount: number
      allCount: number
    }>("/api/review/list?status=due")

    expect(res.body.items.map((i) => i.sentenceId)).toEqual([FIXTURE.sentA1Plain])
    expect(Number(res.body.dueCount)).toBe(1)
    expect(Number(res.body.allCount)).toBe(1)
  })

  it("只返回自己的复习项，pageSize 有上限", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain)
    await insertReviewItem(FIXTURE.userPro, FIXTURE.sentA2Plain)

    const res = await ApiClient.asUser(FIXTURE.userFree).get<{ items: unknown[]; allCount: number }>(
      "/api/review/list?status=all&pageSize=99999"
    )
    expect(res.body.items.length).toBe(1)
    expect(Number(res.body.allCount)).toBe(1)
  })

  it("非法分页参数不 500", async () => {
    for (const qs of ["page=abc", "pageSize=abc", "page=-1", "pageSize=0"]) {
      const res = await ApiClient.asUser(FIXTURE.userFree).get(`/api/review/list?${qs}`)
      expect(res.status).toBe(200)
    }
  })
})

describe("复习队列 /api/review/queue", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/review/queue")).status).toBe(401)
  })

  it("只返回到期项，并带出分词与分块数据", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, { nextReviewAt: PAST })
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA2Plain, { nextReviewAt: FUTURE })

    const res = await ApiClient.asUser(FIXTURE.userFree).get<{
      items: Array<{ sentenceId: string; english: string; words: unknown[] }>
      total: number
    }>("/api/review/queue")

    expect(res.status).toBe(200)
    expect(res.body.items.length).toBe(1)
    expect(Number(res.body.total)).toBe(1)
    expect(res.body.items[0].words.length).toBeGreaterThan(0)
  })

  it("空队列返回空数组而不是 null", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).get<{
      items: unknown[] | null
      total: number
    }>("/api/review/queue")
    expect(res.body.items).toEqual([])
    expect(Number(res.body.total)).toBe(0)
  })
})

describe("加入复习 /api/review/enqueue", () => {
  it("未登录 → 401；缺 sentenceId → 400", async () => {
    expect((await ApiClient.anonymous().post("/api/review/enqueue", {})).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userFree).post("/api/review/enqueue", {})).status).toBe(
      400
    )
  })

  it("首次加入：立刻到期，interval=1，ease=2.50", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ success: boolean }>(
      "/api/review/enqueue",
      { sentenceId: FIXTURE.sentA1Plain }
    )
    expect(res.status).toBe(200)

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(row?.status).toBe("pending")
    expect(Number(row?.interval_days)).toBe(1)
    expect(Number(row?.ease_factor)).toBe(2.5)
    expect(new Date(row!.next_review_at!).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("重复加入不会新增行，也不会把已有的到期日提前", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, { nextReviewAt: FUTURE })

    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ alreadyQueued: boolean }>(
      "/api/review/enqueue",
      { sentenceId: FIXTURE.sentA1Plain }
    )
    expect(res.status).toBe(200)
    expect(res.body.alreadyQueued).toBe(true)

    const count = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM review_queue WHERE user_id = ? AND sentence_id = ?",
      [FIXTURE.userFree, FIXTURE.sentA1Plain]
    )
    expect(Number(count?.c)).toBe(1)

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(new Date(row!.next_review_at!).getTime()).toBeGreaterThan(Date.now())
  })

  it("已掌握的句子「再练一次」会重置为待复习", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, {
      status: "done",
      consecutiveOk: 4,
      reviewCount: 6,
      intervalDays: 20,
    })

    await ApiClient.asUser(FIXTURE.userFree).post("/api/review/enqueue", {
      sentenceId: FIXTURE.sentA1Plain,
      forceReset: true,
    })

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(row?.status).toBe("pending")
    expect(Number(row?.interval_days)).toBe(1)
    expect(Number(row?.consecutive_ok)).toBe(0)
    expect(new Date(row!.next_review_at!).getTime()).toBeLessThanOrEqual(Date.now())
    // 复习次数是历史累计，重置不该抹掉
    expect(Number(row?.review_count)).toBe(6)
  })

  it("forceReset 对未掌握的待复习项同样立刻到期（UI 语义：强制拉回今日）", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, {
      nextReviewAt: FUTURE,
      intervalDays: 12,
      consecutiveOk: 3,
    })

    await ApiClient.asUser(FIXTURE.userFree).post("/api/review/enqueue", {
      sentenceId: FIXTURE.sentA1Plain,
      forceReset: true,
    })

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(row?.status).toBe("pending")
    expect(new Date(row!.next_review_at!).getTime()).toBeLessThanOrEqual(Date.now())
    expect(Number(row?.interval_days)).toBe(1)
    expect(Number(row?.consecutive_ok)).toBe(0)
  })
})

describe("完成复习 /api/review/complete", () => {
  it("未登录 → 401；缺 sentenceId → 400", async () => {
    expect((await ApiClient.anonymous().post("/api/review/complete", { grade: 5 })).status).toBe(401)
    expect(
      (await ApiClient.asUser(FIXTURE.userFree).post("/api/review/complete", { grade: 5 })).status
    ).toBe(400)
  })

  it("既没有 grade 也没有 mastered → 400；grade 越界 → 400", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(
      (await api.post("/api/review/complete", { sentenceId: FIXTURE.sentA1Plain })).status
    ).toBe(400)
    expect(
      (await api.post("/api/review/complete", { sentenceId: FIXTURE.sentA1Plain, grade: 6 })).status
    ).toBe(400)
    expect(
      (await api.post("/api/review/complete", { sentenceId: FIXTURE.sentA1Plain, grade: -1 })).status
    ).toBe(400)
  })

  it("不在自己队列里的句子 → 404（不能替别人完成复习）", async () => {
    await insertReviewItem(FIXTURE.userPro, FIXTURE.sentA1Plain)
    const res = await ApiClient.asUser(FIXTURE.userFree).post("/api/review/complete", {
      sentenceId: FIXTURE.sentA1Plain,
      grade: 5,
    })
    expect(res.status).toBe(404)
    // 别人的队列不能被改动
    const row = await item(FIXTURE.userPro, FIXTURE.sentA1Plain)
    expect(Number(row?.review_count)).toBe(0)
  })

  it("mastered=true → 标记掌握，reviewCount +1", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, { reviewCount: 2 })
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ status: string }>(
      "/api/review/complete",
      { sentenceId: FIXTURE.sentA1Plain, mastered: true }
    )
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("done")

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(row?.status).toBe("done")
    expect(Number(row?.review_count)).toBe(3)
  })

  it("grade=4（记得）：间隔按 ease 乘算，consecutive +1", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, {
      intervalDays: 2,
      easeFactor: "2.50",
      consecutiveOk: 1,
    })
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ intervalDays: number }>(
      "/api/review/complete",
      { sentenceId: FIXTURE.sentA1Plain, grade: 4 }
    )
    expect(res.status).toBe(200)
    expect(res.body.intervalDays).toBe(5) // ceil(2 * 2.5)

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(Number(row?.interval_days)).toBe(5)
    expect(Number(row?.consecutive_ok)).toBe(2)
    expect(Number(row?.ease_factor)).toBe(2.5)
    expect(new Date(row!.next_review_at!).getTime()).toBeGreaterThan(Date.now())
  })

  it("grade=2（不记得）：间隔重置为 1 天，consecutive 归零", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, {
      intervalDays: 18,
      easeFactor: "2.50",
      consecutiveOk: 5,
      reviewCount: 7,
    })
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ intervalDays: number }>(
      "/api/review/complete",
      { sentenceId: FIXTURE.sentA1Plain, grade: 2 }
    )
    expect(res.status).toBe(200)
    expect(res.body.intervalDays).toBe(1)

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(Number(row?.interval_days)).toBe(1)
    expect(Number(row?.consecutive_ok)).toBe(0)
    expect(Number(row?.review_count)).toBe(8)
    expect(row?.status).toBe("pending")
  })

  it("grade=5（完美）：间隔封顶 30 天，ease 递增且不超过 3.00", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, {
      intervalDays: 20,
      easeFactor: "2.95",
    })
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ intervalDays: number }>(
      "/api/review/complete",
      { sentenceId: FIXTURE.sentA1Plain, grade: 5 }
    )
    expect(res.status).toBe(200)
    expect(res.body.intervalDays).toBe(30)

    const row = await item(FIXTURE.userFree, FIXTURE.sentA1Plain)
    expect(Number(row?.ease_factor)).toBe(3.0)
    expect(Number(row?.interval_days)).toBe(30)
  })

  it("grade 传字符串 \"4\" 时按 4 处理而不是落到 grade 5 分支", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, {
      intervalDays: 2,
      easeFactor: "2.50",
    })
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ intervalDays: number }>(
      "/api/review/complete",
      { sentenceId: FIXTURE.sentA1Plain, grade: "4" }
    )
    expect(res.status).toBe(200)
    // grade 5 会变成 ceil(2*2.5*1.15)=6，grade 4 是 ceil(2*2.5)=5
    expect(res.body.intervalDays).toBe(5)
  })

  it("mastered 传字符串 \"false\" 时不能被当成 true", async () => {
    await insertReviewItem(FIXTURE.userFree, FIXTURE.sentA1Plain, { intervalDays: 2 })
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ status: string }>(
      "/api/review/complete",
      { sentenceId: FIXTURE.sentA1Plain, grade: 4, mastered: "false" }
    )
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("pending")
  })
})
