/**
 * 注册来源的词汇表与清洗规则。
 *
 * 背景（2026-09-28）：老板问「新增用户从哪来」，而答案只能靠临时脚本去微信接口
 * 捞 —— 建号时什么都没记。本模块把「记什么、怎么归一、怎么显示」定在一处。
 *
 * 纯模块、无服务端依赖：既给 API 路由写库用，也给后台页面显示用
 * （同 admin-audit-labels / admin-range 的理由 —— 从页面 import 带 db 的模块
 * 会把 mysql2 打进浏览器包）。
 */

import { clientIpOf, referrerOf, truncateMeta, userAgentOf } from "@/lib/request-meta"
import type { FirstTouch } from "@/lib/first-touch"

/**
 * 建号渠道。这是可筛可 GROUP BY 的主轴，所以**必须收敛成有限取值**——
 * 真正开放的那部分（scene、referrer、utm…）放 signup_source 里。
 */
export const SIGNUP_CHANNELS = [
  /** 公众号扫码：目前的主力。人在浏览器里打开 /login → 扫码 → 关注即建号 */
  "wechat_oa_qr",
  /** 公众号内直接授权（微信内置浏览器打开 /login 时自动跳转 snsapi_userinfo） */
  "wechat_oa_oauth",
  /** 开放平台扫码登录（snsapi_login） */
  "wechat_open_qr",
  /** 手机号 + 短信验证码 */
  "phone",
  /** 开发旁路建号（dev-login）—— 报表里要能把它们摘出去 */
  "dev",
] as const

export type SignupChannel = (typeof SIGNUP_CHANNELS)[number]

export const SIGNUP_CHANNEL_LABELS: Record<SignupChannel, string> = {
  wechat_oa_qr: "公众号扫码",
  wechat_oa_oauth: "微信内授权",
  wechat_open_qr: "开放平台扫码",
  phone: "手机号",
  dev: "开发旁路",
}

/** 认不出的值原样返回：日志/历史数据要能读，不要吞掉 */
export function signupChannelLabel(channel: string | null | undefined): string {
  if (!channel) return "—"
  return SIGNUP_CHANNEL_LABELS[channel as SignupChannel] ?? channel
}

/**
 * 微信 subscribe_scene → 中文。
 *
 * 这份映射是「用户当初怎么找到我们的」唯一权威答案，而它只在微信侧有：
 * 公众号搜索 = 自然搜索到了（不是我们投放的）、名片分享 = 被别人推荐、
 * 扫描二维码 = 扫了某个码（配合 qr_scene 才知道是哪个码）。
 */
export const WECHAT_SCENE_LABELS: Record<string, string> = {
  ADD_SCENE_SEARCH: "公众号搜索",
  ADD_SCENE_ACCOUNT_MIGRATION: "公众号迁移",
  ADD_SCENE_PROFILE_CARD: "名片分享",
  ADD_SCENE_QR_CODE: "扫描二维码",
  ADD_SCENE_PROFILE_LINK: "图文页名称点击",
  ADD_SCENE_PROFILE_ITEM: "图文页右上角菜单",
  ADD_SCENE_PAID: "支付后关注",
  ADD_SCENE_WECHAT_ADVERTISEMENT: "微信广告",
  ADD_SCENE_REPRINT: "他人转载",
  ADD_SCENE_LIVESTREAM: "视频号直播",
  ADD_SCENE_CHANNELS: "视频号",
  ADD_SCENE_WXA: "小程序",
  ADD_SCENE_OTHERS: "其他",
}

export function wechatSceneLabel(scene: string | null | undefined): string {
  if (!scene) return "—"
  return WECHAT_SCENE_LABELS[scene] ?? scene
}

/**
 * signup_source 的键白名单与长度上限。
 *
 * 表驱动而不是散在代码里：新增一个字段时只改这张表，
 * 清洗（buildSignupSource）与文档（本文档）自动一致。
 */
