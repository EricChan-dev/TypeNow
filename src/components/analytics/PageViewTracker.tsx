"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { trackPageView, trackPricingView } from "@/lib/analytics"
import {
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE_DAYS,
  buildFirstTouch,
  serializeFirstTouch,
} from "@/lib/first-touch"

/**
 * 全局页面浏览埋点 + 首次接触归因。
 *
 * `trackPageView` 这个 helper 从写下来那天起就没有任何调用点，所以线上
 * /admin/analytics 的「热门页面」一直是空表 —— 报表没坏，是没人往上送数。
 *
 * 挂在根 layout 上而不是每个页面里各写一遍：App Router 下 usePathname 变化即触发，
 * 新增页面自动被覆盖，不会出现「新页面忘了埋点」这种静默缺口。
 *
 * 定价页额外单独上报一次 `pricing_view`：漏斗里「看过定价页」是付费前一步，
 * 用独立事件比在报表里按 URL 前缀过滤更稳（pageUrl 里可能带 query）。
 *
 * ── 首触归因（2026-09-28 补）────────────────────────────────────────────────
 * 为什么放在这里：注册永远发生在 /login，那一刻服务端拿到的 Referer 是
 * **我们自己**（`https://typenow.cn/login`）或微信授权页，存下来等于没存。
 * 有信息量的是"这个人第一次带着外部来源进来"的那一瞬间，而那个信息只在
 * 落地页这一次请求里出现。所以在这里读 `document.referrer` 与来源参数，
 * 写进一个长期 cookie，注册时由服务端读出落库（见 lib/first-touch.ts）。
 *
 * 两个容易写错的地方：
 *   1. **只在 cookie 不存在时写**。首触的定义就是"第一次"；后覆盖前会让
 *      各渠道的贡献变成"用户回访习惯"的函数，而不是渠道质量。
 *   2. 不能 HttpOnly（要让 JS 写），也不能只在登录页写 —— 首触可能发生在
 *      任何落地页（从搜索引擎进来往往先落到 / 或 /pricing）。
 */
export function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname) return
    // 后台是内部工具，不计入用户漏斗
    if (pathname.startsWith("/admin")) return

    trackPageView()
    if (pathname === "/pricing") trackPricingView()
    captureFirstTouch()
  }, [pathname])

  return null
}

/**
 * 写首触 cookie。**只在不存在时写**（见上面第 1 点）。
 *
 * 用 document.cookie 而不是 Cookie Store API：后者在 Safari 上支持不全，
 * 而这里只需要写一个值。
 */
function captureFirstTouch(): void {
  try {
    if (typeof document === "undefined") return
    if (document.cookie.includes(`${FIRST_TOUCH_COOKIE}=`)) return

    const ft = buildFirstTouch({
      referrer: document.referrer || "",
      search: window.location.search || "",
      pathname: window.location.pathname || "/",
      host: window.location.host || "",
    })

    const maxAge = FIRST_TOUCH_MAX_AGE_DAYS * 24 * 60 * 60
    // SameSite=Lax：从外部链接（含微信）跳进来时也要能写上
    document.cookie = `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(
      serializeFirstTouch(ft),
    )}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch {
    // 归因是旁路：写不进去也不能影响页面（隐私模式下 document.cookie 可能抛错）
  }
}
