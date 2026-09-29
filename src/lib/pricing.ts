/**
 * 定价的唯一事实源（纯函数，无数据库依赖）。
 *
 * ── 「原价」为什么必须等于真实续费价 ──────────────────────────────────────────
 *
 * 四档都有首期优惠（仅限新用户首次购买）。**原价不是装饰性的划线价**，
 * 而是老用户续费时**实际支付**的价格。
 *
 * 这一点必须成立，否则构成《明码标价和禁止价格欺诈规定》第十九条的「虚构原价」。
 * 所以：页面上要写明「续费按原价」，代码里也要真的按原价收续费 ——
 * 那行文案既是事实陈述，也是免责证据。
 *
 * ── 档位 key 与历史包袱 ──────────────────────────────────────────────────────
 *
 * 终身档的 key 仍是 `partner`（数据库 enum、`users.is_partner` 都沿用这个名字），
 * 但**语义已改为纯「终身会员」**：2026-09-29 合规改造已把推广资格从该商品解绑，
 * 佣金对所有注册用户开放。
 *
 * 保留旧 key 是刻意的取舍：一次横跨 DB enum + 列名 + 约 10 处 UI 引用的纯重命名，
 * 会让同一轮改动多出一个高风险、零用户价值的机械变更。
 * 见 docs/implementation-plan-2026-09.md §6。
 *
 * 本模块**不得引入 db / drizzle**：价格页是客户端组件。
 */

/** 能购买的会员档位。`partner` 是历史 key，语义＝终身会员。 */
export type PlanKey = "monthly" | "quarterly" | "yearly" | "partner"

export interface PlanSpec {
  key: PlanKey
  /** 用户可见的档位名 */
  label: string
  /** 原价（分）。**＝真实续费价**，不是装饰性划线价。 */
  standardAmount: number
  /** 新用户首次购买价（分）。 */
  firstAmount: number
  /** 有效期（自然月数），仅用于展示与单位后缀。终身档为 null。 */
  months: number | null
  /**
   * 开通时实际加的天数。
   *
   * 为什么不直接用 `months * 30`：年卡必须仍是 **365** 天（一个自然年），
   * 而 12 × 30 = 360 —— 无脑换算会把年卡悄悄缩短 5 天，这是用户可感知的权益损失。
   * 所以两个字段各自显式声明，由本文件作为唯一来源。
   */
  durationDays: number | null
  /** 是否终身 */
  lifetime: boolean
  /** 一句话卖点 */
  tagline: string
}

/**
 * 终身档的有效天数。
 *
 * 实现上是 `subscriptions.expires_at` 的一个远期值（≈2099 年），而不是 NULL ——
 * 订阅表里的 `expires_at` 是 NOT NULL，且多处按 `expires_at > NOW()` 判断有效性，
 * 用 NULL 表达"永久"会把这些判断全部改成特例。
 */
export const LIFETIME_DURATION_DAYS = 365 * 99

/**
 * 四档定价。现价（首期优惠）＝ 29 / 79 / 199 / 499 元。
 *
 * 原价参照句乐部（¥39/¥109/¥365/¥1999）定得更低：标准价全部低于它，
 * 既不显得夸张，也给「首期优惠」留出了真实的差额。
 */
export const PLANS: readonly PlanSpec[] = [
  {
    key: "monthly",
    label: "月度会员",
    standardAmount: 3900,
    firstAmount: 2900,
    months: 1,
    durationDays: 30,
    lifetime: false,
    tagline: "先试一个月",
  },
  {
    key: "quarterly",
    label: "季度会员",
    standardAmount: 10900,
    firstAmount: 7900,
    months: 3,
    durationDays: 90,
    lifetime: false,
    tagline: "短期最划算",
  },
  {
    key: "yearly",
    label: "年度会员",
    standardAmount: 29900,
    firstAmount: 19900,
    months: 12,
    durationDays: 365,
    lifetime: false,
    tagline: "折合每天不到 6 毛",
  },
  {
    key: "partner",
    label: "终身会员",
    standardAmount: 69900,
    firstAmount: 49900,
    months: null,
    durationDays: null,
    lifetime: true,
    tagline: "一次买断，永久有效",
  },
]

/**
 * 开通某档会员要加的天数。
 *
 * 这是**唯一**的时长来源：`lib/subscription` 的 activateSubscription 用它算
 * `expires_at`。此前这个映射写在 subscription.ts 里、价格写在 wechat-pay.ts 里，
 * 加一档就要改两处，很容易漏。
 *
 * 未知档位返回 0（调用方应在此之前就拒绝），终身档返回远期值。
 */
