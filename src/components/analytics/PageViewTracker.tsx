"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { trackPageView, trackPricingView } from "@/lib/analytics"

/**
 * 全局页面浏览埋点。
 *
 * `trackPageView` 这个 helper 从写下来那天起就没有任何调用点，所以线上
 * /admin/analytics 的「热门页面」一直是空表 —— 报表没坏，是没人往上送数。
 *
 * 挂在根 layout 上而不是每个页面里各写一遍：App Router 下 usePathname 变化即触发，
 * 新增页面自动被覆盖，不会出现「新页面忘了埋点」这种静默缺口。
 *
 * 定价页额外单独上报一次 `pricing_view`：漏斗里「看过定价页」是付费前一步，
 * 用独立事件比在报表里按 URL 前缀过滤更稳（pageUrl 里可能带 query）。
 */
export function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname) return
    // 后台是内部工具，不计入用户漏斗
    if (pathname.startsWith("/admin")) return

    trackPageView()
    if (pathname === "/pricing") trackPricingView()
  }, [pathname])

  return null
}
