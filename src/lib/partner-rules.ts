/**
 * 推广规则的**数值单一来源**。
 *
 * 为什么要把这几个数字抽出来：它们不只是内部参数，而是**对推广员的对外承诺** ——
 * 推广中心会显示「这位好友还有 30 天归因窗口」「冷静期还剩 12 天」「还差 ¥35.5 可提现」。
 *
 * 如果 UI 和佣金链路各写一份，两边一漂移就会出现最伤人的那种故障：
 * **看板说还有 30 天、推广员据此去催单，但佣金代码判断已过期、一分钱不写。**
 * 推广员的信任是一次性的，这种故障没有第二次机会。所以数值只在这里定义一次。
 *
 * 本模块**纯函数、无服务端依赖**，客户端组件与 API 路由都要用。
 *
 * ⚠️ 改动这里的任何数值，必须同步检查：
 *   · `src/app/(public)/partner-agreement/page.tsx`（协议正文写死了比例与冷静期）
 *   · `src/lib/promotion-materials.ts`（推广素材里会引用比例）
 *   · `src/app/(public)/pricing/page.tsx` 与 `PricingFAQ.tsx`（对外口径）
 */

/** 归因窗口：被推荐人**注册后**多少天内付款才产生佣金。比句乐部的"永久绑定"保守。 */
export const ATTRIBUTION_WINDOW_DAYS = 90

export const ATTRIBUTION_WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** 佣金冷静期：成交后多少天佣金才从 `cooling` 转为可提现。 */
export const COMMISSION_COOLING_DAYS = 15

/** 最低提现金额（分）。低于它按钮不可点，界面上必须显示**还差多少**。 */
export const MIN_WITHDRAW_FEN = 5000

/**
 * 佣金比例。首次 50% / 续费 30%。
 *
 * 「首购」只看**真正结算过**的佣金 —— 被退款扣回（`clawed_back`）的记录不算数，
 * 否则被推荐人退款后重新购买会被判成续费，佣金从 50% 掉到 30%，
 * 等于让推广员替平台承担退款成本。见 `lib/subscription.ts` 的 triggerCommission。
 */
export const COMMISSION_RATE = { first: 0.5, renewal: 0.3 } as const

export type CommissionType = keyof typeof COMMISSION_RATE

export const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  first: "首次购买",
  renewal: "续费",
}

/**
 * 归因截止时间：注册时间 + 90 天。被推荐人必须在这个时刻**之前**付款。
 *
 * 注意佣金判定用的是**订单时间**而不是付款回调到达的时间
 * （见 subscription.ts：延迟到达的支付通知不该吃掉佣金）。
 * 所以界面上的倒计时按注册时间算，与实际判定口径一致。
 */
export function attributionDeadline(registeredAt: Date | string): Date {
  return new Date(new Date(registeredAt).getTime() + ATTRIBUTION_WINDOW_MS)
}

/**
 * 归因窗口还剩几天（向下取整）。已过期返回负数。
 *
 * 用 `Math.ceil` 而不是 floor：还剩 0.5 天时应该说「今天截止」，
 * 说「还剩 0 天」会让人以为已经没戏了而放弃。
 */
export function daysLeftInWindow(registeredAt: Date | string, now: number = Date.now()): number {
  const ms = attributionDeadline(registeredAt).getTime() - now
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

/** 这笔订单是否还在归因窗口内。orderTime 传订单时间（不是 Date.now）。 */
export function isWithinAttributionWindow(
  registeredAt: Date | string,
  orderTime: number,
): boolean {
  return orderTime - new Date(registeredAt).getTime() <= ATTRIBUTION_WINDOW_MS
}

/**
 * 提现进度。
 *
 * `shortfallFen` 是界面上必须显示的那个数 —— 只把一个禁用的按钮摆在那里，
 * 推广员只会得出"这是骗人的"。信任崩塌最常见的就是这一秒。
 */
export function withdrawProgress(availableFen: number): {
  canWithdraw: boolean
  shortfallFen: number
} {
  const shortfallFen = MIN_WITHDRAW_FEN - availableFen
  return { canWithdraw: shortfallFen <= 0, shortfallFen: Math.max(0, shortfallFen) }
}

/** 分 → 「¥12.34」 */
export function fmtFen(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`
}