const SOURCE_FIELDS = {
  /** 微信 subscribe_scene 原文（ADD_SCENE_*） */
  scene: 40,
  /** 我们自己的二维码 scene（含邀请码时形如 <96hex>_<CODE>） */
  qrScene: 64,
  /** 微信 subscribe_time（ISO） */
  subscribedAt: 32,
  /** 首触外部来源（见 lib/first-touch.ts） */
  referrer: 512,
  /** 首触落地页 */
  landing: 512,
  /** 注册那次请求的 Referer（多半是我们自己的 /login，用于排查） */
  requestReferrer: 512,
  userAgent: 255,
  ip: 64,
} as const

export type SignupSourceKey = keyof typeof SOURCE_FIELDS

/** 明文列出键名，供单测与文档使用（Object.keys 的顺序不应被依赖） */
export const SIGNUP_SOURCE_KEYS = Object.keys(SOURCE_FIELDS) as SignupSourceKey[]

/** 清洗后的结果：值一定是非空字符串（空值在清洗时就被丢掉了） */
export interface SignupSource {
  scene?: string
  qrScene?: string
  subscribedAt?: string
  referrer?: string
  landing?: string
  requestReferrer?: string
  userAgent?: string
  ip?: string
  /** 来源参数（utm_* / ref）。嵌套一层，同样只收白名单键 */
  utm?: Record<string, string>
}

/**
 * 清洗的**入参**：允许 null。
 *
 * 与结果类型分开是刻意的：调用方手里往往是可空值（首触 cookie 可能没解析出
 * referrer、请求头可能没有 UA），要求它们先 `?? undefined` 只是噪音；
 * 而读结果的人应该拿到"要么有值要么没这个键"的确定类型。
 */
export type SignupSourcePatch = {
  [K in SignupSourceKey]?: string | null
} & {
  utm?: Record<string, string> | null
}

const MAX_UTM_KEY = 32
const MAX_UTM_VALUE = 128

/**
 * 白名单清洗：**调用方不能直接塞任意 JSON**。
 *
 * 与 lib/admin-audit 的脱敏同一条原则 —— 写库前把不认识的东西丢掉。
 * 这里丢的不是"敏感字段"而是"没定义的字段"：signup_source 是要被报表按
 * 固定键读取的，混进任意键只会让下游读到 undefined。
 */
export function buildSignupSource(input: SignupSourcePatch | null | undefined): SignupSource | null {
  if (!input) return null
  const out: SignupSource = {}

  for (const key of SIGNUP_SOURCE_KEYS) {
    const raw = input[key]
    if (raw === null || raw === undefined || raw === "") continue
    const limit = SOURCE_FIELDS[key]
    const v = truncateMeta(String(raw), limit)
    if (v) out[key] = v
  }

  if (input.utm && typeof input.utm === "object") {
    const utm: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.utm)) {
      if (typeof v !== "string" || !v) continue
      utm[k.slice(0, MAX_UTM_KEY)] = v.slice(0, MAX_UTM_VALUE)
    }
    if (Object.keys(utm).length) out.utm = utm
  }

  return Object.keys(out).length ? out : null
}

/** 读回来时也要归一：库里的 JSON 可能是老版本写的、或被人工改过 */
export function parseSignupSource(value: unknown): SignupSource | null {
  if (!value) return null
  let obj: unknown = value
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
  return buildSignupSource(obj as SignupSourcePatch)
}

/**
 * 把这些字段合并进一个已有的 signup_source。
 *
 * 存在的理由：扫码链是**两步**——关注事件先建号（那时只有微信侧字段，
 * 没有 IP/UA），随后 oa-check 才带着浏览器的请求头到达。没有合并的话，
 * 第二步要么覆盖第一步（丢掉微信侧 scene），要么什么都不写（丢掉浏览器侧）。
 */
export function mergeSignupSource(
  existing: unknown,
  patch: SignupSourcePatch | null | undefined,
): SignupSource | null {
  const base = parseSignupSource(existing) ?? {}
  const merged = buildSignupSource({ ...base, ...(patch ?? {}) })
  return merged
}

