/**
 * 后台操作审计日志（写入侧）。
 *
 * 背景与表设计见 db/migrations/00022_admin_audit_logs.sql。这里只讲**这个模块
 * 自己的两条硬约束**：
 *
 * 1. **绝不抛错**。审计是旁路：业务写成功了就成功了，不能因为记不上日志而返回
 *    500 —— 那等于"日志表一有问题，整个后台就改不了东西"，比没有日志更糟。
 *    所有异常在这里吞掉并打 console.error（Sentry 会接走）。
 *
 * 2. **快照 + 脱敏**。日志要能在几个月后仍然被读懂，所以操作者与对象都存**当时的
 *    文本快照**（不是 id 关联）；同时任何疑似凭据的字段在落库前就被丢掉 ——
 *    审计表是给多人看的，绝不能成为泄露 token 的新途径。
 *
 * 写入时机：在业务写操作**成功之后**调用。写在之前的话，"尝试改但被守卫拦下"
 * 的请求也会留痕，日志会立刻充满噪音（守卫拒绝不是管理动作）。
 */

import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { adminAuditLogs, users } from "@/lib/db/schema"
// 手机号脱敏复用后台统一的那一份（src/lib/mask.ts）：
// 这里再写一遍就会有两套规则，将来改一处必然漏另一处
import { maskPhone } from "@/lib/mask"

/** 与 DDL 中的列宽一一对应；超长会直接抛 "Data too long" 并被吞掉，等于丢日志 */
const MAX_ACTION = 50
const MAX_TARGET_TYPE = 50
const MAX_TARGET_ID = 64
const MAX_LABEL = 191
const MAX_IP = 64
const MAX_USER_AGENT = 255

/**
 * detail 的字段名命中这些模式就**整条丢弃**。
 *
 * 为什么是丢而不是掩码：被审计的动作里没有哪一个是"必须看到 token 才能理解"的，
 * 留着掩码版只会让人以为里面还有信息。openid 也算凭据 —— 它是跨应用可关联的
 * 持久标识，审计表不该成为它的第二个存放点（用户表里已经有了）。
 */
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|pwd|openid|unionid|credential|authorization|api[_-]?key|app[_-]?key|signature|private[_-]?key)/i

/** 深度上限：detail 是人工构造的，但一个失控的嵌套对象会让整行日志无法阅读 */
const MAX_DEPTH = 4
/** 单个字符串值的上限（JSON 里不会截断查询，只影响可读性，给宽松些） */
const MAX_VALUE_LEN = 500
const MAX_ARRAY_ITEMS = 50

export interface AuditActor {
  userId: string
}

export interface AuditEntry {
  /** 动作：create / update / delete / restore / reorder / split / upload / analyze / import / handle */
  action: string
  /** 对象类型：user / course / lesson / sentence / material / feedback */
  targetType: string
  targetId?: string | null
  /** 对象快照（课程名 / 句子中文前 80 字 / 用户名），不是 id */
  targetLabel?: string | null
  /** 变更摘要；键名白名单由 sanitizeAuditDetail 负责脱敏 */
  detail?: Record<string, unknown> | null
}

/** 截断到列宽。超长会让 INSERT 抛 "Data too long"，而错误被吞掉就等于这条日志没了 */
export function truncateAuditText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  const s = typeof value === "string" ? value : String(value)
  if (s.length <= max) return s
  // 留一个省略号，读的人能看出"这里被截了"，而不是以为原文就这么长
  return s.slice(0, max - 1) + "…"
}

/**
 * 递归脱敏 + 截断。
 *
 * 有意不试图"聪明地"识别值里内嵌的密钥（例如某个字符串字段里塞了 JSON）——
 * 按**键名**判定是这个模块与调用方之间的契约：不要把凭据放进 detail。
 * 值级别的正则扫描会产生大量误报，且永远追不上新的密钥格式。
 */
export function sanitizeAuditDetail(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null
  if (depth >= MAX_DEPTH) return "(层级过深，已省略)"

  if (value instanceof Date) return value.toISOString()
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return String(value)
  if (typeof value === "string") {
    return value.length > MAX_VALUE_LEN ? value.slice(0, MAX_VALUE_LEN - 1) + "…" : value
  }
  if (typeof value === "function" || typeof value === "symbol") return null

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((v) => sanitizeAuditDetail(v, depth + 1))
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) continue
    out[k] = sanitizeAuditDetail(v, depth + 1)
  }
  return out
}

