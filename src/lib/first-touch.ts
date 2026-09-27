/**
 * 首次接触归因（first touch）。
 *
 * 要解决的问题：注册永远发生在 /login，那一刻请求里的 Referer 是**我们自己**
 * （`https://typenow.cn/login`）或微信授权页 —— 直接存下来等于没存。
 * 有信息量的是「这个人第一次带着外部来源进来」的那一瞬间，而那个信息只在
 * 落地页那一次请求里出现过。所以：客户端在首次浏览时把它写进一个长期 cookie，
 * 注册时服务端读出来落库。
 *
 * 几条刻意的取舍：
 *
 * 1. **只记第一次，之后不再覆盖**。cookie 一旦存在就原样保留：一个用户可能
 *    先后从 Google、微信群、直接输入进来，但「他最早从哪来」是唯一能公平归因
 *    的那个答案。后覆盖前会让"多来几次的人"被算到最后一次渠道上，
 *    那样各渠道的贡献完全取决于用户回访习惯，而不是渠道质量。
 *
 * 2. **nothing 也记**（referrer 为空串 = 直接访问）。必须区分
 *    「cookie 不存在」（注册前没经过任何页面，来源未知）与
 *    「cookie 存在但没有外部来源」（直接输入/书签/App 内打开）。
 *    这两件事在归因上是不同结论，合并成一个"未知"就再也分不开了。
 *
 * 3. **TTL 90 天**。归因窗口业界惯例就是这么长；再长只会把"半年前看过一次"
 *    也算成来源，让报表失真。
 *
 * 4. 这个 cookie **不是安全边界**：客户端可改。它只用于统计与展示，
 *    任何权限/奖励判断都不许读它（邀请奖励走 referred_by / ref_code，与它无关）。
 */

/** cookie 名。带 typ_ 前缀与其它 cookie 区分开 */
export const FIRST_TOUCH_COOKIE = "typ_first_touch"
export const FIRST_TOUCH_MAX_AGE_DAYS = 90

/** UTM 之外还值得记的来源参数。ref 是我们的邀请码（归因之外还参与奖励） */
const SOURCE_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"] as const

export interface FirstTouch {
  /** 外部来源的完整 URL；空串表示直接访问（见取舍 2） */
  referrer: string
  /** 落地页（含 query，便于回看当时点了什么链接） */
  landing: string
  /** 来源参数（utm_* 与 ref），没有就是空对象 */
  utm: Record<string, string>
  /** 首次接触时间（ISO） */
  at: string
}

// 判断 referrer 是否外部只留一份实现（lib/request-meta.ts）：
// 这里再写一遍就会出现两套"什么算外部"的规则
import { isExternalReferrer } from "@/lib/request-meta"

const MAX_REFERRER = 512
const MAX_LANDING = 512
const MAX_PARAM = 128

function clamp(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…"
}

export interface BuildFirstTouchInput {
  referrer: string
  /** location.search（带不带 ? 都行） */
  search: string
  /** location.pathname */
  pathname: string
  /** location.host，用于判断 referrer 是否外部 */
  host: string
  /** 便于单测注入 */
  now?: Date
}

/**
 * 组装首触信息。
 *
 * **总是返回对象**（包括"直接访问"这种没有来源的情况）—— 见取舍 2，
 * 「记了但为空」与「压根没记」必须是两种可区分的状态。
 */
export function buildFirstTouch(input: BuildFirstTouchInput): FirstTouch {
  const { referrer, search, pathname, host, now = new Date() } = input

  // 站内跳转不算来源：只有外部 referrer 才写进 referrer 字段
  const external = isExternalReferrer(referrer, host) ? clamp(referrer, MAX_REFERRER) : ""

  const utm: Record<string, string> = {}
  let params: URLSearchParams | null = null
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  } catch {
    params = null
  }
  if (params) {
    for (const key of SOURCE_PARAMS) {
      const v = params.get(key)
      if (v) utm[key] = clamp(v, MAX_PARAM)
    }
  }

  const query = params?.toString()
  const landing = clamp(query ? `${pathname}?${query}` : pathname, MAX_LANDING)

  return { referrer: external, landing, utm, at: now.toISOString() }
}

/** 序列化成 cookie 值。键名压到一个字母：cookie 会在**每个请求**上带着走，能省则省 */
export function serializeFirstTouch(ft: FirstTouch): string {
  return JSON.stringify({
    r: ft.referrer,
    l: ft.landing,
    u: Object.keys(ft.utm).length ? ft.utm : undefined,
    t: ft.at,
  })
}

/**
 * 解析 cookie 值。
 *
 * **绝不抛错**：这个值来自客户端，可能是被改坏的、被截断的、老版本的。
 * 解析不出来就当没有（返回 null），让调用方按"来源未知"处理 ——
 * 一个坏的 cookie 不能让注册流程失败。
 */
export function parseFirstTouch(raw: string | null | undefined): FirstTouch | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
  const o = obj as Record<string, unknown>

  const referrer = typeof o.r === "string" ? clamp(o.r, MAX_REFERRER) : ""
  const landing = typeof o.l === "string" ? clamp(o.l, MAX_LANDING) : ""
  const at = typeof o.t === "string" ? o.t : ""

  const utm: Record<string, string> = {}
  if (o.u && typeof o.u === "object" && !Array.isArray(o.u)) {
    for (const [k, v] of Object.entries(o.u as Record<string, unknown>)) {
      // 只接受已知的来源参数键：cookie 是客户端可控的，不接受任意键名被写进库
      if ((SOURCE_PARAMS as readonly string[]).includes(k) && typeof v === "string") {
        utm[k] = clamp(v, MAX_PARAM)
      }
    }
  }

  // landing 与 at 都缺，说明这不是我们写的 cookie（或已被破坏）→ 视为无
  if (!landing && !at) return null

  return { referrer, landing, utm, at }
}

/** 从 referrer 里取出主机名，用于报表里显示「google.com」而不是整条 URL */
export function referrerHost(referrer: string | null | undefined): string {
  if (!referrer) return ""
  try {
    return new URL(referrer).hostname.replace(/^www\./, "")
  } catch {
    return referrer
  }
}

/**
 * 一行话的归因摘要，后台列表直接显示这个。
 *
 * 微信内置浏览器一律不发 Referer，所以「有 utm 但 referrer 为空」是正常的，
 * 这时优先显示 utm_source（那是我们自己能控制的、更有信息量的那个）。
 */
export function describeFirstTouch(referrer: string, utm?: Record<string, string> | null): string {
  const src = utm?.utm_source
  if (src) {
    const medium = utm?.utm_medium
    return medium ? `${src} / ${medium}` : src
  }
  const host = referrerHost(referrer)
  if (host) return host
  // referrer 为空串 = 记过但没有外部来源（见取舍 2）
  return "直接访问"
}
