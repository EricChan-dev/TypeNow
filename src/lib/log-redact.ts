/**
 * 日志脱敏。
 *
 * 为什么需要它：日志是排查问题的第一现场，但它也是最容易把个人标识与凭据
 * 顺手写进磁盘的地方 —— 一旦落盘，再想收回就得去翻历史日志。
 *
 * 具体要处理的两类：
 *
 * 1. **个人标识（openid）**：`/api/wechat/oa/event` 原先每次事件都把
 *    `FromUserName`（就是用户的 openid）明文打印。openid 是能定位到具体
 *    微信用户的标识，不该出现在日志里。
 *    但完全抹掉又会让排查变难（"同一条日志里的两次操作是不是同一个人"）。
 *    折中做法是打印**短哈希**：同一 openid 在同一套日志里稳定可关联，
 *    但无法反推出标识本身。
 *
 * 2. **URL 里的凭据**：`/api/` 的请求日志会打印完整的 path + query，
 *    而 `/api/auth/wechat/callback?code=...` 里的 `code` 是 OAuth 授权码、
 *    `state` 是 CSRF 令牌。它们寿命短，但"凭据出现在日志里"本身就不该发生。
 *    这里按参数名把值替成 `***`，保留参数名以便看出走的是哪条链路。
 *
 * 纯函数、无依赖，因此可单测；两个使用点分别见 src/proxy.ts 与
 * src/app/api/wechat/oa/event/route.ts。
 */

import { createHash } from "crypto"

/**
 * 日志里可以保留的安全参数名之外，一律按这些名字脱敏。
 *
 * 采用**按名匹配**（而不是正则猜值）的原因：猜值的规则迟早会漏，
 * 而参数名是稳定的、可枚举的，漏了能一眼看出来。
 */
export const SENSITIVE_QUERY_KEYS: readonly string[] = [
  "code",
  "state",
  "token",
  "access_token",
  "refresh_token",
  "ticket",
  "key",
  "apikey",
  "appkey",
  "app_key",
  "secret",
  "app_secret",
  "sign",
  "signature",
  "password",
  "pwd",
  "session",
  "sessionid",
  "openid",
]

const MASK = "***"

/**
 * 把一个标识替换成稳定的短哈希。
 *
 * @returns 形如 `id:3f2a1b9c`；入参为空时返回 `id:-`
 */
export function maskId(value: string | null | undefined): string {
  const v = (value ?? "").trim()
  if (!v) return "id:-"
  return `id:${createHash("sha256").update(v).digest("hex").slice(0, 8)}`
}

/**
 * 参数名归一化：小写 + 去掉 `_` / `-` / `.` 分隔符。
 *
 * 必须是"去掉分隔符"而不是"统一成下划线" —— 因为同一个概念在真实 URL 里会写成
 * `api_key`、`apiKey`、`api-key`、`app_key`、`appkey` 各种形态，统一成下划线
 * 只能覆盖其中一半（`apiKey` → `apikey` 就漏了）。
 */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[_\-.]/g, "")
}

/** 这个参数名是否需要在日志里脱敏（大小写与分隔符变体都算）。 */
export function isSensitiveQueryKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (!normalized) return false
  return SENSITIVE_QUERY_KEYS.some((k) => normalizeKey(k) === normalized)
}

/**
 * 把 query 串里敏感参数的值替换成 `***`，其余原样保留。
 *
 * 输入可以是带 `?` 的 `request.nextUrl.search`，也可以不带；输出保持同样的形态。
 * 只按第一个 `=` 切分，所以值里含 `=`（base64、签名）不会被截断。
 */
export function redactQuery(search: string | null | undefined): string {
  const raw = search ?? ""
  if (!raw) return ""
  const hasPrefix = raw.startsWith("?")
  const body = hasPrefix ? raw.slice(1) : raw
  if (!body) return raw

  const redacted = body
    .split("&")
    .map((pair) => {
      if (!pair) return pair
      const eq = pair.indexOf("=")
      if (eq === -1) return pair
      const key = pair.slice(0, eq)
      // 参数名可能被 urlencode 过（%5F 等），解码后再判断
      let decodedKey = key
      try {
        decodedKey = decodeURIComponent(key)
      } catch {
        /* 保留原样 */
      }
      return isSensitiveQueryKey(decodedKey) ? `${key}=${MASK}` : pair
    })
    .join("&")

  return hasPrefix ? `?${redacted}` : redacted
}