/**
 * 只保留**真的变了**的字段，并同时记下前后值。
 *
 * 为什么不用"记录整行 after"：那样日志会告诉你看的人"level 还是 1、名字还是原来的"
 * 一堆没变的东西，真正的改动被淹没。审计要回答的是"这一次改了什么"。
 * `fields` 是调用方给的**白名单**，不在其中的列不会被记进来。
 */
export function diffAuditFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
  fields: readonly (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  if (!before || !after) return out

  for (const f of fields) {
    const from = before[f]
    const to = after[f]
    if (valuesEqual(from, to)) continue
    out[f] = { from: sanitizeAuditDetail(from), to: sanitizeAuditDetail(to) }
  }
  return out
}

/** 日期按时间戳比，其余按字面量比（JSON 化会让 Date 变成字符串而"看起来变了"） */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a === null || a === undefined ? null : new Date(a as string).getTime()
    const tb = b instanceof Date ? b.getTime() : b === null || b === undefined ? null : new Date(b as string).getTime()
    if (ta === null || tb === null || Number.isNaN(ta) || Number.isNaN(tb)) return a === b
    return ta === tb
  }
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) {
    // null 与 undefined 都表示"没有值"，不构成一次变更
    return (a ?? null) === (b ?? null)
  }
  return false
}

/** 从用户行拼出可读的操作者快照，例如 "张三(166****2010)" */
export function describeAuditActor(
  user: { name?: string | null; phone?: string | null } | null | undefined,
  fallbackId: string,
): string {
  if (!user) return fallbackId === "dev-admin" ? "dev-admin(开发旁路)" : fallbackId
  const name = (user.name ?? "").trim()
  const phone = maskPhone(user.phone) ?? ""
  if (name && phone) return `${name}(${phone})`
  if (name) return name
  if (phone) return phone
  return fallbackId
}

/**
 * 句子的可读标签：取中文前 80 字。
 *
 * 句子没有标题，列表页显示的就是中文原文。截到 80 字是因为审计列表要一眼能扫，
 * 而句子的中文很少有超过 80 字的；真超了后面还有 target_id 可以定位。
 */
export function sentenceAuditLabel(chinese: string | null | undefined): string | null {
  const s = (chinese ?? "").trim()
  if (!s) return null
  return s.length <= 80 ? s : `${s.slice(0, 79)}…`
}

/** 取真实客户端 IP：经过 nginx，x-forwarded-for 的第一段才是原始来源 */
export function clientIpOf(req: Request | null | undefined): string | null {
  if (!req) return null
  const h = req.headers
  const xff = h.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  return h.get("x-real-ip") ?? null
}

/**
 * 写一条审计日志。
 *
 * **永不抛错**（见文件头）。也**永不阻塞太久**：只是一次单行 INSERT，
 * 所以这里直接 await —— 用 fire-and-forget 的话，Serverless/进程重启会把它丢掉，
 * 而"日志偶尔少一条"比"日志慢 1ms"严重得多。
 */
export async function logAdminAction(
  actor: AuditActor,
  entry: AuditEntry,
  req?: Request | null,
): Promise<void> {
  try {
    if (!db) return

    // 操作者快照。dev 旁路下 "dev-admin" 不是真实用户，查不到 → 用 id 兜底
    let adminLabel = describeAuditActor(null, actor.userId)
    try {
      const [u] = await db
        .select({ name: users.name, phone: users.phone })
        .from(users)
        .where(eq(users.id, actor.userId))
        .limit(1)
      adminLabel = describeAuditActor(u, actor.userId)
    } catch {
      // 查不到操作者不影响记这条日志 —— 快照有 id 兜底
    }

    await db.insert(adminAuditLogs).values({
      adminId: truncateAuditText(actor.userId, MAX_TARGET_ID),
      adminLabel: truncateAuditText(adminLabel, MAX_LABEL),
      action: truncateAuditText(entry.action, MAX_ACTION) ?? "unknown",
      targetType: truncateAuditText(entry.targetType, MAX_TARGET_TYPE) ?? "unknown",
      targetId: truncateAuditText(entry.targetId, MAX_TARGET_ID),
      targetLabel: truncateAuditText(entry.targetLabel, MAX_LABEL),
      detail: (entry.detail ? sanitizeAuditDetail(entry.detail) : null) as never,
      ip: truncateAuditText(clientIpOf(req), MAX_IP),
      userAgent: truncateAuditText(req?.headers.get("user-agent") ?? null, MAX_USER_AGENT),
    })
  } catch (err) {
    console.error("[admin-audit] 写审计日志失败（已忽略，不影响业务结果）", err)
  }
}
