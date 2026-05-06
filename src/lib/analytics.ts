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
