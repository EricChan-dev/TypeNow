/**
 * 主动触达（生命周期消息）的**纯逻辑**：场景定义、触发窗口、周期键、频控、文案。
 *
 * 设计见 docs/business-model.md §11。本模块刻意不碰数据库、不发网络请求 ——
 * 所有"什么时候该发、能不能发、发什么"的判断都在这里，因此可以完整单测；
 * 真正落库与发送在 lib/notify.ts，扫描入口在 api/internal/lifecycle-scan。
 *
 * ── 三条来自 §11 的硬约束（每条都有原因，不要绕过）────────────────────────
 *
 * ① **模板消息只能发服务通知，禁止营销内容。**
 *    所以文案只陈述事实（「你的体验会员将于 X 到期」+ 该用户自己的学习数字），
 *    转化放在落地页。写错会被驳回，严重时处罚账号接口权限 —— 那整套体系就没了。
 *
 * ② **到达时间不是精确的，是"窗口"。**
 *    扫描每天只跑两次（10:00 / 19:00，见 deploy.sh 的 crontab），所以任何
 *    "到期前 24 小时"之类的条件实际上是一个**区间**。窗口宽度必须大于两次扫描的
 *    最大间隔（19:00 → 次日 10:00 = 15 小时），否则会整批漏发。
 *    每条窗口都按这个下限校过，并有一条单测守着它。
 *
 * ③ **周期键（periodKey）是幂等键的第四列，不能省。**
 *    唯一键是 (user_id, scenario, channel, period_key)。若只有前三列，
 *    年卡用户收到一次「到期前 7 天」并续费后，明年的同一三元组会被唯一键
 *    永久挡住 —— 他再也收不到续费提醒，而且静默无日志。详见 00032 的说明。
 */

import { toShanghaiDateStr } from "@/lib/practice-stats"

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 三个渠道的能力与成本差异见 §11.2。顺序即优先级（先试免费的模板消息）。 */
export type LifecycleChannel = "template" | "customer_service" | "sms"

/** 与 api/auth/me 的 member_tier 同一套取值（partner = 终身会员） */
export type LifecycleTier = "trial" | "monthly" | "quarterly" | "yearly" | "partner"

export type ScenarioPriority = "P0" | "P1" | "P2"

export interface LifecycleScenario {
  /** 场景键，写入 notifications.scenario。改名等于让已发过的记录失效，不要改。 */
  key: string
  label: string
  priority: ScenarioPriority
  /** 适用档位。partner（终身会员）没有到期概念，任何到期类场景都不该包含它。 */
  tiers: LifecycleTier[]
  /** 渠道，按优先级排序；实际发送时用第一个"当前可用"的（见 lib/notify.ts） */
  channels: LifecycleChannel[]
  /**
   * 是否"到期类"。到期类不计入每周上限（§11.5 ④）——
   * 它们对用户有独立价值，且是收入最直接的触点。
   */
  expiryKind: boolean
  /**
   * 触发窗口，单位小时，**相对到期时刻**：负值 = 到期前，正值 = 到期后。
   * 区间为 `(from, to]`（左开右闭），保证相邻窗口不重叠、不会一次扫描命中两条。
   */
  window?: { from: number; to: number }
  /** 模板消息的模板 ID 环境变量名。未配置时该渠道会被跳过（不报错）。 */
  templateIdEnv?: string
}

// ─── 窗口宽度的下限 ──────────────────────────────────────────────────────────

/** 两次扫描的最大间隔：19:00 → 次日 10:00，共 15 小时。 */
export const MAX_SCAN_GAP_HOURS = 15

/**
 * 判断一个窗口是否宽到"必然能被某次扫描命中"。
 *
 * 这不是理论洁癖：窗口若只有 8 小时，而两次扫描相隔 15 小时，就会出现
 * 「到期时间落在两次扫描之间」的用户**永远收不到消息** —— 而且没有任何报错，
 * 只有对比"应触达 vs 实际发出"时才会发现（§11.8 的到期前触达率指标就是查这个）。
 */
