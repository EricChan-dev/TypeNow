/**
 * 埋点事件清单与漏斗定义的**单一来源**。
 *
 * 为什么要有这个模块：事件名此前散在三处 —— 前端 helper（lib/analytics.ts）、
 * 后端白名单（api/analytics/track 里的 ALLOWED_EVENTS）、后台报表里的筛选条件。
 * 三处各写一遍，加一个事件就要改三处，漏掉任何一处都会静默丢数据
 * （前端发了、后端白名单拒绝，或者报表永远查不到）。收敛到这里之后，
 * 两端都 import 本模块，新增事件只改一个地方。
 *
 * 纯模块、无任何服务端依赖：客户端组件与 API 路由都要用它。
 */

/** 允许上报的事件名（后端白名单，防灌库）。 */
export const ALLOWED_EVENTS = [
  // 流量
  "page_view",
  "click",
  "theme_toggle",
  // 账号
  "login_success",
  "register_success",
  // 学习
  "course_open",
  "lesson_start",
  "practice_complete",
  // 付费
  "paywall_shown",
  "trial_claimed",
  "pricing_view",
  "click_subscribe",
  "subscribe_pay_success",
] as const

export type AnalyticsEvent = (typeof ALLOWED_EVENTS)[number]

const ALLOWED = new Set<string>(ALLOWED_EVENTS)

/** 事件名是否被允许（后端上报接口用）。 */
export function isAllowedEvent(event: unknown): event is AnalyticsEvent {
  return typeof event === "string" && ALLOWED.has(event)
}

// ─── 事件字典 ────────────────────────────────────────────────────────────────

/**
 * 事件分类。决定埋点分析页里的分组展示顺序，也提示「这个数该去哪张报表看」。
 *   traffic  流量  —— 有多少人来、看了什么
 *   account  账号  —— 注册与登录
 *   learning 学习  —— 内容消费，漏斗中段
 *   payment  付费  —— 变现路径
 */
export const EVENT_CATEGORIES = ["traffic", "account", "learning", "payment"] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  traffic: "流量",
  account: "账号",
  learning: "学习",
  payment: "付费",
}

export interface EventMeta {
  /** 中文名，报表和图例里显示这个，不显示 event_type 原文。 */
  label: string
  category: EventCategory
  /** 这个事件回答什么问题。运营看字典时最需要的其实是这句话。 */
  description: string
  /** properties 里会出现哪些 key（自由 JSON，这里只做提示，不校验）。 */
  props: string[]
}

/**
 * 每个事件的中文说明。类型写成 `Record<AnalyticsEvent, EventMeta>` 而不是
 * `Partial<Record<...>>` 是刻意的：往 ALLOWED_EVENTS 里加一个事件却忘了补
 * 文档，tsc 会直接报错。字典与白名单脱节是这类系统最常见的腐化方式
 * （上线半年后没人知道 `trial_claimed` 和 `paywall_shown` 差在哪）。
 *
 * 注意 register_success 虽然在白名单里但没有任何调用点 —— 注册以 users 表
 * 为准（见 lib/analytics.ts 的说明），保留它只为兼容可能的历史数据。
 */
export const EVENT_META: Record<AnalyticsEvent, EventMeta> = {
  page_view: {
    label: "页面浏览",
    category: "traffic",
    description: "每次进入一个路由页面上报一次。是「有多少人来过」的底数。",
    props: ["referrer"],
  },
  click: {
    label: "点击",
    category: "traffic",
    description: "关键按钮点击。properties.element 是被点元素的标识。",
    props: ["element"],
  },
  theme_toggle: {
    label: "切换主题",
    category: "traffic",
    description: "深色/浅色切换。纯偏好类埋点，目前是量最大的一类。",
    props: ["theme"],
  },
  login_success: {
    label: "登录成功",
    category: "account",
    description: "手机号或微信登录成功。method 区分渠道。",
    props: ["method"],
  },
  register_success: {
    label: "注册成功",
    category: "account",
    description: "保留事件。注册以 users 表为权威数据，前端目前不上报。",
    props: [],
  },
  course_open: {
    label: "打开课程",
    category: "learning",
    description: "进入课程详情页。漏斗里「注册了但没开始学」的第一个分界点。",
    props: ["courseId"],
  },
  lesson_start: {
    label: "进入练习",
    category: "learning",
    description: "打开某个课时的练习页。与 course_open 的差值是「看了课但没点进去练」。",
    props: ["courseId", "lessonId"],
  },
  practice_complete: {
    label: "练完一课",
    category: "learning",
    description: "一次练习结束。score 是正确率，sentences_count 是本次句数。",
    props: ["score", "sentences_count", "scene"],
  },
  paywall_shown: {
    label: "出现试学墙",
    category: "payment",
    description: "非会员练完免费句数后弹付费引导。reason 区分是额度用尽还是可领试用。",
    props: ["reason"],
  },
  trial_claimed: {
    label: "领取体验会员",
    category: "payment",
    description: "按手机号一次性领取的注册试用。数据库有 trial_claims 记录，这里看的是行为时机。",
    props: ["days"],
  },
  pricing_view: {
    label: "看过定价页",
    category: "payment",
    description: "进入定价页。比 click_subscribe 更早一步，用来量「看了价但没点买」。",
    props: [],
  },
  click_subscribe: {
    label: "点击购买",
    category: "payment",
    description: "点了某个套餐的购买按钮。plan 是套餐标识，from_page 是来源页。",
    props: ["plan", "from_page"],
  },
  subscribe_pay_success: {
    label: "支付成功",
    category: "payment",
    description:
      "支付回调成功后前端上报。**金额与订单以 payment_orders 为权威**，这里只用于看支付完成的时间点。",
    props: ["plan", "amount"],
  },
}

/** 按分类分组的事件清单，埋点分析页与字典页共用同一份顺序。 */
export function eventsByCategory(): { category: EventCategory; label: string; events: AnalyticsEvent[] }[] {
  return EVENT_CATEGORIES.map((category) => ({
    category,
    label: EVENT_CATEGORY_LABELS[category],
    events: ALLOWED_EVENTS.filter((e) => EVENT_META[e].category === category),
  }))
}

/** 事件的中文名，找不到就退回原文（历史脏数据里可能有已下线的事件名）。 */
export function eventLabel(event: string): string {
  return ALLOWED.has(event) ? EVENT_META[event as AnalyticsEvent].label : event
}

/**
 * 首启漏斗。顺序即用户真实路径，报表按这个顺序展示每一步。
 *
 * 每步标注 `source`，决定数字从哪来：
 *   "db"     —— 权威域数据。埋点会被广告拦截器挡掉或漏发，注册/练习/付费
 *               这三个最关键的数必须来自数据库，不能靠客户端上报。
 *   "events" —— 只有行为埋点能回答的问题（比如「打开了课程但一句没练」）。
 *
 * 这也意味着：即使埋点全丢，前三个数依然准确；反过来若埋点数与 db 数差异巨大，
 * 说明埋点本身有问题，报表会把这个差异显式暴露出来。
 */
export interface FunnelStep {
  key: string
  label: string
  source: "db" | "events"
}

export const FUNNEL_STEPS: FunnelStep[] = [
  { key: "registered", label: "注册", source: "db" },
  { key: "course_open", label: "打开课程", source: "events" },
  { key: "lesson_start", label: "进入练习", source: "events" },
  { key: "practiced", label: "练完至少一句", source: "db" },
  { key: "trial_claimed", label: "领取体验会员", source: "events" },
  { key: "pricing_view", label: "看过定价页", source: "events" },
  { key: "paid", label: "付费", source: "db" },
]
