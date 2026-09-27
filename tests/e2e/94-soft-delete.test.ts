/**
 * 链路：内容软删除（课程 / 课时 / 句子）
 *
 * 为什么单独覆盖这一整套：这三个表原来是**硬删除**，而库里一个外键都没有 ——
 * 删一门课程会留下最多 16,891 条孤儿课时，且不可逆。改成软删除之后，
 * 风险从"删错就没了"转移到"**过滤漏了一条读路径**"：已删除的内容会继续
 * 出现在学员端。那种失败是静默的（接口照常 200，只是内容不该在）。
 *
 * 所以这个文件的重点是两类断言：
 *   1. 学员端**每一条**读路径都看不到已删除内容（列表、详情、课时、练习、复习）
 *   2. 恢复是**按批次精确还原**的 —— 删课程时连带删掉的能一起回来，
 *      而删除课程之前就已单独删掉的句子不会被误复活
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser } from "./helpers/factories"

async function makeAdmin(): Promise<ApiClient> {
  const id = await insertUser({ name: "e2e 软删除管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return ApiClient.asUser(id)
}

interface ListBody<T = Record<string, unknown>> {
  data: T[]
  total: number
}

/**
 * 读某一行的删除批次（判断级联标记是否真的落到子内容上）。
 *
 * 用 deleted_batch 而不是 deleted_at：批次是恢复的唯一依据，
 * 而 deleted_at 只表示"什么时候删的"（drizzle 的映射只到秒，不适合做标识）。
 */
async function deletedBatchOf(table: "courses" | "lessons" | "sentences", id: string) {
  const row = await one<{ b: string | null }>(
    `SELECT deleted_batch AS b FROM ${table} WHERE id = ?`,
    [id],
  )
  return row?.b ?? null
}

beforeEach(async () => {
  await seedFixtures()
})

