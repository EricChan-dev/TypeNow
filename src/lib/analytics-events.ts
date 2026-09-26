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
