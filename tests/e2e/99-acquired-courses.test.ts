/**
 * 链路：课程「获取」状态服务端化
 *
 * 修的是一个用户实际遇到的问题：我的课程列表里点进一门课，详情页却显示
 * 「获取课程」。根因是"已获取"只存在浏览器 localStorage，而列表是按
 * `已获取 ∪ 已练习过` 算的 —— 清一次浏览器数据后，课程因"练过"仍在列表里，
 * 详情页读到的却是空 localStorage。
 *
 * 所以这里断言的核心是：**获取状态能跨"清缓存"存在**（即它真的落到了服务端），
 * 以及接口的幂等性（重复点击/多标签页不该产生第二行或报错）。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"

async function countRows(userId: string, courseId: string): Promise<number> {
  const row = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM user_acquired_courses WHERE user_id = ? AND course_id = ?",
    [userId, courseId],
  )
  return Number(row?.n ?? 0)
}

beforeEach(async () => {
  await seedFixtures()
})

describe("获取课程 /api/user/acquired-courses", () => {
  it("未登录 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/user/acquired-courses")).status).toBe(401)
    const post = await ApiClient.anonymous().request("POST", "/api/user/acquired-courses", {
      json: { courseId: FIXTURE.coursePublished },
    })
    expect(post.status).toBe(401)
  })

  it("获取后能在服务端读到（这是清缓存也不丢的依据）", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    const post = await api.request("POST", "/api/user/acquired-courses", {
      json: { courseId: FIXTURE.coursePublished },
    })
    expect(post.status).toBe(200)

    // 直接查库：确认不是只写进了别处
    expect(await countRows(FIXTURE.userFree, FIXTURE.coursePublished)).toBe(1)

    const list = await api.get<{ ids: string[] }>("/api/user/acquired-courses")
    expect(list.body.ids).toContain(FIXTURE.coursePublished)
  })

  it("**幂等**：重复获取同一门课不会报错、也不会产生第二行", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    for (let i = 0; i < 3; i++) {
      const res = await api.request("POST", "/api/user/acquired-courses", {
        json: { courseId: FIXTURE.coursePublished },
      })
      expect(res.status).toBe(200)
    }
    // 重复点击 / 多标签页同时提交都会走到这里，唯一键兜底
    expect(await countRows(FIXTURE.userFree, FIXTURE.coursePublished)).toBe(1)
  })

  it("只返回自己的课程（不能串号）", async () => {
    await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/user/acquired-courses", {
      json: { courseId: FIXTURE.coursePublished },
    })
    const other = await ApiClient.asUser(FIXTURE.userPro).get<{ ids: string[] }>(
      "/api/user/acquired-courses",
    )
    expect(other.body.ids).not.toContain(FIXTURE.coursePublished)
  })

  it("缺 courseId / 非法 body → 400", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    expect(
      (await api.request("POST", "/api/user/acquired-courses", { json: {} })).status,
    ).toBe(400)
    expect(
      (await api.request("POST", "/api/user/acquired-courses", { json: { courseId: "" } })).status,
    ).toBe(400)
    expect(
      (await api.request("POST", "/api/user/acquired-courses", { json: { courseId: 123 } })).status,
    ).toBe(400)
  })

  it("课程被软删除后，已获取记录仍在（获取是用户侧的事实，不跟着内容走）", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    await api.request("POST", "/api/user/acquired-courses", {
      json: { courseId: FIXTURE.coursePublished },
    })

    const adminId = crypto.randomUUID()
    await q(
      `INSERT INTO users (id, phone, name, is_pro, role, created_at)
       VALUES (?, ?, 'e2e 删除管理员', 0, 'admin', NOW())`,
      [adminId, `137${Date.now().toString().slice(-8)}`],
    )
    const del = await ApiClient.asUser(adminId).request(
      "DELETE",
      `/api/admin/courses/${FIXTURE.coursePublished}`,
    )
    expect(del.status).toBe(200)

    // 记录本身不消失；列表页会自然过滤掉已删除的课程
    expect(await countRows(FIXTURE.userFree, FIXTURE.coursePublished)).toBe(1)
  })
})
