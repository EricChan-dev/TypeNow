"use client"

import {
  VISITOR_COOKIE,
  VISITOR_MAX_AGE_DAYS,
  newVisitorId,
  parseVisitorId,
} from "@/lib/visitor"

let sessionId = ""
let visitorId: string | null = null

function getSessionId(): string {
  if (typeof window === "undefined") return ""
  if (!sessionId) {
    sessionId = sessionStorage.getItem("_typ_sid") || ""
    if (!sessionId) {
      sessionId = crypto.randomUUID()
      sessionStorage.setItem("_typ_sid", sessionId)
    }
  }
  return sessionId
}

/** 读 cookie。只用一次 split，避免正则带来的转义歧义 */
function readCookie(name: string): string | null {
  const prefix = `${name}=`
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return part.slice(prefix.length)
  }
  return null
}

/**
 * 拿到（必要时创建）本浏览器的长期 visitor id。
 *
 * 为什么要有它、以及为什么不能用 sessionId 代替：见 lib/visitor.ts 文件头。
 * 一句话是 —— sessionId 活在 sessionStorage 里，关标签页就没了，
 * 匿名事件因此数不出"人"，也没法与之后的注册串起来。
 *
 * 写 cookie 失败（隐私模式）不抛出：埋点是旁路，这次不带 visitor id 也要照常上报，
 * 服务端会存 NULL，报表按 session_id 降级统计。
 */
function getVisitorId(): string | null {
  if (typeof window === "undefined") return null
  if (visitorId) return visitorId

  try {
    const existing = parseVisitorId(readCookie(VISITOR_COOKIE))
    if (existing) {
      visitorId = existing
      return visitorId
    }

    const created = newVisitorId()
    const maxAge = VISITOR_MAX_AGE_DAYS * 24 * 60 * 60
    // SameSite=Lax：从外部链接（含微信）跳进来时要能读到同一个 visitor
    // 不加 Secure：本地 http 调试也要能写上（生产是 https，加上会让 e2e 失效）
    document.cookie = `${VISITOR_COOKIE}=${created}; path=/; max-age=${maxAge}; SameSite=Lax`
    // 只有确认写得进去才认这个值；写不进去下次再试，而不是让内存与 cookie 长期不一致
    visitorId = parseVisitorId(readCookie(VISITOR_COOKIE))
    return visitorId
  } catch {
    return null
  }
}

export function track(
  event: string,
  properties?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return

  try {
    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        properties: properties || {},
        pageUrl: window.location.pathname,
        sessionId: getSessionId(),
        visitorId: getVisitorId(),
      }),
      keepalive: true,
    })
  } catch {
    // silently fail - analytics should never break the app
  }
}

export function trackPageView(): void {
  track("page_view", {
    referrer: typeof document !== "undefined" ? document.referrer : "",
  })
}

export function trackClick(element: string, extra?: Record<string, unknown>) {
  track("click", { element, ...extra })
}

export function trackPracticeComplete(
  score: number,
  sentenceCount: number,
  scene?: string
) {
  track("practice_complete", { score, sentences_count: sentenceCount, scene })
}

export function trackSubscribeClick(plan: string, fromPage: string) {
  track("click_subscribe", { plan, from_page: fromPage })
}

export function trackSubscribeSuccess(plan: string, amount: number) {
  track("subscribe_pay_success", { plan, amount })
}

export function trackLoginSuccess(method: "phone" | "wechat") {
  track("login_success", { method })
}

export function trackThemeToggle(theme: string) {
  track("theme_toggle", { theme })
}

// ─── 首启漏斗（见 src/lib/analytics-events 的 FUNNEL_STEPS） ──────────────────
//
// 这几个事件此前**只有 helper 定义、没有任何调用点**，所以线上
// /admin/analytics 的「热门页面」永远是空的。现在接上真实调用。
//
// 注意这里**没有** register_success：注册这件事只有服务端知道（渠道、微信 scene、
// 首触来源都在服务端那一步），所以它由 lib/analytics-server.ts 在建号时写入，
// 不走这个客户端 helper。数量以 users 表为权威，事件只补渠道与时序。

/** 打开课程详情页。这是「注册了但没开始学」的第一个分界点。 */
export function trackCourseOpen(courseId: string) {
  track("course_open", { courseId })
}

/** 进入练习页（开始练某一课时）。 */
export function trackLessonStart(courseId: string, lessonId: string) {
  track("lesson_start", { courseId, lessonId })
}

/** 试学墙出现（非会员练完免费句数）。reason 区分触发场景。 */
export function trackPaywallShown(reason: "trial_end" | "trial_available") {
  track("paywall_shown", { reason })
}

/** 领取体验会员成功。 */
export function trackTrialClaimed(days: number) {
  track("trial_claimed", { days })
}

/** 看过定价页。 */
export function trackPricingView() {
  track("pricing_view", {})
}