describe("软删除：学员端读路径", () => {
  it("删课程后：公开课程列表里没有了", async () => {
    const admin = await makeAdmin()
    const before = await ApiClient.anonymous().get<ListBody>(
      "/api/courses/list?pageSize=100",
    )
    expect(before.body.data.some((c) => c.id === FIXTURE.coursePublished)).toBe(true)

    const del = await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)
    expect(del.status).toBe(200)

    const after = await ApiClient.anonymous().get<ListBody>("/api/courses/list?pageSize=100")
    expect(after.body.data.some((c) => c.id === FIXTURE.coursePublished)).toBe(false)
    // 总数也要跟着减，否则分页会多出一页空的
    expect(after.body.total).toBe(before.body.total - 1)
  })

  it("删课程后：课程详情 404", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)
    const res = await ApiClient.anonymous().get(`/api/courses/${FIXTURE.coursePublished}`)
    expect(res.status).toBe(404)
  })

  it("删课程后：课程下的课时接口 404（不能只剩一个空壳课程）", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)
    const res = await ApiClient.anonymous().get(
      `/api/courses/${FIXTURE.coursePublished}/lessons`,
    )
    expect(res.status).toBe(404)
  })

  it("删课程后：**级联**把课时与句子都标记了（不是只标记课程本身）", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)

    // 子内容自己必须带标记：句子会通过很多路径被直接读到（按 id、复习 join、
    // 练习记录 join），只标记顶层就得让每条路径自己往上追溯父级
    expect(await deletedBatchOf("courses", FIXTURE.coursePublished)).not.toBeNull()
    expect(await deletedBatchOf("lessons", FIXTURE.lessonA1)).not.toBeNull()
    expect(await deletedBatchOf("sentences", FIXTURE.sentA1Plain)).not.toBeNull()
    // 同一批共用同一个批次号，恢复时靠它精确还原（不是靠时间戳）
    expect(await deletedBatchOf("lessons", FIXTURE.lessonA1)).toBe(
      await deletedBatchOf("courses", FIXTURE.coursePublished),
    )
    expect(await deletedBatchOf("sentences", FIXTURE.sentA1Plain)).toBe(
      await deletedBatchOf("courses", FIXTURE.coursePublished),
    )
  })

  it("删课程后：练习接口不再下发它的句子", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)

    const res = await ApiClient.asUser(FIXTURE.userPro).get<{ sentences: unknown[] }>(
      `/api/courses/sentences?lessonId=${FIXTURE.lessonA1}`,
    )
    // 课时查不到（因为它属于已删除的课程）→ 404，而不是下发内容
    expect(res.status).toBe(404)
  })

  it("删课时后：练习接口 404，且该课时的句子都被标记", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/lessons/${FIXTURE.lessonA1}`)

    const res = await ApiClient.asUser(FIXTURE.userPro).get(
      `/api/courses/sentences?lessonId=${FIXTURE.lessonA1}`,
    )
    expect(res.status).toBe(404)
    expect(await deletedBatchOf("sentences", FIXTURE.sentA1Plain)).not.toBeNull()
    // 同一课程下的**另一个**课时不受影响
    expect(await deletedBatchOf("lessons", FIXTURE.lessonA2)).toBeNull()
    expect(await deletedBatchOf("sentences", FIXTURE.sentA2Plain)).toBeNull()
  })

  it("删句子后：不再出现在练习内容里，也不回到复习队列", async () => {
    const admin = await makeAdmin()
    const del = await admin.request("DELETE", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)
    expect(del.status).toBe(200)

    const practice = await ApiClient.asUser(FIXTURE.userPro).get<{
      sentences: Array<{ id: string }>
    }>(`/api/courses/sentences?lessonId=${FIXTURE.lessonA1}`)
    expect(practice.status).toBe(200)
    expect(practice.body.sentences.some((s) => s.id === FIXTURE.sentA1Plain)).toBe(false)

    const queue = await ApiClient.asUser(FIXTURE.userFree).get<{ items: Array<{ english: string }> }>(
      "/api/review/queue",
    )
    expect(queue.status).toBe(200)
    // 复习队列是按句子 join 出来的：句子被删了就不该再练
    expect(queue.body.items).toEqual([])
  })
})

describe("软删除：后台回收站视图", () => {
  it("默认视图看不到已删除的；?deleted=only 能；?deleted=all 两边都能", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)

    const normal = await admin.get<ListBody>("/api/admin/courses?pageSize=100")
    expect(normal.body.data.some((c) => c.id === FIXTURE.coursePublished)).toBe(false)

    const only = await admin.get<ListBody>("/api/admin/courses?pageSize=100&deleted=only")
    expect(only.body.data.some((c) => c.id === FIXTURE.coursePublished)).toBe(true)
    // 回收站里应当只有被删的那些
    expect(only.body.data.every((c) => c.deletedAt != null)).toBe(true)

    const all = await admin.get<ListBody>("/api/admin/courses?pageSize=100&deleted=all")
    expect(all.body.total).toBeGreaterThan(only.body.total)
  })

  it("非法 deleted 值回落正常视图（不能把回收站内容漏进日常列表）", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)
    const res = await admin.get<ListBody>("/api/admin/courses?pageSize=100&deleted=1")
    expect(res.body.data.some((c) => c.id === FIXTURE.coursePublished)).toBe(false)
  })

  it("课时列表同样支持回收站，并带出课程名", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/lessons/${FIXTURE.lessonA1}`)

    const normal = await admin.get<ListBody>("/api/admin/lessons?pageSize=100")
    expect(normal.body.data.some((l) => l.id === FIXTURE.lessonA1)).toBe(false)

    const only = await admin.get<ListBody>("/api/admin/lessons?pageSize=100&deleted=only")
    const row = only.body.data.find((l) => l.id === FIXTURE.lessonA1)
    expect(row).toBeDefined()
    // 列表要显示课程名而不是 UUID
    expect(row?.courseTitle).toBeTruthy()
  })

  it("句子列表回收站可用，且正常视图的 total 仍等于仪表盘口径", async () => {
    const admin = await makeAdmin()
    const beforeTotal = (await admin.get<ListBody>("/api/admin/sentences?pageSize=1")).body.total
    await admin.request("DELETE", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)

    const normal = await admin.get<ListBody>("/api/admin/sentences?pageSize=1")
    expect(normal.body.total).toBe(beforeTotal - 1)

    const only = await admin.get<ListBody>("/api/admin/sentences?pageSize=100&deleted=only")
    expect(only.body.data.some((s) => s.id === FIXTURE.sentA1Plain)).toBe(true)
    // 回收站的 total 不能被当成全局总数（那就不是缓存值了）
    expect((only.body as unknown as { totalIsCached?: boolean }).totalIsCached).toBe(false)
  })
})

