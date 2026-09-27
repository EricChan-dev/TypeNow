/**
 * 链路：后台操作审计日志
 *
 * 这个特性的整个价值就在"事后能查到"，所以测试的重点不是"接口返回 200"，
 * 而是三条容易被写坏的约定：
 *
 *   1. **成功的写操作留下恰好一条**日志，动作/对象/操作人快照都对得上；
 *   2. **被守卫拒绝的请求不留痕** —— 否则日志会被"尝试但没成功"的噪音灌满，
 *      真正改过东西的那几条淹没在里面；
 *   3. **审计写不进去也绝不能影响业务** —— 日志是旁路，它挂了后台不能跟着挂。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one, scalar } from "./helpers/db"
import { insertUser } from "./helpers/factories"

/**
 * 直连数据库读到的行（snake_case）。
 *
 * ⚠️ 接口返回的是 **camelCase**（drizzle 的行对象直接 JSON 化），两者不能混用 ——
 * 这个测试文件第一版就是把 DB 行的字段名套在接口响应上，于是
 * `r.target_type` 恒为 undefined，"筛选不生效"看起来像接口的 bug。
 */
/** 接口响应里的日志行（camelCase） */
interface AuditApiRow {
  id: string
  adminId: string | null
  adminLabel: string | null
  action: string
  targetType: string
  targetId: string | null
  targetLabel: string | null
  detail: unknown
  ip: string | null
  userAgent: string | null
  createdAt: string
}

interface AuditRow {
  id: string
  admin_id: string | null
  admin_label: string | null
  action: string
  target_type: string
  target_id: string | null
  target_label: string | null
  detail: unknown
  ip: string | null
  user_agent: string | null
  created_at: string
}

async function logs(where = "1=1", params: unknown[] = []): Promise<AuditRow[]> {
  return q<AuditRow[]>(
    `SELECT * FROM admin_audit_logs WHERE ${where} ORDER BY created_at DESC, id DESC`,
    params,
  )
}

async function countLogs(): Promise<number> {
  return Number(await scalar<number>("SELECT COUNT(*) FROM admin_audit_logs"))
}

async function makeAdmin(name = "审计管理员"): Promise<string> {
  const id = await insertUser({ name })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

/**
 * 把 detail 从库里读回来。
 *
 * mysql2 对 JSON 列的行为取决于驱动版本：可能给对象，也可能给字符串。
 * 断言前统一归一，免得测试因为驱动细节而脆。
 */
function detailOf(row: AuditRow): Record<string, unknown> {
  const d = row.detail
  if (d === null || d === undefined) return {}
  return typeof d === "string" ? JSON.parse(d) : (d as Record<string, unknown>)
}

beforeEach(async () => {
  await seedFixtures()
})

afterAll(async () => {
  // 兜底：万一"审计表不可用"那个用例在中途失败，表名必须还原，
  // 否则后续所有用例的 seedFixtures（TRUNCATE admin_audit_logs）都会报错
  await q("RENAME TABLE admin_audit_logs_broken TO admin_audit_logs").catch(() => {})
})

describe("审计日志：访问控制", () => {
  it("未登录 → 401；普通用户 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/audit-logs")).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/audit-logs")).status).toBe(401)
  })

  it("管理员可以看到列表结构（data / total / actors / applied）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{
      data: AuditApiRow[]
      total: number
      actors: unknown[]
      applied: unknown
    }>("/api/admin/audit-logs")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(typeof res.body.total).toBe("number")
    expect(Array.isArray(res.body.actors)).toBe(true)
    expect(res.body.applied).toBeTruthy()
  })
})

