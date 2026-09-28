/**
 * 佣金写入失败的处置（纯函数 + 错误类型，便于单测）。
 *
 * ── 要防的是什么 ────────────────────────────────────────────────────────────
 *
 * 佣金此前是 fire-and-forget：
 *
 *     void triggerCommission(...).catch((e) => console.error("Commission trigger failed:", e))
 *
 * 也就是说进程在写入前抖动（重启、DB 短暂不可用、容器被回收），这一笔真实的
 * 分销佣金就**永久消失**：没有任何重试、没有补偿任务（本仓库也没有定时任务），
 * 只在日志里留一行。对合作方就是少拿钱。
 *
 * ── 改法：把"是否重试"的决定权交回给调用方 ──────────────────────────────────
 *
 * 微信支付的回调是**会重试**的（指数退避、持续若干小时），而 activateSubscription
 * 已经有按订单号去重的幂等分支。所以只要：
 *
 *   1. 佣金写入失败时**抛出去** → 回调返回 500 → 微信重试；
 *   2. 幂等分支里**补一次**佣金写入 → 重试即自愈；
 *
 * 就能把"永久丢失"变成"最多延迟到下一次重试"，而且不需要任何定时任务。
 *
 * 唯一的例外是**唯一键冲突**：`partner_commissions.order_id` 上有唯一索引
 * （idx_pc_order_id），撞它说明这一单已经结算过 —— 那是正常情况（微信重试回调
 * 必然走到），必须静默返回，否则重试会永远失败。
 *
 * 所以这里的核心判断只有一句：**撞唯一键 = 已发过（静默）；其它错误 = 故障（抛出）。**
 * 这与 lib/auth/invite.ts 里那个 `catch {}` 把两类错误混为一谈的坑是同一个形状。
 */

import { isDuplicateKeyError } from "@/lib/db/duplicate-key"

export type CommissionWriteOutcome =
  /** 已经结算过（撞唯一键）—— 幂等重试的正常结果，静默返回 */
  | "already_awarded"
  /** 真故障 —— 必须抛出去，让整笔回调失败并触发微信重试 */
  | "fatal"

export function classifyCommissionWriteError(err: unknown): CommissionWriteOutcome {
  return isDuplicateKeyError(err) ? "already_awarded" : "fatal"
}

/**
 * 佣金写入失败（非幂等原因）。
 *
 * 单独一个类型是为了让调用方**无法忽略**：它不属于"业务分支"，
 * 而是"这笔钱没记上，需要让上游重试"。
 */
export class CommissionWriteError extends Error {
  readonly orderId: string
  readonly cause?: unknown

  constructor(orderId: string, cause?: unknown) {
    super(`佣金写入失败（order=${orderId}），需要上游重试`)
    this.name = "CommissionWriteError"
    this.orderId = orderId
    this.cause = cause
  }
}
