"use client"

let sessionId = ""

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
// 注意这里**没有** register_success：注册这件事 users 表本身就是权威数据
// （method 看 phone/wechat_openid，是否受邀看 referred_by），不需要客户端再报一遍。
// 只有「客户端才知道、数据库里没有」的动作才值得埋点。

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
