/**
 * TypeNow · 新用户完整流程自检（self-check）
 *
 * 为什么需要它：`/api/practice/record` 曾经 404 了整整一个季度，19 个真实用户
 * 全部停在「0 分 / 1 级」，却没有任何监控发现。这个脚本把「一个真人从注册到
 * 看到自己分数变化」的整条链路变成可重复执行的断言，用来回答一个问题：
 *   **修复真的闭环了吗？**
 *
 * 用法：
 *   pnpm selfcheck:new-user                      # 默认打 https://typenow.cn
 *   pnpm selfcheck:new-user -- --base=http://localhost:3000
 *   pnpm selfcheck:new-user -- --dry-run         # 只做连通性预检，不写任何数据
 *   pnpm selfcheck:new-user -- --keep            # 保留测试数据以便排查（会打印清理 SQL）
 *
 * 行为约定：
 *   - 创建一个名字为 e2e_selftest_<时间戳> 的**测试**用户，用完在 finally 里删干净；
 *   - 所有写入只作用于该测试用户的 userId，删除前会二次校验 openid 前缀；
 *   - 任何断言失败都不会中断后续断言，最后汇总并以退出码 1 结束（可用于 CI）。
 *
 * 注意：它会向 DATABASE_URL 指向的库写少量临时数据。请确认它指向的是预期环境。
 */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { createConnection } from "mysql2/promise"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

// ─── 参数 ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const hasFlag = (n: string) => argv.includes(`--${n}`)
const readOpt = (n: string, fallback: string) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : fallback
}

const BASE = readOpt("base", process.env.SELFCHECK_BASE_URL || "https://typenow.cn").replace(/\/+$/, "")
const DRY_RUN = hasFlag("dry-run")
const KEEP = hasFlag("keep")
const TIMEOUT_MS = Number(readOpt("timeout", "20000"))

// ─── 断言框架 ────────────────────────────────────────────────────────────────

interface Result {
  section: string
  name: string
  ok: boolean
  detail: string
}

const results: Result[] = []
let currentSection = ""

function section(title: string) {
  currentSection = title
  console.log(`\n${title}`)
}