export function isWindowWideEnough(window: { from: number; to: number }): boolean {
  return window.to - window.from >= MAX_SCAN_GAP_HOURS
}

// ─── 场景矩阵（§11.3）────────────────────────────────────────────────────────

/**
 * 到期类场景。档位不同、窗口不同，但形状一致，所以用一张表生成。
 *
 * ⚠️ **窗口的符号约定**：`{ from, to }` 的单位是小时、**相对到期时刻**，
 * 且**负值表示还没到期**（与 hoursRelativeToExpiry 一致）：
 *
 *        -168h ......... -24h ...... 0 ...... +36h
 *          |               |         |         |
 *          |← 前 7 天窗口 →|         |         |
 *                          |←前1天→|         |
 *                                    |←已到期→|
 *
 * 所以：
 *   · 「到期前 24h」 → (-24, 0]，24 小时宽
 *   · 「到期前 3 天」 → (-72, -24]，48 小时宽（与前一档不重叠）
 *   · 「到期后 1 天」 → (0, 36]，36 小时宽
 *
 * 每段都要满足 isWindowWideEnough（≥15 小时，即两次扫描的最大间隔），
 * 否则"到期时刻落在两次扫描之间"的用户会永远收不到消息且毫无报错。
 */
export const LIFECYCLE_SCENARIOS: readonly LifecycleScenario[] = [
  // ── P0：体验会员（首购转化的单一最高价值触点）────────────────────────────
  {
    key: "trial_expiring_24h",
    label: "体验会员即将到期",
    priority: "P0",
    tiers: ["trial"],
    // §11.3：模板 + 客服。客服消息只在 48h 窗口内可用，所以先模板兜底。
    channels: ["template", "customer_service"],
    expiryKind: true,
    window: { from: -24, to: 0 },
    templateIdEnv: "WECHAT_TEMPLATE_TRIAL_EXPIRING",
  },
  {
    key: "trial_expired_1d",
    label: "体验会员已到期",
    priority: "P0",
    tiers: ["trial"],
    channels: ["template"],
    expiryKind: true,
    window: { from: 0, to: 36 },
    templateIdEnv: "WECHAT_TEMPLATE_TRIAL_EXPIRED",
  },

  // ── P0：月卡 / 季卡（续费）────────────────────────────────────────────────
  // 季卡是后来加的档位，§11.3 的矩阵里没有它。它的时长（90 天）与月卡不是同一量级，
  // 但"提前 3 天 + 提前 1 天"这个节奏对两者都合适，所以与月卡共用窗口。
  {
    key: "monthly_expiring_3d",
    label: "月卡即将到期（前 3 天）",
    priority: "P0",
    tiers: ["monthly", "quarterly"],
    channels: ["template"],
    expiryKind: true,
    window: { from: -72, to: -24 },
    templateIdEnv: "WECHAT_TEMPLATE_MONTHLY_EXPIRING",
  },
  {
    key: "monthly_expiring_1d",
    label: "月卡即将到期（前 1 天）",
    priority: "P0",
    tiers: ["monthly", "quarterly"],
    channels: ["template"],
    expiryKind: true,
    window: { from: -24, to: 0 },
    templateIdEnv: "WECHAT_TEMPLATE_MONTHLY_EXPIRING",
  },

  // ── P0：年卡（最值钱的续费，更早、更用心 —— 加短信）──────────────────────
  {
    key: "yearly_expiring_7d",
    label: "年卡即将到期（前 7 天）",
    priority: "P0",
    tiers: ["yearly"],
    channels: ["template", "sms"],
    expiryKind: true,
    window: { from: -168, to: -24 },
    templateIdEnv: "WECHAT_TEMPLATE_YEARLY_EXPIRING",
  },
  {
    key: "yearly_expiring_1d",
    label: "年卡即将到期（前 1 天）",
    priority: "P0",
    tiers: ["yearly"],
    channels: ["template", "sms"],
    expiryKind: true,
    window: { from: -24, to: 0 },
    templateIdEnv: "WECHAT_TEMPLATE_YEARLY_EXPIRING",
  },
  {
    key: "yearly_expired_1d",
    label: "年卡已到期",
    priority: "P0",
    tiers: ["yearly"],
    channels: ["template", "sms"],
    expiryKind: true,
    window: { from: 0, to: 36 },
    templateIdEnv: "WECHAT_TEMPLATE_YEARLY_EXPIRED",
  },

  // ── P1：领了体验会员却没开始练 ────────────────────────────────────────────
  //
  // §11.3 特别点出这一条：客服消息的 48 小时窗口**正好**覆盖「刚领体验会员、
  // 还没开始练」这个最该被推一把的时刻，而且免费、无需模板审核、代码已具备。
  // 它是整个体系里最容易先落地的一块。
  //
  // 它没有 window（不依赖到期时刻），由扫描路由按"领取后 24~48h 且 0 练习"挑选。
  {
    key: "trial_claimed_no_practice",
    label: "领了体验会员但未练习",
    priority: "P1",
    tiers: ["trial", "monthly", "quarterly", "yearly", "partner"],
    channels: ["customer_service"],
    expiryKind: false,
  },

  // ── P1：注册了但没领体验会员 ──────────────────────────────────────────────
  //
  // 同样没有 window：扫描路由按"注册后 24~48h 且从未领过体验会员"挑选。
  {
    key: "registered_no_trial",
    label: "注册后未领取体验会员",
    priority: "P1",
    tiers: ["trial", "monthly", "quarterly", "yearly", "partner"],
    channels: ["template"],
    expiryKind: false,
    templateIdEnv: "WECHAT_TEMPLATE_REGISTERED_NO_TRIAL",
  },
] as const