describe("审计日志：成功的写操作留痕", () => {
  it("新建课程 → 一条 create/course 日志，含操作人快照与来源 IP", async () => {
    const me = await makeAdmin("张三")
    const admin = ApiClient.asUser(me)

    const res = await admin.post("/api/admin/courses", {
      title: "审计测试课程",
      source: "official",
      isPublished: 0,
    })
    expect(res.status).toBe(201)
    const courseId = (res.body as { data: { id: string } }).data.id

    const rows = await logs("action = ? AND target_type = ?", ["create", "course"])
    expect(rows).toHaveLength(1)
    expect(rows[0].target_id).toBe(courseId)
    expect(rows[0].target_label).toBe("审计测试课程")
    expect(rows[0].admin_id).toBe(me)
    // 快照里是"姓名(脱敏手机号)"，不是 id —— 几个月后仍要读得懂
    expect(rows[0].admin_label).toContain("张三")
    expect(detailOf(rows[0]).title).toBe("审计测试课程")
  })

  it("**被守卫拒绝的请求不留痕**：非法 isPro 返回 400，且不产生日志", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const bad = await admin.put(`/api/admin/users/${FIXTURE.userFree}`, { isPro: 999 })
    expect(bad.status).toBe(400)
    expect(await countLogs()).toBe(0)

    // 对照：合法的同一路径会留痕（证明上面的 0 不是"这条路径根本不记日志"）
    const ok = await admin.put(`/api/admin/users/${FIXTURE.userFree}`, { level: 7 })
    expect(ok.status).toBe(200)
    expect(await countLogs()).toBe(1)
  })

  it("改用户等级 → user/update 日志里记录「从什么改成什么」", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await admin.put(`/api/admin/users/${FIXTURE.userFree}`, { level: 9 })

    const [row] = await logs("target_type = ?", ["user"])
    const d = detailOf(row)
    expect(d.level).toEqual({ from: 1, to: 9 })
    // 只记变了的那一项：没改的 role 不该出现在 detail 里（否则真改动会被淹没）
    expect(d.role).toBeUndefined()
    expect(row.target_label).toBeTruthy() // 用户快照（姓名或脱敏手机号）
  })

  it("detail 里不会出现任何 token / 密码类字段（脱敏在写入侧完成）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await admin.put(`/api/admin/users/${FIXTURE.userFree}`, { level: 3 })

    const rows = await logs()
    for (const r of rows) {
      const text = JSON.stringify(detailOf(r)).toLowerCase()
      for (const banned of ["token", "password", "openid", "secret"]) {
        expect(text, `detail 不应包含 ${banned}`).not.toContain(banned)
      }
    }
  })

  it("删除课程 → delete 日志带上级联影响面（课时/句子数）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)
    expect(res.status).toBe(200)

    const [row] = await logs("action = ?", ["delete"])
    expect(row.target_type).toBe("course")
    expect(row.target_id).toBe(FIXTURE.coursePublished)
    const d = detailOf(row)
    // 影响面必须进日志：否则事后只知道"课被删了"，不知道连带删了多少内容
    expect(d.impact).toBeTruthy()
  })

  it("从回收站恢复课程 → restore 日志", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await admin.request("DELETE", `/api/admin/courses/${FIXTURE.coursePublished}`)
    const res = await admin.request("PATCH", `/api/admin/courses/${FIXTURE.coursePublished}`)
    expect(res.status).toBe(200)

    const [row] = await logs("action = ?", ["restore"])
    expect(row.target_id).toBe(FIXTURE.coursePublished)
    expect(row.target_type).toBe("course")
  })

  it("重排句子顺序 → reorder 日志记「哪一课的多少句」，且用课时标题而不是裸 UUID", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const ids = (
      await q<Array<{ id: string }>>(
        "SELECT id FROM sentences WHERE lesson_id = ? AND deleted_at IS NULL ORDER BY sort_order",
        [FIXTURE.lessonA1],
      )
    ).map((r) => r.id)
    expect(ids.length).toBeGreaterThan(1)

    const res = await admin.put(`/api/admin/lessons/${FIXTURE.lessonA1}/sentences/reorder`, {
      orderedIds: [...ids].reverse(),
    })
    expect(res.status).toBe(200)

    const [row] = await logs("action = ?", ["reorder"])
    expect(row.target_type).toBe("lesson")
    expect(row.target_id).toBe(FIXTURE.lessonA1)
    expect(detailOf(row).count).toBe(ids.length)
    // 有意不记完整顺序（见路由注释），但标签要是人读得懂的标题
    expect(row.target_label).not.toBe(FIXTURE.lessonA1)
  })

  it("句子编辑 → sentence/update，标签是中文原文而不是 id", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const [s] = await q<Array<{ id: string; chinese: string; english: string; lesson_id: string }>>(
      "SELECT id, chinese, english, lesson_id FROM sentences WHERE lesson_id = ? ORDER BY sort_order LIMIT 1",
      [FIXTURE.lessonA1],
    )
    const res = await admin.put(`/api/admin/sentences/${s.id}`, {
      chinese: `${s.chinese}（改过）`,
      english: s.english,
      lessonId: s.lesson_id,
    })
    expect(res.status).toBe(200)

    const [row] = await logs("action = ? AND target_type = ?", ["update", "sentence"])
    expect(row.target_id).toBe(s.id)
    expect(row.target_label).toContain(s.chinese)
    expect(detailOf(row).chinese).toEqual({ from: s.chinese, to: `${s.chinese}（改过）` })
  })
})