export function planDurationDays(key: string): number {
  const plan = findPlan(key)
  if (!plan) return 0
  if (plan.lifetime) return LIFETIME_DURATION_DAYS
  return plan.durationDays ?? 0
}

/** 历史命名：数据库 enum 与旧代码把终身档叫 `partner`。 */
export const LIFETIME_PLAN_KEY: PlanKey = "partner"

/**
 * 会员档位 + 两种**非付费态**：`trial`（体验会员）与 `free`（免费用户）。
 *
 * 这个类型此前在 5 个文件里各声明了一份（membership 页、SettingsClient、
 * ExpiryWarningModal、ExpiryBanner、UserActions）。加季度档时必然漏改其中几个，
 * 而漏改的表现是"某个页面显示空白徽章"这种很难归因的问题 —— 所以收敛到这里。
 * 与 `subscriptions.plan` 的取值对齐（含 quarterly）。
 */
export type MemberTier = PlanKey | "trial" | "free"

/** 会员档位的中文名（含非付费态）。非付费态不在 PLANS 里，单独给。 */
export function memberTierLabel(tier: string): string {
  if (tier === "trial") return "体验会员"
  if (tier === "free") return "普通用户"
  return findPlan(tier)?.label ?? tier
}

/** 全部档位 key，供校验入参用。 */
export const PLAN_KEYS: readonly PlanKey[] = PLANS.map((p) => p.key)

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && PLANS.some((p) => p.key === value)
}

export function findPlan(key: string): PlanSpec | null {
  return PLANS.find((p) => p.key === key) ?? null
}

/**
 * 下单金额（分）。
 *
 * `isFirstPurchase` **必须由服务端**根据「该用户是否已有已支付订单」推导，
 * 绝不接受客户端传入 —— 那等于把定价权交给浏览器。
 *
 * 未知档位返回 null，由调用方拒绝，而不是回落到某个默认价。
 */
export function planAmount(key: string, isFirstPurchase: boolean): number | null {
  const plan = findPlan(key)
  if (!plan) return null
  return isFirstPurchase ? plan.firstAmount : plan.standardAmount
}

/** 原价与首期价的差额（分），用于「立减 ¥X」文案。 */
export function planDiscount(key: string): number {
  const plan = findPlan(key)
  if (!plan) return 0
  return plan.standardAmount - plan.firstAmount
}

/** 分 → 「¥29」。本项目定价全部是整元，非整元时保留两位小数。 */
export function formatYuan(amountInCents: number): string {
  const yuan = amountInCents / 100
  return `¥${Number.isInteger(yuan) ? yuan : yuan.toFixed(2)}`
}

/**
 * 档位的计价单位后缀：`/月` `/季` `/年`，终身档为 `终身`。
 *
 * 放在这里而不是各页面自己写：首页、价格页、结算弹窗都要用同一个后缀，
 * 否则「/月」和「每月」这种小差异会散开成三份。
 */
export function planPeriodSuffix(key: string): string {
  const plan = findPlan(key)
  if (!plan) return ""
  if (plan.lifetime) return "终身"
  if (plan.months === 1) return "/月"
  if (plan.months === 3) return "/季"
  return "/年"
}

/**
 * 「首期优惠 + 标准价」的一句话说明，用于卡片描述。
 *
 * **这句话是合规必需，不是文案装饰。** 首期优惠只在首次购买时生效，
 * 之后按标准价收费 —— 用户必须在买之前就知道这件事；同时它也把
 * 「标准价是真实成交价」这件事写在了明面上（非虚构原价的免责依据）。
 *
 * 措辞分档：订阅档写「续费」，终身档没有续费这回事，写「老用户」。
 */
export function planPriceNote(key: string): string {
  const plan = findPlan(key)
  if (!plan) return ""
  if (plan.lifetime) {
    return `新用户首期优惠 · 老用户 ${formatYuan(plan.standardAmount)}`
  }
  return `新用户首期优惠 · 续费 ${formatYuan(plan.standardAmount)}${planPeriodSuffix(key)}`
}

/** 首期优惠省下的金额文案，例如「省 ¥100」。 */
export function planSaveNote(key: string): string {
  return `省 ${formatYuan(planDiscount(key))}`
}