/** 只取带 window 的到期类场景（扫描路由按到期时刻挑选候选用户时用） */
export const EXPIRY_SCENARIOS: readonly LifecycleScenario[] = LIFECYCLE_SCENARIOS.filter(
  (s) => s.window !== undefined,
)

export function findScenario(key: string): LifecycleScenario | undefined {
  return LIFECYCLE_SCENARIOS.find((s) => s.key === key)
}

/** 全部场景键。用于单测与文档校对（新增场景时不必手抄一遍）。 */
export const SCENARIO_KEYS: readonly string[] = LIFECYCLE_SCENARIOS.map((s) => s.key)

// ─── 到期类场景的判定 ────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000

/**
 * 相对到期时刻的小时数：**负 = 还没到期**，正 = 已过期。
 *
 * 边界语义与 window 的 `(from, to]` 对齐。
 */
export function hoursRelativeToExpiry(expiry: Date, now: Date): number {
  return (now.getTime() - expiry.getTime()) / HOUR_MS
}

/**
 * 给定「当前时间 / 到期时刻 / 档位」，算出该发哪些到期类场景。
 *
 * 返回结果按 §11 的优先级排序（P0 在前、到期前消息在到期后消息之前），
 * 因为扫描路由是**顺序发送**的：先发价值最高的，若后面触发了频控也不会挤掉它。
 *
 * 注意它**不检查幂等与频控** —— 那些需要查库，在 lib/notify.ts 里做。
 * 这里只回答"按时间与档位，现在理论上该不该发"。
 */
export function computeDueExpiryScenarios(params: {
  now: Date
  expiry: Date
  tier: LifecycleTier
}): LifecycleScenario[] {
  const { now, expiry, tier } = params

  // 终身会员没有到期时刻。传进来也一律不发 —— 这是最后一道防线，
  // 因为"给终身会员发续费提醒"是最容易写错、也最伤信任的一种 bug。
  if (tier === "partner") return []

  const hours = hoursRelativeToExpiry(expiry, now)

  return EXPIRY_SCENARIOS.filter((s) => {
    if (!s.tiers.includes(tier)) return false
    const w = s.window!
    return hours > w.from && hours <= w.to
  }).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1
    // 同为 P0 时，"即将到期"优先于"已到期"：前者的转化价值更高
    const af = a.window!.to <= 0 ? 0 : 1
    const bf = b.window!.to <= 0 ? 0 : 1
    return af - bf
  })
}

