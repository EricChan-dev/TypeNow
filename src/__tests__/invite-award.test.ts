/**
 * 「邀请有礼」发放逻辑的回归约束。
 *
 * 背景：这一处曾经会**静默少发会员天数**。同一邀请人在同一天拉到第二个付费用户时，
 * `task_logs` 的记账行撞上 uk_task_user_type_date（该索引本意只管分享任务，
 * 却对所有 task_type 生效），而 awardInvitePurchase 把「插不进去」一律当成
 * 「已经发过」直接 return —— 邀请人少 30 天、被邀请人少 20 天，没有任何日志。
 *
 * 修法有三块，缺一不可，因此这里既测纯函数、也钉住源码结构：
 *   1. DDL 把每日唯一约束限定回分享任务（db/migrations/00025）；
 *   2. 区分「唯一键冲突（已发过）」与「真故障」，后者不许静默吞掉；
 *   3. 记账失败**不得**阻断发放 —— 调用方刻意不重试（会员已开通），
 *      所以这里放弃兜底就等于用户永远拿不到。
 *
 * 真实行为已在隔离库验证过（旧结构首购#2 被拒 → 新结构成功，
 * 且分享去重与首购幂等均保留）。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  DUPLICATE_KEY_CODE,
  DUPLICATE_KEY_ERRNO,
  isDuplicateKeyError,
} from "@/lib/db/duplicate-key"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

describe("isDuplicateKeyError", () => {
  it("识别直接抛出的 ER_DUP_ENTRY（按 code 或 errno）", () => {
    expect(isDuplicateKeyError({ code: DUPLICATE_KEY_CODE })).toBe(true)
    expect(isDuplicateKeyError({ errno: DUPLICATE_KEY_ERRNO })).toBe(true)
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY", errno: 1062 })).toBe(true)
  })

  it("识别 drizzle 包装后的错误（原始错误挂在 cause 上）", () => {
    expect(isDuplicateKeyError({ name: "DrizzleQueryError", cause: { code: "ER_DUP_ENTRY" } })).toBe(
      true,
    )
    expect(isDuplicateKeyError({ cause: { errno: 1062 } })).toBe(true)
  })

  it("其余错误一律不算重复键 —— 这正是当年被误判成「已发过」的那一类", () => {
    expect(isDuplicateKeyError({ code: "ECONNREFUSED" })).toBe(false)
    expect(isDuplicateKeyError({ errno: 1406 })).toBe(false) // Data too long
    expect(isDuplicateKeyError(new Error("boom"))).toBe(false)
    expect(isDuplicateKeyError(null)).toBe(false)
    expect(isDuplicateKeyError(undefined)).toBe(false)
    expect(isDuplicateKeyError("ER_DUP_ENTRY")).toBe(false)
    expect(isDuplicateKeyError({ cause: { code: "ETIMEDOUT" } })).toBe(false)
  })
})

describe("邀请发放：源码结构约束（防回退）", () => {
  const src = read("src/lib/auth/invite.ts")

  it("用 isDuplicateKeyError 区分冲突与故障，而不是笼统的 catch {}", () => {
    expect(src).toContain("isDuplicateKeyError")
    // 曾经的写法：catch { /* 忽略重复 */ } —— 它会把 DB 抖动也当成"已发过"
    expect(src).not.toMatch(/catch\s*\{\s*\n\s*\/\//)
    expect(src).not.toContain("// 唯一键冲突 = 这次邀请已经记过，忽略\n  } catch {\n")
  })

  it("首购奖励的发放不放在 try 里 —— 记账失败也要继续发天数", () => {
    const tryIdx = src.indexOf("await db.insert(taskLogs).values")
    const grantIdx = src.indexOf("await extendProDays(inviterId")
    expect(tryIdx).toBeGreaterThan(-1)
    expect(grantIdx).toBeGreaterThan(tryIdx)
    // 发放必须发生在 catch 之后（即不受插入失败影响），而不是嵌在 try 块内
    const between = src.slice(tryIdx, grantIdx)
    expect(between).toContain("isDuplicateKeyError")
    expect(between).toContain("if (alreadyGranted) return")
  })

  it("extendProDays 是单条 SQL（原子），不是读-改-写", () => {
    expect(src).toContain("TIMESTAMPADD(DAY")
    expect(src).toContain("GREATEST(COALESCE(")
    // 旧写法先 select 出 proExpires 在 JS 里算，并发下会丢天数
    expect(src).not.toMatch(/const base =\s*\n?\s*user\.isPro/)
  })
})

describe("迁移与 schema 的一致性约束", () => {
  it("00025 迁移存在，且同时做了「加新索引」与「删旧索引」", () => {
    const sql = read("db/migrations/00025_task_logs_daily_index.sql")
    expect(sql).toContain("uk_task_share_day")
    expect(sql).toContain("DROP INDEX uk_task_user_type_date")
    expect(sql).toContain("GENERATED ALWAYS AS")
  })

  it("schema.ts 里旧的每日唯一键已不存在，改为按 share_day 限定", () => {
    const schema = read("src/lib/db/schema.ts")
    expect(schema).not.toContain('uniqueIndex("uk_task_user_type_date")')
    expect(schema).toContain('uniqueIndex("uk_task_share_day").on(t.userId, t.shareDay)')
  })

  it("迁移不显式指定 collation（让它继承表，避免与 push 出的测试库漂移）", () => {
    const sql = read("db/migrations/00025_task_logs_daily_index.sql")
    const addColumn = sql.slice(sql.indexOf("ALTER TABLE task_logs"))
    expect(addColumn).not.toContain("COLLATE utf8mb4_unicode_ci")
  })
})
