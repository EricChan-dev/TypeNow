/**
 * 后台「AI 对话日志」接口（/api/admin/ai-chats）。
 *
 * 这张表的意义是把 AI 对话从"完全查不到"变成"能查"：谁问了什么、AI 答了什么、
 * 失败多不多、谁在走免费额度。所以测试的重点是**筛选口径与汇总要跟筛选一致**
 * （只看一张流水表很难看出异常，带上分母才看得出），以及**手机号必须脱敏**。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"
import { insertUser, nextPhone } from "./helpers/factories"

interface AiChatRow {
  id: string
  userId: string
  userName: string | null
  userPhone: string | null
  question: string
  answer: string | null
  status: "ok" | "error"
  usedFreeQuota: number
  diamondsCost: number
  latencyMs: number | null
}
interface AiChatResp {
  data: AiChatRow[]
  total: number
  summary: { total: number; errors: number; freeQuota: number; diamonds: number; avgLatency: number | null }
  applied: { q: string; status: string | null; range: string | null; rangeLabel: string | null }
}

async function makeAdmin(name = "对话审计管理员"): Promise<string> {
  const id = await insertUser({ name })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

/** 造一条对话日志；createdAt 缺省为此刻 */
async function insertLog(opts: {
  userId: string
  question: string
  answer?: string | null
  status?: "ok" | "error"
  usedFreeQuota?: number
  diamondsCost?: number
  latencyMs?: number | null
  createdAt?: string
}): Promise<string> {
  const id = crypto.randomUUID()
  await q(
    `INSERT INTO ai_chat_logs
       (id, user_id, question, answer, model, history_count, diamonds_cost, used_free_quota, status, error_message, latency_ms, created_at)
     VALUES (?, ?, ?, ?, 'deepseek-chat', 0, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.userId,
      opts.question,
      // 注意不能写 `opts.answer ?? 默认值`：那样显式的 null（失败无回答）会被兜底成有回答
      opts.answer === undefined ? "这是 AI 的回答" : opts.answer,
      opts.diamondsCost ?? 0,
      opts.usedFreeQuota ?? 0,
      opts.status ?? "ok",
      opts.status === "error" ? "AI 服务返回 500" : null,
      opts.latencyMs === undefined ? 1200 : opts.latencyMs,
      opts.createdAt ?? new Date(),
    ],
  )
  return id
}

beforeEach(async () => {
  await seedFixtures()
})

describe("AI 对话日志：权限", () => {
  it("未登录 → 401；普通用户 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/ai-chats")).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/ai-chats")).status).toBe(401)
  })
})

describe("AI 对话日志：列表与脱敏", () => {
  it("返回 data / total / summary / applied，且手机号脱敏", async () => {
    const phone = nextPhone()
    const user = await insertUser({ name: "爱提问的用户", phone })
    await insertLog({ userId: user, question: "这句话为什么用现在完成时？" })

    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<AiChatResp>("/api/admin/ai-chats")
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.applied).toBeTruthy()
    expect(res.body.summary.total).toBe(1)

    const row = res.body.data[0]
    expect(row.userName).toBe("爱提问的用户")
    // 与其它后台列表一致：手机号只出中间脱敏形式，不能明文回传
    expect(row.userPhone).not.toBe(phone)
    expect(row.userPhone).toContain("*")
  })
})

describe("AI 对话日志：筛选", () => {
  it("按状态筛：失败记录单独可查", async () => {
    const user = await insertUser({ name: "失败用户" })
    await insertLog({ userId: user, question: "正常的一问" })
    await insertLog({ userId: user, question: "失败的一问", status: "error", answer: null })

    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<AiChatResp>("/api/admin/ai-chats?status=error")
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].question).toBe("失败的一问")
    expect(res.body.data[0].answer).toBeNull()
    // 汇总必须跟着筛选走，否则"失败 1 条 / 总数 2"会自相矛盾
    expect(res.body.summary.total).toBe(1)
    expect(res.body.summary.errors).toBe(1)
  })

  it("关键词同时匹配提问内容与用户名", async () => {
    const a = await insertUser({ name: "小王" })
    const b = await insertUser({ name: "小李" })
    await insertLog({ userId: a, question: "虚拟语气怎么用" })
    await insertLog({ userId: b, question: "这个词的搭配" })

    const admin = ApiClient.asUser(await makeAdmin())
    // 中文关键词必须编码：前端走 URLSearchParams 会自动编码，测试里要显式做，
    // 否则请求根本发不出去（body 为 null）
    const byContent = await admin.get<AiChatResp>(
      `/api/admin/ai-chats?q=${encodeURIComponent("虚拟语气")}`,
    )
    expect(byContent.body.total).toBe(1)
    expect(byContent.body.data[0].userName).toBe("小王")

    const byName = await admin.get<AiChatResp>(`/api/admin/ai-chats?q=${encodeURIComponent("小李")}`)
    expect(byName.body.total).toBe(1)
    expect(byName.body.data[0].userName).toBe("小李")
  })

  it("时间范围生效：近一周不包含 40 天前的记录", async () => {
    const user = await insertUser({ name: "老记录用户" })
    const old = new Date(Date.now() - 40 * 86400_000)
    const pad = (n: number) => String(n).padStart(2, "0")
    const oldStr = `${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())} ${pad(old.getHours())}:${pad(old.getMinutes())}:00`
    await insertLog({ userId: user, question: "很久以前问的", createdAt: oldStr })
    await insertLog({ userId: user, question: "刚刚问的" })

    const admin = ApiClient.asUser(await makeAdmin())
    const week = await admin.get<AiChatResp>("/api/admin/ai-chats?range=week")
    expect(week.body.total).toBe(1)
    expect(week.body.data[0].question).toBe("刚刚问的")

    const all = await admin.get<AiChatResp>("/api/admin/ai-chats?range=all")
    expect(all.body.total).toBe(2)
  })
})

describe("AI 对话日志：汇总口径", () => {
  it("区分免费额度与钻石消耗，并给出平均耗时", async () => {
    const user = await insertUser({ name: "混合消耗用户" })
    await insertLog({ userId: user, question: "走免费额度", usedFreeQuota: 1, diamondsCost: 0, latencyMs: 1000 })
    await insertLog({ userId: user, question: "花钻石", diamondsCost: 5, latencyMs: 3000 })

    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<AiChatResp>("/api/admin/ai-chats?range=all")
    expect(res.body.summary.total).toBe(2)
    expect(res.body.summary.freeQuota).toBe(1)
    expect(res.body.summary.diamonds).toBe(5)
    expect(res.body.summary.avgLatency).toBe(2000)
  })
})

describe("AI 对话日志：只读", () => {
  it("没有删除/清理入口（能让管理员删掉的审计日志不算审计）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    // 路由只导出 GET
    const res = await admin.request("DELETE", "/api/admin/ai-chats")
    expect([404, 405]).toContain(res.status)
  })
})