describe("软删除：影响面统计", () => {
  it("课程的影响面给出课时数与句子数（删除前必须能看到这个数字）", async () => {
    const admin = await makeAdmin()
    const res = await admin.get<{ data: { lessons: number; sentences: number } }>(
      `/api/admin/courses/${FIXTURE.coursePublished}/impact`,
    )
    expect(res.status).toBe(200)
    expect(res.body.data.lessons).toBeGreaterThan(0)
    expect(res.body.data.sentences).toBeGreaterThan(0)
  })

  it("课时的影响面只算句子", async () => {
    const admin = await makeAdmin()
    const res = await admin.get<{ data: { lessons: number; sentences: number } }>(
      `/api/admin/lessons/${FIXTURE.lessonA1}/impact`,
    )
    expect(res.status).toBe(200)
    expect(res.body.data.lessons).toBe(0)
    expect(res.body.data.sentences).toBeGreaterThan(0)
  })

  it("删除后影响面归零（不会把回收站里的内容再算一遍）", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/lessons/${FIXTURE.lessonA1}`)
    const res = await admin.get<{ data: { sentences: number } }>(
      `/api/admin/lessons/${FIXTURE.lessonA1}/impact`,
    )
    expect(res.body.data.sentences).toBe(0)
  })
})

describe("软删除：恢复", () => {
  it("恢复课程 → 课程/课时/句子一起回来，学员端重新可见", async () => {
    const admin = await makeAdmin()
    const courseId = FIXTURE.coursePublished
    await admin.request("DELETE", `/api/admin/courses/${courseId}`)

    const res = await admin.request("PATCH", `/api/admin/courses/${courseId}`)
    expect(res.status).toBe(200)

    expect(await deletedBatchOf("courses", courseId)).toBeNull()
    expect(await deletedBatchOf("lessons", FIXTURE.lessonA1)).toBeNull()
    expect(await deletedBatchOf("sentences", FIXTURE.sentA1Plain)).toBeNull()

    const list = await ApiClient.anonymous().get<ListBody>("/api/courses/list?pageSize=100")
    expect(list.body.data.some((c) => c.id === courseId)).toBe(true)
  })

  it("**按批次恢复**：删课程之前就单独删掉的句子，恢复课程时不会被复活", async () => {
    const admin = await makeAdmin()
    const courseId = FIXTURE.coursePublished

    // 1) 先单独删掉一句（批次 B0），它不属于后来的课程删除批次
    await admin.request("DELETE", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)
    const soloBatch = await deletedBatchOf("sentences", FIXTURE.sentA1Plain)
    expect(soloBatch).not.toBeNull()

    // 2) 再删课程（批次 B1）。两者是**不同**的批次 ——
    //    这正是不能用时间戳做标识的地方：同一秒内两次删除的时间戳会相同
    //    （drizzle 的 datetime 映射只到秒），恢复课程时就会把这句误复活
    await admin.request("DELETE", `/api/admin/courses/${courseId}`)
    const courseBatch = await deletedBatchOf("courses", courseId)
    expect(courseBatch).not.toBeNull()
    expect(courseBatch).not.toBe(soloBatch)

    // 3) 恢复课程：同批次的课时/句子回来，但先单独删的那句**仍然是删除状态**
    await admin.request("PATCH", `/api/admin/courses/${courseId}`)

    expect(await deletedBatchOf("lessons", FIXTURE.lessonA1)).toBeNull()
    expect(await deletedBatchOf("sentences", FIXTURE.sentA2Plain)).toBeNull()
    expect(await deletedBatchOf("sentences", FIXTURE.sentA1Plain)).toBe(soloBatch)
  })

  it("恢复课时 → 同批次的句子回来，课程不受影响", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/lessons/${FIXTURE.lessonA1}`)
    const res = await admin.request("PATCH", `/api/admin/lessons/${FIXTURE.lessonA1}`)
    expect(res.status).toBe(200)

    expect(await deletedBatchOf("lessons", FIXTURE.lessonA1)).toBeNull()
    expect(await deletedBatchOf("sentences", FIXTURE.sentA1Plain)).toBeNull()
    expect(await deletedBatchOf("courses", FIXTURE.coursePublished)).toBeNull()
  })

  it("恢复句子单独可用", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)
    const res = await admin.request("PATCH", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)
    expect(res.status).toBe(200)
    expect(await deletedBatchOf("sentences", FIXTURE.sentA1Plain)).toBeNull()
  })

  it("重复删除 / 恢复不存在的东西 → 404（不能让前端误以为成功）", async () => {
    const admin = await makeAdmin()
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)

    // 已经是删除状态，再删一次要明确失败
    const twice = await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)
    expect(twice.status).toBe(404)

    // 没被删的课程不能"恢复"
    const notDeleted = await admin.request("PATCH", `/api/admin/courses/${FIXTURE.courseUnpublished}`)
    expect(notDeleted.status).toBe(404)

    const ghost = await admin.request("PATCH", "/api/admin/courses/00000000-0000-4000-8000-000000000000")
    expect(ghost.status).toBe(404)
  })

  it("恢复后句子总数回到原值（缓存要被失效）", async () => {
    const admin = await makeAdmin()
    const before = (await admin.get<ListBody>("/api/admin/sentences?pageSize=1")).body.total

    await admin.request("DELETE", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)
    expect((await admin.get<ListBody>("/api/admin/sentences?pageSize=1")).body.total).toBe(before - 1)

    await admin.request("PATCH", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)
    // 缓存没失效的话这里还是 before-1，看起来像"恢复没生效"
    expect((await admin.get<ListBody>("/api/admin/sentences?pageSize=1")).body.total).toBe(before)
  })
})