describe("审计日志：筛选", () => {
  async function seedThreeActions() {
    const me = await makeAdmin("筛选管理员")
    const admin = ApiClient.asUser(me)
    await admin.post("/api/admin/courses", { title: "筛选课程", source: "official", isPublished: 0 })
    await admin.put(`/api/admin/users/${FIXTURE.userFree}`, { level: 4 })
    await admin.put(`/api/admin/sentences/${(await q<Array<{ id: string }>>(
      "SELECT id FROM sentences WHERE lesson_id = ? LIMIT 1",
      [FIXTURE.lessonA1],
    ))[0].id}`, { chinese: "筛选句子" })
    return me
  }

  it("按动作筛", async () => {
    await seedThreeActions()
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ data: AuditApiRow[]; total: number }>(
      "/api/admin/audit-logs?action=create",
    )
    expect(res.body.total).toBe(1)
    expect(res.body.data.every((r) => r.action === "create")).toBe(true)
  })

  it("按对象类型筛", async () => {
    await seedThreeActions()
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ data: AuditApiRow[]; total: number }>(
      "/api/admin/audit-logs?targetType=user",
    )
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].targetType).toBe("user")
  })

  it("按操作人筛（并且 actors 下拉里能出现这个人）", async () => {
    const me = await seedThreeActions()
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{
      data: AuditApiRow[]
      total: number
      actors: Array<{ id: string; label: string }>
    }>(`/api/admin/audit-logs?adminId=${me}`)
    expect(res.body.total).toBe(3)
    expect(res.body.data.every((r) => r.adminId === me)).toBe(true)
    expect(res.body.actors.some((a) => a.id === me)).toBe(true)
  })

  it("按关键词搜对象名称 / 操作人快照", async () => {
    await seedThreeActions()
    const admin = ApiClient.asUser(await makeAdmin())

    const byTarget = await admin.get<{ total: number }>("/api/admin/audit-logs?q=筛选课程")
    expect(byTarget.body.total).toBe(1)

    const byActor = await admin.get<{ total: number }>(
      `/api/admin/audit-logs?q=${encodeURIComponent("筛选管理员")}`,
    )
    expect(byActor.body.total).toBe(3)
  })

  it("非法的 action / targetType 被忽略（旧书签不该看到报错页），而不是 400", async () => {
    await seedThreeActions()
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ total: number }>(
      "/api/admin/audit-logs?action=不存在的动作&targetType=不存在的对象",
    )
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(3) // 筛选被忽略 → 全部
  })

  it("range=week 只返回近一周的日志", async () => {
    const me = await seedThreeActions()
    // 手工插一条 40 天前的日志（近一周应当排除它）
    await q(
      `INSERT INTO admin_audit_logs (id, admin_id, admin_label, action, target_type, target_label, created_at)
       VALUES (UUID(), ?, '旧管理员', 'update', 'course', '很久以前', DATE_SUB(NOW(), INTERVAL 40 DAY))`,
      [me],
    )
    const admin = ApiClient.asUser(await makeAdmin())
    const week = await admin.get<{ total: number }>("/api/admin/audit-logs?range=week")
    const all = await admin.get<{ total: number }>("/api/admin/audit-logs?range=all")
    expect(week.body.total).toBe(3)
    expect(all.body.total).toBe(4)
  })

  it("分页的 total 是筛选后的总数，不受 pageSize 影响", async () => {
    await seedThreeActions()
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ data: AuditApiRow[]; total: number }>(
      "/api/admin/audit-logs?pageSize=1&range=all",
    )
    expect(res.body.data).toHaveLength(1)
    expect(res.body.total).toBe(3)
  })
})

describe("审计日志：可用性兜底", () => {
  it("**审计表不可用时业务照常成功**（日志是旁路，不能反过来拖垮后台）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())

    // 模拟"迁移没执行 / 表被锁 / 表被误删"：把表挪走，让 INSERT 必然失败
    await q("RENAME TABLE admin_audit_logs TO admin_audit_logs_broken")
    try {
      const res = await admin.post("/api/admin/courses", {
        title: "表不可用时的课程",
        source: "official",
        isPublished: 0,
      })
      // 这条是重点：审计写失败**不能**把 201 变成 500
      expect(res.status).toBe(201)

      // 业务数据确实写进去了（不是"失败了但返回 201"）
      const created = await one<{ title: string }>(
        "SELECT title FROM courses WHERE title = ?",
        ["表不可用时的课程"],
      )
      expect(created?.title).toBe("表不可用时的课程")
    } finally {
      await q("RENAME TABLE admin_audit_logs_broken TO admin_audit_logs")
    }

    expect(await countLogs()).toBe(0)
  })
})
