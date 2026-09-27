/**
 * 后台 AI 接口的调用配额。
 *
 * 为什么需要：这 5 个接口每一个都会真实调用 DeepSeek 并计费，而它们此前
 * **完全没有限流**（公开接口如 verify-code 都有）。触发超额成本并不需要攻击者 ——
 * 一次误点、前端重试逻辑、或者"AI 生成"按钮被连点几下就够了；其中
 * materials/analyze 与 ai/extract-sentences 是**批量**接口，一次调用会分块
 * 请求几十次 LLM。
 *
 * 为什么按管理员账号（userId）而不是 IP：额度是按账号花的，而管理员可能
 * 从同一个出口 IP 访问（甚至同一台机器上多个账号）。按 IP 限流会在
 * "两个管理员同时用"时互相误伤，也无法约束单个账号的失控循环。
 * 公开接口按 IP 是对的（没有账号），这里不是。
 *
 * 分类配额而不是一个总数：单条操作（分析一句、拆分一句、生成一课）是交互式的，
 * 人点几十次是正常操作；批量操作（整篇文档、批量抽取）一次就顶几十次，
 * 配额必须小得多。用同一个数字会把正常使用卡死，或者对批量形同虚设。
 */

import { checkRateLimit } from "@/lib/rate-limit"

export type AdminAiAction =
  | "materials-analyze"
  | "ai-extract-sentences"
  | "sentence-analyze"
  | "sentence-split"
  | "course-ai-generate"

interface Quota {
  max: number
  windowMs: number
}

/** 窗口统一 10 分钟：足够长到覆盖一次导入操作，短到失误后很快恢复。 */
const WINDOW_MS = 10 * 60_000

/**
 * 每个动作的配额。数字的取法：
 *   - 批量动作按"一次操作 = 一次点击"算，10 次/10 分钟已经很宽松
 *     （正常情况下一个人 10 分钟不会导入 10 篇文档）；
 *   - 单条动作按"编辑内容时反复点"算，60 次/10 分钟约等于每 10 秒一次，
 *     正常编辑碰不到，但足以拦住死循环。
 */
export const ADMIN_AI_QUOTAS: Record<AdminAiAction, Quota> = {
  "materials-analyze": { max: 10, windowMs: WINDOW_MS },
  "ai-extract-sentences": { max: 10, windowMs: WINDOW_MS },
  "sentence-analyze": { max: 60, windowMs: WINDOW_MS },
  "sentence-split": { max: 60, windowMs: WINDOW_MS },
  "course-ai-generate": { max: 30, windowMs: WINDOW_MS },
}

export interface AiQuotaResult {
  allowed: boolean
  retryAfter?: number
  /** 给用户看的说明，超限时拼进错误信息 */
  message?: string
}

/**
 * 检查某个管理员是否还能执行该动作。允许时不返回 message。
 *
 * 返回的 message 里带上"多久后重试"，否则使用者只会看到"失败"而反复重试，
 * 那样反而更容易把配额耗光。
 */
export function checkAdminAiQuota(action: AdminAiAction, userId: string): AiQuotaResult {
  const quota = ADMIN_AI_QUOTAS[action]
  const res = checkRateLimit(`admin-ai:${action}`, userId, quota.max, quota.windowMs)
  if (res.allowed) return { allowed: true }

  const seconds = res.retryAfter ?? Math.ceil(quota.windowMs / 1000)
  const minutes = Math.ceil(seconds / 60)
  return {
    allowed: false,
    retryAfter: seconds,
    message:
      `该操作已达调用上限（${quota.max} 次 / ${quota.windowMs / 60_000} 分钟），` +
      `请约 ${minutes} 分钟后重试。AI 调用会计费，因此设有配额。`,
  }
}

/** 超限时的统一 429 响应体（保持与其它接口一致的 error 字段）。 */
export function quotaExceededBody(result: AiQuotaResult) {
  return { error: result.message ?? "调用过于频繁，请稍后重试", retryAfter: result.retryAfter }
}
