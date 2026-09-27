/**
 * 从请求头里取「这次请求是谁、从哪来」的三个基础字段。
 *
 * 单独成模块的理由与 admin-audit-labels 一样：**纯模块、无服务端依赖**，
 * 因此既能被 API 路由用，也能被单测直接覆盖。同时也是为了只有一份实现 ——
 * 注册归因（lib/signup-source.ts）与后台审计（lib/admin-audit.ts）都要取 IP，
 * 各写一遍就会出现"审计日志里记的是 x-forwarded-for 第一段、注册来源里记的是
 * x-real-ip"这种同一台机器两个答案的情况。
 *
 * ⚠️ 这三个值**都来自客户端可伪造的请求头**，只用于归因与展示，
 * 绝不能拿来做任何权限判断（IP 白名单、限流档位这类要另想办法）。
 */

/** IPv6 映射写法（::ffff:127.0.0.1）在报表里很难看，归一成 IPv4 */
function normalizeIp(ip: string): string {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  return v4 ? v4[1] : ip
}

/**
 * 取真实客户端 IP。
 *
 * 经过 nginx，x-forwarded-for 是「客户端, 代理1, 代理2…」，
 * **第一段才是原始来源**，最后一段永远是本机代理。
 */
export function clientIpOf(req: Request | null | undefined): string | null {
  if (!req) return null
  const h = req.headers
  const xff = h.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return normalizeIp(first)
  }
  const real = h.get("x-real-ip")
  return real ? normalizeIp(real.trim()) : null
}

/**
 * 注册/请求发生时的 Referer。
 *
 * ⚠️ 注意它在注册场景里**通常没有归因价值**：注册总发生在 /login，
 * 那一刻的 Referer 是我们自己（`https://typenow.cn/login`）或微信授权页。
 * 真正有信息量的是首触来源，见 lib/first-touch.ts。
 * 这里存下来是为了排查"这次请求到底由哪个页面发起"。
 */
export function referrerOf(req: Request | null | undefined): string | null {
  if (!req) return null
  return req.headers.get("referer") ?? null
}

export function userAgentOf(req: Request | null | undefined): string | null {
  if (!req) return null
  return req.headers.get("user-agent") ?? null
}

/**
 * 判断 Referer 是不是「外部」来源（即不是我们自己站的页面）。
 *
 * 用于首触归因：只有外部来源才值得记成"这个人是从哪来的"，
 * 站内跳转（/ → /login）不构成一次新来源。
 * host 由调用方传入（客户端传 location.host），保持本函数纯净可测。
 */
export function isExternalReferrer(referrer: string | null | undefined, host: string): boolean {
  if (!referrer) return false
  try {
    const ref = new URL(referrer)
    if (!/^https?:$/.test(ref.protocol)) return false
    const refHost = ref.hostname.toLowerCase().replace(/^www\./, "")
    const selfHost = (host || "").toLowerCase().replace(/^www\./, "").split(":")[0]
    return refHost !== selfHost
  } catch {
    return false
  }
}

/** 截断到列宽：超长会让 INSERT 抛错，而这类旁路信息不值得让业务跟着失败 */
export function truncateMeta(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null
  const s = String(value)
  if (!s) return null
  return s.length <= max ? s : s.slice(0, max - 1) + "…"
}