/**
 * 到期类场景的周期键 = 到期日（上海日历日）。
 *
 * 用日期而不是完整时间戳：同一次会员周期内重复扫描得到同一个键（幂等），
 * 而续费后到期日变了，键也就变了（不会误挡）。
 */
export function expiryPeriodKey(expiry: Date): string {
  return toShanghaiDateStr(expiry)
}

/** 每日类场景的周期键 = 当日（上海日历日）。 */
export function dailyPeriodKey(now: Date): string {
  return toShanghaiDateStr(now)
}

/**
 * 一次性场景（如「领了体验会员却没练」）的周期键：空串。
 * 这类消息一辈子只该发一次，所以不需要周期维度。
 */
export const ONE_SHOT_PERIOD_KEY = ""

// ─── 频次上限（§11.5 ④）─────────────────────────────────────────────────────

export const FREQUENCY = {
  /** 每人每周最多主动消息数。**不含到期类。** */
  maxPerWeek: 2,
  /** 两条主动消息之间的最小间隔（小时）。到期类可插队，见 decideSend。 */
  cooldownHours: 24,
  /** 周上限的统计窗口（天） */
  windowDays: 7,
} as const

export type SendDecision =
  | { allowed: true }
  | { allowed: false; reason: "weekly_cap" | "cooldown" }

/**
 * 频控判定（纯函数，输入是已经查好的计数）。
 *
 * 规则与理由：
 *   · **到期类不受周上限约束**（§11.5 ④ 明确写了）。它们对用户有独立价值，
 *     而且「会员要到期了」这条信息被"这周已经发过 2 条"挡掉，是最亏的一种省。
 *   · 但到期类**仍受 24h 冷却**约束：避免"未练习提醒"和"到期提醒"同一天砸两条。
 *   · 非到期类：既要周上限，也要冷却。
 *
 * 到期类之所以能"插队"而不是被冷却挡死，是因为扫描路由**按优先级顺序处理**：
 * 到期类先发，冷却随即生效并挡住后面的非到期类。顺序反了就会丢掉最值钱的那条。
 */
export function decideSend(params: {
  isExpiryKind: boolean
  /** 过去 FREQUENCY.windowDays 天内发给该用户的**非到期类**条数 */
  nonExpirySentInWindow: number
  /** 上一次任意主动消息的发送时刻；从未发过传 null */
  lastSentAt: Date | null
  now: Date
}): SendDecision {
  const { isExpiryKind, nonExpirySentInWindow, lastSentAt, now } = params

  if (lastSentAt) {
    const hoursSince = (now.getTime() - lastSentAt.getTime()) / HOUR_MS
    if (hoursSince < FREQUENCY.cooldownHours) return { allowed: false, reason: "cooldown" }
  }

  if (!isExpiryKind && nonExpirySentInWindow >= FREQUENCY.maxPerWeek) {
    return { allowed: false, reason: "weekly_cap" }
  }

  return { allowed: true }
}

// ─── 文案（§11.4：模板消息只陈述事实）────────────────────────────────────────

/**
 * ⚠️ **`templateData` 的键名必须与微信公众号后台申请到的模板字段完全一致**，
 * 否则发送会因参数不匹配被驳回（错误码 40037 一类），而且是在**用户该收到提醒的那一刻**
 * 才发现 —— 模板申请本身要等 1~3 天，字段名写错等于白等一轮。
 *
 * 所以这里一律用微信的惯例字段名：`first` / `keyword1` / `keyword2` / `keyword3` / `remark`。
 * 申请模板时按这些名字去对（见 docs/business-model.md §11.6 的申请清单）：
 *
 *     到期类模板（3 个关键词 + 首尾）：
 *       first    你的{会员类型}将于 {到期日} 到期
 *       keyword1 会员类型
 *       keyword2 到期时间
 *       keyword3 学习记录（已练习 N 句 · 待复习错句 M 个）
 *       remark   点击查看你的学习报告
 *
 *     注册未领体验模板：
 *       first    你已注册 TypeNow
 *       keyword1 体验会员未领取
 *       remark   点击领取体验会员
 *
 * 同一个 `templateIdEnv` 被多个场景复用时（如月卡的前 3 天与前 1 天），
 * 它们的字段集合必须相同 —— 有一条单测守着这件事。
 */