/**
 * 从注册请求里取「这次请求带了什么」。
 *
 * 三个字段都可能为 null（微信的服务端事件回调就没有这些 —— 那条链路的建号
 * 由 lib/wechat/oa/event 发起，请求来自微信服务器，IP 与 UA 都毫无意义）。
 */
export function requestSignupContext(req: Request | null | undefined): {
  referrer: string | null
  userAgent: string | null
  ip: string | null
} {
  return { referrer: referrerOf(req), userAgent: userAgentOf(req), ip: clientIpOf(req) }
}

export interface SignupSourceInput {
  channel: SignupChannel
  /** 微信侧字段（只有扫码/OAuth 链路才有） */
  wechat?: { subscribeScene?: string | null; qrScene?: string | null; subscribeTime?: number | null } | null
  /** 首触 cookie（见 lib/first-touch.ts） */
  firstTouch?: FirstTouch | null
  /** 注册那次请求的 Referer / UA / IP */
  request?: { referrer?: string | null; userAgent?: string | null; ip?: string | null } | null
}

/**
 * 把三个来源的信息合成一次写入所需的 (channel, source)。
 *
 * 收敛成一个函数而不是让五个调用点各拼一遍：漏一个字段的表现是
 * 「有的渠道有 referrer、有的没有」，而这类缺口几个月内都不会有人发现。
 */
export function signupFields(input: SignupSourceInput): {
  signupChannel: SignupChannel
  signupSource: SignupSource | null
} {
  const { wechat, firstTouch, request } = input
  const source = buildSignupSource({
    scene: wechat?.subscribeScene,
    qrScene: wechat?.qrScene,
    subscribedAt: wechat?.subscribeTime
      ? new Date(wechat.subscribeTime * 1000).toISOString()
      : undefined,
    referrer: firstTouch?.referrer,
    landing: firstTouch?.landing,
    utm: firstTouch?.utm && Object.keys(firstTouch.utm).length ? firstTouch.utm : null,
    requestReferrer: request?.referrer,
    userAgent: request?.userAgent,
    ip: request?.ip,
  })
  return { signupChannel: input.channel, signupSource: source }
}

/**
 * 后台列表里显示的一行来源摘要。
 *
 * 优先级刻意是「微信侧 scene > 首触来源 > 渠道名」：
 * scene 是微信给的**事实**（搜索来的 / 扫码来的 / 被推荐的），
 * 首触来源是我们自己记的（可能没有），渠道名只是技术路径
 * （"开放平台扫码"回答不了"他怎么知道这个网址的"）。
 */
export function describeSignupSource(
  channel: string | null | undefined,
  source: unknown,
): string {
  const s = parseSignupSource(source)
  const parts: string[] = []

  if (s?.scene) parts.push(wechatSceneLabel(s.scene))
  if (s?.utm?.utm_source) {
    // 内层用 "/"（source/medium），外层用 " / " 连接多个维度：
    // 两级用不同的分隔符，读的人才能分清「wechat/group 是一个来源的 source/medium」
    // 与「渠道 · 来源 是两个维度」
    parts.push(s.utm.utm_medium ? `${s.utm.utm_source}/${s.utm.utm_medium}` : s.utm.utm_source)
  } else if (s?.referrer) {
    parts.push(referrerLabel(s.referrer))
  } else if (s?.landing) {
    // 记过首触但没有外部来源 = 直接访问（取舍见 lib/first-touch.ts）
    parts.push("直接访问")
  }

  // 渠道判不出来（存量数据里"有 token"的两行就是这种）时不显示占位符：
  // "— · 公众号搜索" 会让人误以为渠道那一格坏了，而「只有 scene」本身就是
  // 完整的信息 —— 它回答的正是"他怎么找到我们的"。
  const channelLabel = channel ? signupChannelLabel(channel) : ""
  if (!parts.length) return channelLabel || "—"
  return channelLabel ? `${channelLabel} · ${parts.join(" / ")}` : parts.join(" / ")
}

function referrerLabel(referrer: string): string {
  try {
    return new URL(referrer).hostname.replace(/^www\./, "")
  } catch {
    return referrer
  }
}
