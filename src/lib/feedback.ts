/**
 * 用户反馈的分类 / 来源 / 状态词汇表。
 *
 * 前后端共用一份：后台列表、处理弹窗、以及提交接口的合法性校验都读这里。
 * 分开写的后果很具体 —— 提交接口收 'learning' 而后台只认 'learn'，
 * 反馈就会以"未知来源"落库，且不报错。
 */

export const FEEDBACK_CATEGORIES = ["bug", "feature", "suggestion", "other"] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug 反馈",
  feature: "功能建议",
  suggestion: "使用建议",
  other: "其他",
}

/** 分类对应的 tag 颜色（Ant Design 语义色） */
export const FEEDBACK_CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  bug: "red",
  feature: "blue",
  suggestion: "green",
  other: "default",
}

/** 提交时带 emoji 的文案，与微信推送保持一致 */
export const FEEDBACK_CATEGORY_EMOJI: Record<FeedbackCategory, string> = {
  bug: "🐛",
  feature: "✨",
  suggestion: "💡",
  other: "📝",
}

// ─── 来源 ─────────────────────────────────────────────────────────────────────

export const FEEDBACK_SOURCES = ["portal", "learning", "unknown"] as const
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number]

export const FEEDBACK_SOURCE_LABELS: Record<FeedbackSource, string> = {
  portal: "门户端",
  learning: "学习中心",
  unknown: "未知（早期数据）",
}

/**
 * 由当前路由推断来源。
 *
 * 前端只上报一个字符串，服务端仍用白名单校验 —— 它决定的是列表里显示
 * "门户端"还是"学习中心"，不参与任何权限判断，所以不构成安全边界。
 * 放在这里而不是组件里：一眼能看出"哪些路径算学习中心"，加页面时不容易漏。
 */
export function sourceFromPathname(pathname: string | null | undefined): FeedbackSource {
  if (!pathname) return "unknown"
  // 学习相关的路径都挂在 /home 下（learn / review / wordbook / notes / courses…）
  if (pathname.startsWith("/home")) return "learning"
  if (pathname === "/" || pathname.startsWith("/pricing") || pathname.startsWith("/login")) {
    return "portal"
  }
  return "unknown"
}

// ─── 状态 ─────────────────────────────────────────────────────────────────────

export const FEEDBACK_STATUSES = ["open", "in_progress", "resolved", "ignored"] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  ignored: "已忽略",
}

export const FEEDBACK_STATUS_COLORS: Record<FeedbackStatus, string> = {
  open: "orange",
  in_progress: "blue",
  resolved: "green",
  ignored: "default",
}

/**
 * 未结束的状态。仪表盘「待处理反馈」按它计数 ——
 * 「处理中」也算未完成，否则一条被接手但没做完的反馈会从待办里消失。
 */
export const OPEN_FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "in_progress"]

/** 合法值判断（提交接口与后台 PATCH 都用） */
export function isFeedbackCategory(v: unknown): v is FeedbackCategory {
  return typeof v === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(v)
}
export function isFeedbackSource(v: unknown): v is FeedbackSource {
  return typeof v === "string" && (FEEDBACK_SOURCES as readonly string[]).includes(v)
}
export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(v)
}