/** 构建消息时需要的用户上下文。数字都来自调用方（真实查询结果），不在这里编。 */
export interface MessageContext {
  scenario: LifecycleScenario
  nickname?: string | null
  /** 到期时刻（到期类场景必填） */
  expiry?: Date
  /** 该用户已练习的句子数 */
  practicedSentences: number
  /** 待复习的错句数 */
  pendingReview: number
  /** 会员档位的中文名，如「体验会员」 */
  tierLabel: string
}

export interface BuiltMessage {
  title: string
  /** 纯文本正文，用于客服消息与短信 */
  body: string
  /**
   * 模板消息的变量。键名必须与公众号后台申请的模板字段一致 ——
   * 申请模板时要按这些键去申请，否则发送会因字段不匹配被驳回。
   */
  templateData: Record<string, string>
}

/** 日期格式化成 §11.4 举例的样子：2026-09-30 */
function formatExpiry(d: Date): string {
  return toShanghaiDateStr(d)
}

/**
 * 到期类模板的数据。
 *
 * ⚠️ `first` 的时态**必须跟着场景走**：「即将到期」用"将于"、「已到期」用"已于"。
 * 给一个会员已经过期的用户发"你的年度会员将于 9月30日 到期"是明显的错话 ——
 * 而这句话恰好出现在通知的第一行。
 */
function expiryTemplateData(
  tierLabel: string,
  expiryStr: string,
  stats: string,
  alreadyExpired: boolean,
): Record<string, string> {
  return {
    first: alreadyExpired
      ? `你的${tierLabel}已于 ${expiryStr} 到期`
      : `你的${tierLabel}将于 ${expiryStr} 到期`,
    keyword1: tierLabel,
    keyword2: expiryStr,
    keyword3: stats,
    remark: "点击查看你的学习报告",
  }
}

/**
 * 生成消息内容。
 *
 * ⚠️ **只能写服务事实**，不要出现「优惠」「立减」「限时」「最后机会」等营销词：
 * 模板消息禁止营销内容，违反会被驳回甚至处罚接口权限（§11.4 / §11.7）。
 * 转化设计放在站内的到期挽留页，消息只负责把人带过去。
 *
 * 三条到期消息都带上**该用户自己的数字**（练了多少句、多少错句待复习）：
 * 模板消息支持变量，带个性化数字的打开率远高于通用文案，而且它属于"服务事实"，
 * 合规与转化两头都对（§11.4）。
 */
/**
 * 学习记录的摘要文案。微信与短信共用，只在排版上区分。
 *
 * ⚠️ **练了 0 句时不能说"已练习 0 句"**。这个分支不是凑数的：
 * 「领了体验会员但一次都没练」正是 §11.1 列为 P1 的那批人，流失率最高，
 * 而这句话是他们收到的**唯一一句关于他们自己的话** —— 既没有信息量，
 * 读起来又像指责（"你什么都没做"）。改成中性的"尚未开始练习"。
 *
 * 短信里不加空格：一条短信按 70 字计费，空格也是钱，而且中文里
 * "已练习47句"比"已练习 47 句"更自然。
 */
export function practiceSummary(
  practiced: number,
  pending: number,
  style: "wechat" | "sms",
): string {
  if (practiced <= 0) return "尚未开始练习"
  if (style === "sms") return `已练习${practiced}句`
  // 待复习为 0 时不要再写"待复习错句 0 个" —— 那是一句没有内容的填充
  return pending > 0
    ? `已练习 ${practiced} 句 · 待复习错句 ${pending} 个`
    : `已练习 ${practiced} 句`
}