function check(name: string, ok: boolean, detail = "") {
  results.push({ section: currentSection, name, ok, detail })
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`)
  return ok
}

/** 断言「实际值 === 期望值」，失败时把两者都打出来。 */
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  return check(name, ok, ok ? `= ${String(actual)}` : `期望 ${String(expected)}，实际 ${String(actual)}`)
}

/** 断言「实际值 > 下界」。 */
function gt(name: string, actual: number, lower: number) {
  const ok = Number(actual) > lower
  return check(name, ok, ok ? `= ${actual}` : `期望 > ${lower}，实际 ${actual}`)
}

/**
 * 已知缺口 / 需要人决策的观察。不计入失败、不影响退出码，
 * 但会在结尾单独列出 —— 否则这种「当前就这样」的问题最容易在一次次自检里被忽略。
 */
interface Warning {
  section: string
  name: string
  detail: string
}
const warnings: Warning[] = []

function warn(name: string, detail: string) {
  warnings.push({ section: currentSection, name, detail })
  console.log(`  ! ${name}  — ${detail}`)
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

interface Resp {
  status: number
  json: Record<string, unknown> | null
  /** 完整响应体。HTML 页面也保留，因为付费墙跳转只体现在 body 里。 */
  text: string
  /** 只用于报错展示的短片段 */
  snippet: string
  location: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(
  method: "GET" | "POST",
  pathname: string,
  opts: { cookie?: string; body?: unknown } = {},
): Promise<Resp> {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const text = (await res.text().catch(() => "")).slice(0, 400_000)
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* HTML 页面或空响应，保持 null */
  }
  return {
    status: res.status,
    json,
    text,
    snippet: text.replace(/\s+/g, " ").slice(0, 200),
    location: res.headers.get("location"),
  }
}

// ─── 数据库 ──────────────────────────────────────────────────────────────────

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = path.join(ROOT, ".env.local")
  if (!fs.existsSync(envPath)) {
    throw new Error("未找到 DATABASE_URL，且 .env.local 不存在。请设置 DATABASE_URL 环境变量。")
  }
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith("DATABASE_URL="))
  if (!line) throw new Error(".env.local 中没有 DATABASE_URL")
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")
}

/** 清理时按 userId 逐表删除；表不存在或列名不符只会告警，不会中断清理。 */
const USER_SCOPED_TABLES = [
  "practice_records",
  "review_queue",
  "diamond_logs",
  "sessions",
  "user_course_progress",
  "check_ins",
  "task_logs",
  "analytics_events",
  "wordbook_items",
  "user_notes",
  "user_feedback",
  "payment_orders",
  "subscriptions",
  "strengthen_sessions",
  "writing_entries",
]

const TAG = `e2e_selftest_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`
const userId = crypto.randomUUID()
const sessionId = crypto.randomUUID()
const cookie = `typenow_session=${sessionId}`

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TypeNow 新用户完整流程自检 ===")
  console.log(`目标      : ${BASE}`)
  console.log(`测试账号  : ${TAG}`)
  console.log(`用户 ID   : ${userId}`)
  if (DRY_RUN) console.log("模式      : dry-run（只做预检，不写数据）")

  const dbUrl = loadDatabaseUrl()
  const host = (() => {
    try {
      return new URL(dbUrl).host
    } catch {
      return "(无法解析)"
    }
  })()
  console.log(`数据库    : ${host}`)
  if (DRY_RUN) console.log("注意      : dry-run 仍要求能连通数据库")

  const conn = await createConnection(dbUrl)
  const q = async (sql: string, params?: unknown[]) => {
    const [rows] = await conn.query(sql, params)
    return rows as Record<string, unknown>[]
  }

  let created = false

  const cleanup = async () => {
    if (!created || KEEP) return
    console.log("\n--- 清理测试数据 ---")
    // 二次校验：确认要删的确实是本脚本创建的测试账号
    const [row] = await q("SELECT wechat_openid FROM users WHERE id = ?", [userId])
    if (!row || !String(row.wechat_openid ?? "").startsWith("e2e_selftest_")) {
      console.log("  ⚠ 用户不存在或前缀不符，跳过清理（未做任何删除）")
      return
    }
    for (const t of USER_SCOPED_TABLES) {
      try {
        const r = await q(`DELETE FROM \`${t}\` WHERE user_id = ?`, [userId])
        const affected = (r as unknown as { affectedRows?: number }).affectedRows ?? 0
        if (affected > 0) console.log(`  已删除 ${t}: ${affected} 行`)
      } catch (e) {
        console.log(`  ⚠ ${t} 清理失败: ${(e as Error).message}`)
      }
    }
    await q("DELETE FROM users WHERE id = ?", [userId])
    console.log("  已删除测试用户")
    const [left] = await q("SELECT COUNT(*) n FROM users WHERE id = ?", [userId])
    console.log(`  校验残留: ${left.n} 行（应为 0）`)
  }

  const onSignal = () => {
    console.log("\n收到中断信号，正在清理…")
    void cleanup().finally(() => process.exit(130))
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  try {
    // ── 预检：目标可达 ──────────────────────────────────────────────────────
    section("[0] 连通性预检")
    const home = await call("GET", "/")
    eq("首页返回 200", home.status, 200)

    if (DRY_RUN) {
      console.log("\ndry-run 结束：目标可达、数据库可连。未写入任何数据。")
      return
    }

    // ── 造一个「刚注册的免费用户」 ──────────────────────────────────────────
    // 故意用 is_pro=0：真实新用户会拿到 3 天试用，而免费态才能同时验证付费墙。
    await q(
      `INSERT INTO users (id, name, wechat_openid, invite_code, is_pro, pro_expires, diamonds)
       VALUES (?, ?, ?, ?, 0, NULL, 0)`,
      [userId, TAG, TAG, crypto.randomBytes(4).toString("hex").slice(0, 8).toUpperCase()],
    )
    created = true
    // 会话过期时间交给 MySQL 的 NOW() 计算，避免 Node 与库之间 8 小时时区差。
    await q(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))",
      [sessionId, userId],
    )

    // ── A. 认证边界 ─────────────────────────────────────────────────────────
    section("[A] 认证边界（未登录必须被挡住）")
    const anonStats = await call("GET", "/api/home/stats")
    eq("未登录 GET /api/home/stats → 401", anonStats.status, 401)

    const anonRecord = await call("POST", "/api/practice/record", { body: { sentenceId: "x" } })
    eq("未登录 POST /api/practice/record → 401", anonRecord.status, 401)

    const anonEarn = await call("POST", "/api/diamonds/earn", { body: { type: "sentence", refId: "x" } })
    eq("未登录 POST /api/diamonds/earn → 401", anonEarn.status, 401)

    const me = await call("GET", "/api/auth/me", { cookie })
    eq("已登录 GET /api/auth/me → 200", me.status, 200)
    eq("会话身份正确", (me.json?.user as Record<string, unknown> | undefined)?.id, userId)
    eq("免费用户 member_tier = free", (me.json?.user as Record<string, unknown> | undefined)?.member_tier, "free")

    // ── B. 内容可发现 ───────────────────────────────────────────────────────
    section("[B] 内容可发现（新用户能找到可练的课）")
    const list = await call("GET", "/api/courses/list?current=1&pageSize=50")
    eq("GET /api/courses/list → 200", list.status, 200)
    const courses = (list.json?.data as Record<string, unknown>[] | undefined) ?? []
    gt("返回已发布课程数", courses.length, 0)
    if (courses.length === 0) throw new Error("没有任何已发布课程，后续流程无法进行")

    // 找一节至少 10 句的已发布课时（有的课时句子为空）
    let lessonId = ""
    let courseId = ""
    let sentences: Record<string, unknown>[] = []
    let probed = 0
    // /api/courses/sentences 要求登录态。漏带 cookie 会让每次调用都 401，
    // 而 401 响应没有 sentences 字段 —— 于是「所有课时都只有 0 句」，
    // 一个极具误导性的假象（第一版脚本就是这么翻车的）。
    for (const c of courses.slice(0, 12)) {
      const lessonsResp = await call("GET", `/api/courses/${c.id}/lessons`)
      const lessons = (lessonsResp.json?.data as Record<string, unknown>[] | undefined) ?? []
      for (const l of lessons) {
        if (probed++ > 300) break
        const s = await call("GET", `/api/courses/sentences?lessonId=${l.id}`, { cookie })
        const arr = (s.json?.sentences as Record<string, unknown>[] | undefined) ?? []
        if (arr.length >= 10) {
          lessonId = String(l.id)
          courseId = String(c.id)
          sentences = arr
          break
        }
      }
      if (lessonId) break
    }
    check(`找到含 ≥10 句的已发布课时`, !!lessonId, lessonId ? `探测 ${probed} 节后命中` : `探测 ${probed} 节均不足 10 句`)
    if (!lessonId) throw new Error("找不到足够句子的课时")

    const ids = sentences.slice(0, 10).map((s) => String(s.id))
    eq("课时句子数 ≥ 10", ids.length, 10)

    // ── C. 练习落库（P0 核心） ──────────────────────────────────────────────
    section("[C] 练习落库 — 本次修复的核心")
    // 依据 docs/pages/04-practice.md：0 错=10 分、1-2 错=6 分、>2 错=2 分
    const mistakePlan = [0, 0, 0, 1, 2, 3, 0, 1, 0, 5]
    const expectScore = [10, 10, 10, 6, 6, 2, 10, 6, 10, 2]
    let recordOk = 0
    let scoreOk = 0
    for (let i = 0; i < 10; i++) {
      const r = await call("POST", "/api/practice/record", {
        cookie,
        body: { sentenceId: ids[i], mistakes: mistakePlan[i], userInput: `selftest-${i}` },
      })
      if (r.status === 200) recordOk++
      if (r.json?.score === expectScore[i]) scoreOk++
      // 客户端不传分数，服务端按 mistakes 推导 —— 顺手验证分数不可伪造
    }
    eq("10 次 POST /api/practice/record 全部 200", recordOk, 10)
    eq("10 次判分全部符合 10/6/2 规则", scoreOk, 10)

    const forged = await call("POST", "/api/practice/record", {
      cookie,
      body: { sentenceId: ids[0], mistakes: 99, score: 10 },
    })
    eq("伪造 score 字段被忽略（99 错仍判 2 分）", forged.json?.score, 2)

    const rowsInDb = await q(
      "SELECT COUNT(*) n FROM practice_records WHERE user_id = ?",
      [userId],
    )
    eq("practice_records 实际落库 11 行", Number(rowsInDb[0].n), 11)

    // ── D. 首页统计确实读到练习 ─────────────────────────────────────────────
    section("[D] 首页统计 — 用户能看见进度（修复前恒为 0）")
    const stats = await call("GET", "/api/home/stats", { cookie })
    eq("GET /api/home/stats → 200", stats.status, 200)
    eq("totalSentences = 11", stats.json?.totalSentences, 11)
    eq("todayCount = 11", stats.json?.todayCount, 11)
    eq("totalDays = 1", stats.json?.totalDays, 1)

    const weekly = (stats.json?.weekly as { date: string; count: number }[] | undefined) ?? []
    eq("weekly 长度为 7", weekly.length, 7)
    // weekly 最后一项恒为「今天」（上海时区），前端不必自己算时区
    const shToday = await q("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') d")
    eq("weekly 末项日期 = 上海今天", weekly[weekly.length - 1]?.date, String(shToday[0].d))
    eq("weekly 末项练习数 = 11", weekly[weekly.length - 1]?.count, 11)
    eq("weekly 其余 6 天为 0", weekly.slice(0, 6).reduce((a, b) => a + b.count, 0), 0)

    // 热力图口径来自 diamond_logs，此时还没发钻石，应为空
    const heatmapBefore = (stats.json?.heatmap as Record<string, number> | undefined) ?? {}
    eq("发放奖励前 heatmap 为空", Object.keys(heatmapBefore).length, 0)

    // ── E. 复习队列 ─────────────────────────────────────────────────────────
    section("[E] 复习队列")
    let enqueueOk = 0
    for (const id of ids.slice(0, 3)) {
      const r = await call("POST", "/api/review/enqueue", { cookie, body: { sentenceId: id } })
      if (r.status === 200) enqueueOk++
    }
    eq("3 次 POST /api/review/enqueue 全部 200", enqueueOk, 3)

    const dupEnqueue = await call("POST", "/api/review/enqueue", { cookie, body: { sentenceId: ids[0] } })
    eq("重复入队不报错", dupEnqueue.json?.alreadyQueued, true)
    const queued = await q(
      "SELECT COUNT(*) n FROM review_queue WHERE user_id = ? AND status = 'pending'",
      [userId],
    )
    eq("review_queue 去重后为 3 行", Number(queued[0].n), 3)

    const stats2 = await call("GET", "/api/home/stats", { cookie })
    eq("pendingReviews = 3", stats2.json?.pendingReviews, 3)

    // ── F. 钻石发放由服务端权威推导 ─────────────────────────────────────────
    section("[F] 钻石发放 — 服务端权威推导，不可伪造")
    // 把「最近一条练习记录」钉成一个确定的非满分记录，从而锁定 streak=1。
    // 需要这一步是因为 practice_records.created_at 是秒级 DATETIME：同一秒内写入的
    // 多条记录 ORDER BY created_at DESC 顺序不稳定，而 perfect streak 恰恰依赖这个顺序
    //（实测同一批记录下奖励在 5~8 之间漂）。真实用户每句间隔数秒，故影响有限。
    await sleep(1100)
    await call("POST", "/api/practice/record", { cookie, body: { sentenceId: ids[8], mistakes: 5 } })

    const earn1 = await call("POST", "/api/diamonds/earn", {
      cookie,
      body: { type: "sentence", refId: ids[0], durationSeconds: 42 },
    })
    eq("已练习的句子可领奖 → 200", earn1.status, 200)
    eq("首句满分奖励 = 5", earn1.json?.earned, 5)
    eq("首次领取 alreadyClaimed = false", earn1.json?.alreadyClaimed, false)

    warn(
      "practice_records.created_at 只有秒级精度，同秒记录排序不稳定",
      "perfect streak 与首页「最近学习」都依赖 ORDER BY created_at DESC；秒内并发写入时会取到任意顺序",
    )

    const earn2 = await call("POST", "/api/diamonds/earn", {
      cookie,
      body: { type: "sentence", refId: ids[0] },
    })
    eq("同一句重复领取 earned = 0", earn2.json?.earned, 0)
    eq("同一句重复领取 alreadyClaimed = true", earn2.json?.alreadyClaimed, true)

    // 旧实现直接采信请求体里的 perfect/streak，可无限刷钻石
    const forgedEarn = await call("POST", "/api/diamonds/earn", {
      cookie,
      body: { type: "sentence", refId: ids[1], perfect: true, streak: 999 },
    })
    eq("伪造 streak=999 不生效（仍为 5）", forgedEarn.json?.earned, 5)

    const noRecord = await call("POST", "/api/diamonds/earn", {
      cookie,
      body: { type: "sentence", refId: crypto.randomUUID() },
    })
    eq("没有练习记录时 → 403", noRecord.status, 403)

    // ── G. 并发竞态：练习记录与领奖同时发出 ─────────────────────────────────
    section("[G] 并发竞态 — 客户端三个请求都不 await")
    // 真实客户端在同一个提交里并发发出 record 和 earn，且都不 await，
    // 所以「领奖」可能比「落库」早到。服务端用 0.8s 重试窗口兜住它。
    const raceId = ids[9]
    const earnPromise = call("POST", "/api/diamonds/earn", {
      cookie,
      body: { type: "sentence", refId: raceId },
    })
    await sleep(60) // 让领奖先出发，模拟最坏顺序
    const recordPromise = call("POST", "/api/practice/record", {
      cookie,
      body: { sentenceId: raceId, mistakes: 0 },
    })
    const [raceEarn, raceRecord] = await Promise.all([earnPromise, recordPromise])
    eq("竞态下练习记录仍成功", raceRecord.status, 200)
    eq("竞态下领奖仍成功（重试窗口生效）→ 200", raceEarn.status, 200)
    gt("竞态下确实发出了钻石", Number(raceEarn.json?.earned ?? 0), 0)

    // ── H. 付费墙 ───────────────────────────────────────────────────────────
    section("[H] 付费墙 — 免费用户必须被挡在课程外")
    // 必须带 ?lesson=：page.tsx 在没有 lesson 参数时会提前 return「缺少课程信息」，
    // 根本不执行付费墙判断。第一版脚本漏了这个参数，于是误报「付费墙失效」。
    const learnUrl = `/home/learn/${courseId}?lesson=${lessonId}`
    const paywalled = await call("GET", learnUrl, { cookie })
    // Next.js 在响应已开始流式输出后会以「200 + 客户端跳转」的方式实现 redirect()，
    // 所以不能只看状态码 —— 第一版脚本就是这么误报「付费墙失效」的。
    // 判据必须落在 body 里的跳转目标上。
    const bodyToPricing = paywalled.text.includes("/pricing?reason=learn") || paywalled.text.includes("/pricing")
    const sentToPricing =
      paywalled.status === 307 ||
      paywalled.status === 302 ||
      paywalled.status === 303 ||
      String(paywalled.location ?? "").includes("/pricing") ||
      bodyToPricing
    check(
      "免费用户访问课程页被引导到 /pricing",
      sentToPricing,
      `status=${paywalled.status} location=${paywalled.location ?? "-"} body含/pricing=${bodyToPricing}`,
    )
    check(
      "跳转目标带 reason=learn（便于归因）",
      paywalled.text.includes("reason=learn") || String(paywalled.location ?? "").includes("reason=learn"),
      paywalled.text.includes("reason=learn") ? "body 命中" : "未命中",
    )

    // 付费墙只挡页面，内容接口本身只校验「登录」而不校验会员。
    // 实测确认后作为已知缺口报出，不计入失败（是否收紧属于业务决策）。
    const leak = await call("GET", `/api/courses/sentences?lessonId=${lessonId}`, { cookie })
    const leakCount = ((leak.json?.sentences as unknown[] | undefined) ?? []).length
    if (leak.status === 200 && leakCount > 0) {
      warn(
        "免费用户仍可通过内容接口读取课程句子",
        `付费墙仅作用于页面；/api/courses/sentences 只要登录即可返回 ${leakCount} 句`,
      )
    }

    // 试用/付费用户应当放行
    await q("UPDATE users SET is_pro = 1, pro_expires = DATE_ADD(NOW(), INTERVAL 3 DAY) WHERE id = ?", [userId])
    const allowed = await call("GET", learnUrl, { cookie })
    eq("Pro 用户访问同一课程页 → 200", allowed.status, 200)
    check(
      "Pro 用户响应不再包含付费墙跳转",
      !allowed.text.includes("reason=learn"),
      allowed.text.includes("reason=learn") ? "仍含 reason=learn 跳转" : "无",
    )

    const mePro = await call("GET", "/api/auth/me", { cookie })
    eq("Pro 用户 member_tier = trial", (mePro.json?.user as Record<string, unknown> | undefined)?.member_tier, "trial")
    eq("Pro 用户 is_pro = true", (mePro.json?.user as Record<string, unknown> | undefined)?.is_pro, true)

    // 试用过期应被惰性降级（checkAndExpirePro）
    await q("UPDATE users SET is_pro = 1, pro_expires = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?", [userId])
    await call("GET", "/api/auth/me", { cookie })
    const [downgraded] = await q("SELECT is_pro FROM users WHERE id = ?", [userId])
    eq("过期试用被惰性降级 is_pro = 0", Number(downgraded.is_pro), 0)

    // ── I. 支付链路 ─────────────────────────────────────────────────────────
    section("[I] 支付下单 — 真实价格 + 回调验签")
    // 注意：本段会在微信侧创建 2 笔未支付、2 小时后自动过期的预支付单
    //（等同于一个用户打开收款二维码又关掉），DB 侧记录由 cleanup 删除。
    const badPlan = await call("POST", "/api/payment/create-order", { cookie, body: { plan: "lifetime_free" } })
    eq("非法 plan → 400", badPlan.status, 400)

    // 历史 bug：生产曾设 WECHAT_PAY_TEST_MODE=1，导致 ¥399 合伙人终身会员
    // 能被 1 分钱买走（库里那 2 笔 amount=1 的 paid 订单就是这么来的）。
    // 现在测试价只在 NODE_ENV=development 生效，所以这里必须看到真实价。
    const PLAN_PRICE: Record<string, number> = { monthly: 2900, yearly: 19900, partner: 39900 }
    for (const plan of ["monthly", "partner"] as const) {
      const before = Number((await q("SELECT COUNT(*) n FROM payment_orders WHERE user_id = ?", [userId]))[0].n)
      const order = await call("POST", "/api/payment/create-order", { cookie, body: { plan } })
      const after = Number((await q("SELECT COUNT(*) n FROM payment_orders WHERE user_id = ?", [userId]))[0].n)

      eq(`下单 ${plan} → 200`, order.status, 200)
      eq(`下单 ${plan} 使用真实价格（非 1 分钱）`, Number(order.json?.amount), PLAN_PRICE[plan])
      check(
        `下单 ${plan} 返回可扫码的 code_url`,
        String(order.json?.code_url ?? "").startsWith("weixin://"),
        String(order.json?.code_url ?? order.snippet).slice(0, 48),
      )
      eq(`下单 ${plan} 落库 1 笔订单`, after - before, 1)

      const [row] = await q(
        "SELECT amount, status FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
      eq(`落库订单 ${plan} 金额一致`, Number(row?.amount), PLAN_PRICE[plan])
      eq(`落库订单 ${plan} 初始状态 pending`, row?.status, "pending")
    }

    // 回调验签：伪造报文一律 401。若这里返回 200，等于任何人都能白拿会员。
    const forgedNotify = await call("POST", "/api/payment/notify", {
      body: {
        id: "selftest-forged",
        event_type: "TRANSACTION.SUCCESS",
        resource: { algorithm: "AEAD_AES_256_GCM", ciphertext: "AAAA", nonce: "AAAA", associated_data: "" },
      },
    })
    eq("伪造支付回调 → 401", forgedNotify.status, 401)

    const plaintextNotify = await call("POST", "/api/payment/notify", {
      body: { event_type: "TRANSACTION.SUCCESS", out_trade_no: "selftest", trade_state: "SUCCESS" },
    })
    eq("顶层明文回调（无加密 resource）→ 401", plaintextNotify.status, 401)

    // ── J. 时区一致性 ───────────────────────────────────────────────────────
    section("[J] 时区一致性 — 全站统一 Asia/Shanghai 墙上时间")
    const tz = await q("SELECT @@session.time_zone tz, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i') sh")
    const fmt = await q(
      "SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') c FROM practice_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId],
    )
    const nowSh = String(tz[0].sh)
    const recSh = String(fmt[0]?.c ?? "")
    check(
      "刚写入的练习记录时间戳 = 上海当前时间（误差 < 5 分钟）",
      !!recSh && Math.abs(new Date(nowSh).getTime() - new Date(recSh).getTime()) < 5 * 60 * 1000,
      `记录=${recSh} 现在=${nowSh}`,
    )
  } finally {
    await cleanup()
    await conn.end()
  }

  // ── 汇总 ───────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok)
  const passed = results.length - failed.length
  console.log(`\n${"=".repeat(60)}`)
  console.log(`自检结果: ${passed} 通过 / ${failed.length} 失败  (共 ${results.length} 项)`)
  if (failed.length) {
    console.log("\n失败项：")
    for (const f of failed) console.log(`  ✗ ${f.section} ${f.name} — ${f.detail}`)
    process.exitCode = 1
  } else {
    console.log("全部通过：新用户从注册到看见进度、复习、领奖、付费墙的链路已闭环。")
  }
  if (warnings.length) {
    console.log(`\n已知缺口 / 待决策（不影响退出码，共 ${warnings.length} 项）：`)
    for (const w of warnings) console.log(`  ! ${w.section} ${w.name} — ${w.detail}`)
  }
  console.log(`${"=".repeat(60)}`)
}

main().catch(async (e) => {
  console.error(`\n自检中断: ${(e as Error).message}`)
  process.exitCode = 1
})