describe("软删除：仪表盘口径", () => {
  it("内容总量不含已删除的课程/课时/句子", async () => {
    const admin = await makeAdmin()
    interface Totals {
      totals: { sentences: number | null; courses: number | null; lessons: number | null }
    }
    const before = await admin.get<Totals>("/api/admin/dashboard?range=all")

    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)

    const after = await admin.get<Totals>("/api/admin/dashboard?range=all")
    expect(after.body.totals.courses).toBe((before.body.totals.courses ?? 0) - 1)
    expect(after.body.totals.lessons).toBeLessThan(before.body.totals.lessons ?? 0)
    expect(after.body.totals.sentences).toBeLessThan(before.body.totals.sentences ?? 0)
  })
})

describe("软删除：练习记录保留历史", () => {
  it("句子被删后，历史练习记录仍然查得到，但标记了 sentenceDeleted", async () => {
    const admin = await makeAdmin()
    await q(
      `INSERT INTO practice_records (id, user_id, sentence_id, score, mistakes, created_at)
       VALUES (UUID(), ?, ?, 9, 1, NOW())`,
      [FIXTURE.userFree, FIXTURE.sentA1Plain],
    )
    await admin.request("DELETE", `/api/admin/sentences/${FIXTURE.sentA1Plain}`)

    const res = await admin.get<ListBody<{ sentenceDeleted?: boolean; chinese?: string }>>(
      "/api/admin/practice-records?range=all&pageSize=100",
    )
    const row = res.body.data.find((r) => r.chinese != null)
    expect(row).toBeDefined()
    // 记录是历史事实，不跟着内容消失；但要标出来，否则看起来像内容凭空丢了
    expect(row?.sentenceDeleted).toBe(true)
  })
})
