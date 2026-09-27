/**
 * 链路：用户反馈 → 后台处理
 *
 * 这条链路此前**断在中间**：反馈能提交、能落库、会推微信客服消息，但后台没有任何
 * 读取入口 —— 线上实测积了 8 条没人看过。所以这里不只测接口能返回数据，
 * 更测「闭环」本身：
 *
 *   提交（带来源） → 后台能按状态/分类筛出来 → 能标记处理 → 状态真的变了
 *   且「未结束」的计数口径与仪表盘一致（否则卡片数字和列表条数对不上）
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser } from "./helpers/factories"

async function makeAdmin(): Promise<ApiClient> {
  const id = await insertUser({ name: "e2e 反馈管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return ApiClient.asUser(id)
}

interface FeedbackRow {
  id: string
  userId: string
  category: string
  source: string
  status: string
  content: string
  adminNote: string | null
  handledBy?: string | null
  handledAt?: string | null
  createdAt: string
  userName?: string | null
  userPhone?: string | null
}

interface ListBody {
  data: FeedbackRow[]
  total: number
  summary: { byStatus: Record<string, number>; unfinished: number }
}

/** 直接插一条反馈（绕过提交接口，便于构造各种状态）。 */
async function insertFeedback(opts: {
  userId: string
  content: string
  category?: "bug" | "feature" | "suggestion" | "other"
  source?: string
  status?: "open" | "in_progress" | "resolved" | "ignored"
  createdAt?: Date
}): Promise<string> {
  const id = crypto.randomUUID()
  await q(
    `INSERT INTO user_feedback (id, user_id, category, content, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.userId,
      opts.category ?? "suggestion",
      opts.content,
      opts.source ?? "portal",
      opts.status ?? "open",
      opts.createdAt ?? new Date(),
    ],
  )
  return id
}

beforeEach(async () => {
  await seedFixtures()
})

describe("提交：来源被正确记录", () => {
  it("门户端提交 → source=portal", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/feedback", {
      json: { category: "bug", content: "门户端的问题", source: "portal" },
    })
    expect(res.status).toBe(200)

    const row = await one<{ source: string; category: string; status: string }>(
      "SELECT source, category, status FROM user_feedback ORDER BY created_at DESC LIMIT 1",
    )
    expect(row?.source).toBe("portal")
    expect(row?.category).toBe("bug")
    // 新提交的默认就是待处理
    expect(row?.status).toBe("open")
  })

  it("学习中心提交 → source=learning", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/feedback", {
      json: { category: "feature", content: "学习中心的问题", source: "learning" },
    })
    expect(res.status).toBe(200)
    const row = await one<{ source: string }>(
      "SELECT source FROM user_feedback ORDER BY created_at DESC LIMIT 1",
    )
    expect(row?.source).toBe("learning")
  })

  it("非法来源回落 unknown，但**不阻断提交**（来源只用于展示）", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/feedback", {
      json: { category: "other", content: "来源乱写", source: "hacker" },
    })
    expect(res.status).toBe(200)
    const row = await one<{ source: string; content: string }>(
      "SELECT source, content FROM user_feedback ORDER BY created_at DESC LIMIT 1",
    )
    expect(row?.source).toBe("unknown")
    expect(row?.content).toBe("来源乱写")
  })

  it("非法分类回落 other，不阻断提交", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/feedback", {
      json: { category: "not-a-category", content: "分类乱写" },
    })
    expect(res.status).toBe(200)
    const row = await one<{ category: string }>(
      "SELECT category FROM user_feedback ORDER BY created_at DESC LIMIT 1",
    )
    expect(row?.category).toBe("other")
  })

  it("未登录 / 空内容仍然被拒（回归：不要因为加了 source 就放宽校验）", async () => {
    const anon = await ApiClient.anonymous().request("POST", "/api/feedback", {
      json: { content: "x", source: "portal" },
    })
    expect(anon.status).toBe(401)

    const empty = await ApiClient.asUser(FIXTURE.userFree).request("POST", "/api/feedback", {
      json: { content: "   ", source: "portal" },
    })
    expect(empty.status).toBe(400)
  })
})

describe("后台列表 /api/admin/feedback", () => {
  it("未登录 → 401；非管理员 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/feedback")).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/feedback")).status).toBe(401)
  })

  it("返回反馈内容与提交人（带出用户名，手机号脱敏）", async () => {
    const admin = await makeAdmin()
    const uid = await insertUser({ name: "反馈的人", phone: "13700009999" })
    await insertFeedback({ userId: uid, content: "按钮点不动" })

    const res = await admin.get<ListBody>("/api/admin/feedback?pageSize=50")
    const row = res.body.data.find((r) => r.content === "按钮点不动")
    expect(row).toBeDefined()
    expect(row?.userName).toBe("反馈的人")
    expect(row?.userPhone).toBe("137****9999")
    expect(row?.userId).toBe(uid)
  })

  it("按状态筛（含 unfinished 聚合档）", async () => {
    const admin = await makeAdmin()
    await insertFeedback({ userId: FIXTURE.userFree, content: "待处理A", status: "open" })
    await insertFeedback({ userId: FIXTURE.userFree, content: "处理中B", status: "in_progress" })
    await insertFeedback({ userId: FIXTURE.userFree, content: "已解决C", status: "resolved" })

    const open = await admin.get<ListBody>("/api/admin/feedback?status=open&pageSize=50")
    expect(open.body.data.every((r) => r.status === "open")).toBe(true)

    const done = await admin.get<ListBody>("/api/admin/feedback?status=resolved&pageSize=50")
    expect(done.body.data.map((r) => r.content)).toContain("已解决C")
    expect(done.body.data.map((r) => r.content)).not.toContain("待处理A")

    // unfinished = 待处理 + 处理中：两者都是"没做完"
    const unfinished = await admin.get<ListBody>("/api/admin/feedback?status=unfinished&pageSize=50")
    const contents = unfinished.body.data.map((r) => r.content)
    expect(contents).toContain("待处理A")
    expect(contents).toContain("处理中B")
    expect(contents).not.toContain("已解决C")
  })

  it("按分类筛", async () => {
    const admin = await makeAdmin()
    await insertFeedback({ userId: FIXTURE.userFree, content: "一个 bug", category: "bug" })
    await insertFeedback({ userId: FIXTURE.userFree, content: "一个建议", category: "feature" })

    const res = await admin.get<ListBody>("/api/admin/feedback?category=bug&pageSize=50")
    expect(res.body.data.map((r) => r.content)).toContain("一个 bug")
    expect(res.body.data.map((r) => r.content)).not.toContain("一个建议")
  })

  it("关键词能搜内容、昵称与手机号（运营拿到原话时想知道是谁提的）", async () => {
    const admin = await makeAdmin()
    const uid = await insertUser({ name: "关键词昵称", phone: "13612345678" })
    await insertFeedback({ userId: uid, content: "独一无二的反馈内容" })

    const byContent = await admin.get<ListBody>(
      `/api/admin/feedback?q=${encodeURIComponent("独一无二的反馈内容")}&pageSize=50`,
    )
    expect(byContent.body.total).toBe(1)

    const byName = await admin.get<ListBody>(
      `/api/admin/feedback?q=${encodeURIComponent("关键词昵称")}&pageSize=50`,
    )
    expect(byName.body.total).toBe(1)

    const byPhone = await admin.get<ListBody>("/api/admin/feedback?q=13612345678&pageSize=50")
    expect(byPhone.body.total).toBe(1)
  })

  it("summary 的各档条数不随筛选变化（要能随时回答还剩多少没处理）", async () => {
    const admin = await makeAdmin()
    await insertFeedback({ userId: FIXTURE.userFree, content: "待处理1", status: "open" })
    await insertFeedback({ userId: FIXTURE.userFree, content: "待处理2", status: "open" })
    await insertFeedback({ userId: FIXTURE.userFree, content: "已解决1", status: "resolved" })

    const all = await admin.get<ListBody>("/api/admin/feedback?pageSize=50")
    expect(all.body.summary.byStatus.open).toBe(2)
    expect(all.body.summary.byStatus.resolved).toBe(1)
    expect(all.body.summary.unfinished).toBe(2)

    // 切到"已解决"档时，待处理计数**必须还是 2** ——
    // 跟着筛选走的话就会显示 0，那是错的
    const resolvedOnly = await admin.get<ListBody>(
      "/api/admin/feedback?status=resolved&pageSize=50",
    )
    expect(resolvedOnly.body.summary.byStatus.open).toBe(2)
    expect(resolvedOnly.body.summary.unfinished).toBe(2)
  })

  it("时间范围筛选生效", async () => {
    const admin = await makeAdmin()
    await insertFeedback({
      userId: FIXTURE.userFree,
      content: "很久以前",
      createdAt: new Date(Date.now() - 90 * 86400_000),
    })
    await insertFeedback({ userId: FIXTURE.userFree, content: "刚刚" })

    const week = await admin.get<ListBody>("/api/admin/feedback?range=week&pageSize=50")
    const contents = week.body.data.map((r) => r.content)
    expect(contents).toContain("刚刚")
    expect(contents).not.toContain("很久以前")
  })

  it("分页参数非法时回落", async () => {
    const admin = await makeAdmin()
    await insertFeedback({ userId: FIXTURE.userFree, content: "x" })
    const res = await admin.get<ListBody>("/api/admin/feedback?pageSize=abc")
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeLessThanOrEqual(20)
  })

  it("deleted=only 返回空而不是把全部反馈漏出来（反馈表没有软删除列）", async () => {
    const admin = await makeAdmin()
    await insertFeedback({ userId: FIXTURE.userFree, content: "不该出现在回收站视图里" })
    const res = await admin.get<ListBody>("/api/admin/feedback?deleted=only&pageSize=50")
    expect(res.body.total).toBe(0)
    expect(res.body.data).toEqual([])
  })
})

describe("后台处理 /api/admin/feedback/[id]", () => {
  it("未登录 → 401", async () => {
    const id = await insertFeedback({ userId: FIXTURE.userFree, content: "x" })
    const res = await ApiClient.anonymous().request("PATCH", `/api/admin/feedback/${id}`, {
      json: { status: "resolved" },
    })
    expect(res.status).toBe(401)
  })

  it("标记已解决 → 状态变更并记录处理人与时间", async () => {
    const admin = await makeAdmin()
    const id = await insertFeedback({ userId: FIXTURE.userFree, content: "处理我" })

    const res = await admin.request("PATCH", `/api/admin/feedback/${id}`, {
      json: { status: "resolved", adminNote: "已修复，下版生效" },
    })
    expect(res.status).toBe(200)

    const row = await one<{ status: string; handled_by: string | null; handled_at: string | null; admin_note: string | null }>(
      "SELECT status, handled_by, handled_at, admin_note FROM user_feedback WHERE id = ?",
      [id],
    )
    expect(row?.status).toBe("resolved")
    expect(row?.handled_by).toBeTruthy()
    expect(row?.handled_at).toBeTruthy()
    expect(row?.admin_note).toBe("已修复，下版生效")
  })

  it("只改备注时**不刷新**处理时间（否则看不出真实的处理节奏）", async () => {
    const admin = await makeAdmin()
    const id = await insertFeedback({ userId: FIXTURE.userFree, content: "先解决再改备注" })

    await admin.request("PATCH", `/api/admin/feedback/${id}`, { json: { status: "resolved" } })
    const first = await one<{ handled_at: string }>(
      "SELECT handled_at FROM user_feedback WHERE id = ?",
      [id],
    )

    await new Promise((r) => setTimeout(r, 1100))
    await admin.request("PATCH", `/api/admin/feedback/${id}`, {
      json: { adminNote: "补充一句备注" },
    })
    const second = await one<{ handled_at: string; admin_note: string }>(
      "SELECT handled_at, admin_note FROM user_feedback WHERE id = ?",
      [id],
    )

    expect(second?.admin_note).toBe("补充一句备注")
    expect(new Date(second!.handled_at).getTime()).toBe(new Date(first!.handled_at).getTime())
  })

  it("退回待处理 → 清空处理痕迹（这次处理不算数）", async () => {
    const admin = await makeAdmin()
    const id = await insertFeedback({ userId: FIXTURE.userFree, content: "先解决再退回" })
    await admin.request("PATCH", `/api/admin/feedback/${id}`, { json: { status: "resolved" } })

    const res = await admin.request("PATCH", `/api/admin/feedback/${id}`, {
      json: { status: "open" },
    })
    expect(res.status).toBe(200)

    const row = await one<{ status: string; handled_by: string | null; handled_at: string | null }>(
      "SELECT status, handled_by, handled_at FROM user_feedback WHERE id = ?",
      [id],
    )
    expect(row?.status).toBe("open")
    expect(row?.handled_by).toBeNull()
    expect(row?.handled_at).toBeNull()
  })

  it("非法状态 / 超长备注 → 400", async () => {
    const admin = await makeAdmin()
    const id = await insertFeedback({ userId: FIXTURE.userFree, content: "x" })

    const badStatus = await admin.request("PATCH", `/api/admin/feedback/${id}`, {
      json: { status: "done" },
    })
    expect(badStatus.status).toBe(400)

    const longNote = await admin.request("PATCH", `/api/admin/feedback/${id}`, {
      json: { adminNote: "x".repeat(501) },
    })
    expect(longNote.status).toBe(400)
  })

  it("什么都不传 → 400（不能假装更新成功）", async () => {
    const admin = await makeAdmin()
    const id = await insertFeedback({ userId: FIXTURE.userFree, content: "x" })
    const res = await admin.request("PATCH", `/api/admin/feedback/${id}`, { json: {} })
    expect(res.status).toBe(400)
  })

  it("不存在的 id → 404", async () => {
    const admin = await makeAdmin()
    const res = await admin.request(
      "PATCH",
      "/api/admin/feedback/00000000-0000-4000-8000-000000000000",
      { json: { status: "resolved" } },
    )
    expect(res.status).toBe(404)
  })
})

describe("仪表盘的「待处理反馈」与列表口径一致", () => {
  it("仪表盘数字 == 反馈页 unfinished 的条数", async () => {
    const admin = await makeAdmin()
    await insertFeedback({ userId: FIXTURE.userFree, content: "A", status: "open" })
    await insertFeedback({ userId: FIXTURE.userFree, content: "B", status: "in_progress" })
    await insertFeedback({ userId: FIXTURE.userFree, content: "C", status: "resolved" })

    const dash = await admin.get<{ pendingFeedback: number }>("/api/admin/dashboard?range=all")
    const list = await admin.get<ListBody>("/api/admin/feedback?status=unfinished&pageSize=50")

    expect(dash.body.pendingFeedback).toBe(2)
    // 卡片数字与点进去看到的条数必须相等，否则使用者以为报表算错了
    expect(list.body.total).toBe(dash.body.pendingFeedback)
  })

  it("处理掉一条之后两边一起减", async () => {
    const admin = await makeAdmin()
    const id = await insertFeedback({ userId: FIXTURE.userFree, content: "待处理", status: "open" })

    const before = await admin.get<{ pendingFeedback: number }>("/api/admin/dashboard?range=all")
    await admin.request("PATCH", `/api/admin/feedback/${id}`, { json: { status: "resolved" } })
    const after = await admin.get<{ pendingFeedback: number }>("/api/admin/dashboard?range=all")

    expect(after.body.pendingFeedback).toBe(before.body.pendingFeedback - 1)
  })
})