export function buildMessage(ctx: MessageContext): BuiltMessage {
  const { scenario, practicedSentences, pendingReview, tierLabel } = ctx
  const expiryStr = ctx.expiry ? formatExpiry(ctx.expiry) : ""
  const stats = practiceSummary(practicedSentences, pendingReview, "wechat")

  switch (scenario.key) {
    case "trial_expiring_24h":
      return {
        title: "体验会员即将到期",
        body:
          `你的${tierLabel}将于 ${expiryStr} 到期。\n` +
          `学习记录：${stats}\n` +
          `到期后复习队列与历史记录会保留，但需要会员才能继续练习完整课程。`,
        templateData: expiryTemplateData(tierLabel, expiryStr, stats, false),
      }

    case "trial_expired_1d":
      return {
        title: "体验会员已到期",
        body:
          `你的${tierLabel}已于 ${expiryStr} 到期。\n` +
          `学习记录：${stats}\n` +
          `记录都还在。继续练习可以随时开通会员。`,
        templateData: expiryTemplateData(tierLabel, expiryStr, stats, true),
      }

    case "monthly_expiring_3d":
    case "monthly_expiring_1d":
    case "yearly_expiring_7d":
    case "yearly_expiring_1d":
      return {
        title: "会员即将到期",
        body:
          `你的${tierLabel}将于 ${expiryStr} 到期。\n` +
          `学习记录：${stats}\n` +
          `到期后需要续费才能继续练习完整课程。`,
        templateData: expiryTemplateData(tierLabel, expiryStr, stats, false),
      }

    case "yearly_expired_1d":
      return {
        title: "会员已到期",
        body:
          `你的${tierLabel}已于 ${expiryStr} 到期。\n` +
          `学习记录：${stats}\n` +
          `记录都还在。继续练习可以随时续费。`,
        templateData: expiryTemplateData(tierLabel, expiryStr, stats, true),
      }

    case "trial_claimed_no_practice":
      // 这条走客服消息，没有模板审核限制，但仍只谈服务：
      // 告诉对方"怎么开始"，而不是"快来买"。
      return {
        title: "开始你的第一次练习",
        body:
          `你已领取${tierLabel}，还没有开始练习。\n` +
          `打开 TypeNow 选一课，练 5 句就能看到学习记录与错句复习队列。`,
        templateData: {},
      }

    case "registered_no_trial":
      return {
        title: "你还有一份体验会员未领取",
        body:
          `你已注册 TypeNow，还有一份${"体验会员"}未领取。\n` +
          `领取后可以练习完整课程，并生成学习记录与错句复习队列。`,
        templateData: {
          first: "你已注册 TypeNow",
          keyword1: "体验会员未领取",
          remark: "点击领取体验会员",
        },
      }

    default:
      // 新增场景忘了写文案时，宁可抛错也不发一条空消息出去
      throw new Error(`[lifecycle] 场景 ${scenario.key} 没有对应文案`)
  }
}

// ─── 退订 ────────────────────────────────────────────────────────────────────

/**
 * 退订判定。**所有发送路径的入口都必须调用它**（§11.5 ⑤）。
 *
 * 单独抽出来是为了让它可单测、且只有一个实现：退订一旦能被绕过，
 * 后果是用户投诉 + 公众号接口权限风险，那是整套体系里最贵的失败模式。
 */
export function isOptedOut(optOutAt: Date | null | undefined): boolean {
  return optOutAt != null
}

/**
 * 短信退订提示的标准写法。
 *
 * ⚠️ **它必须写在「申请短信模板时的模板正文」里，不能由代码拼接。**
 * 模板短信的参数是固定的，代码多塞一段文字会直接发送失败。
 * 这个常量存在的意义是给申请模板的人一个统一字样（§11.7 法规要求），
 * 避免三个模板写出三种退订词。
 *
 * 参见 lib/aliyun-sms.ts 的 sendNotificationSms 注释。
 */
export const SMS_OPT_OUT_SUFFIX = "回T退订"
