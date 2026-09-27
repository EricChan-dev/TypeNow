/**
 * 平台适配：快捷键里的「主修饰键」。
 *
 * 原先练习页把 Ctrl 写死在十几个地方（Ctrl+P 暂停、Ctrl+1 大纲、Ctrl+/ 解析…）。
 * 在 Mac 上，用户的肌肉记忆是 Command，按 Ctrl 不仅不触发，还会被浏览器/系统
 * 抢走一部分（例如 Ctrl+P 是打印、Ctrl+N 是新窗口）—— 于是"快捷键在这个平台
 * 基本不能用"。
 *
 * 判定放在这里而不是各组件里：一处写错就是"某个快捷键在某个平台失灵"，
 * 而这种问题只有对应平台的用户才会遇到。
 */

export type Platform = "mac" | "other"

/**
 * 判断当前平台。
 *
 * 用 `navigator.userAgentData?.platform` 优先、`navigator.platform` 兜底：
 * 后者已被标记废弃但仍是兼容性最好的；再兜底到 userAgent 字符串。
 * 全部取不到时按 other（Windows/Linux 语义），因为那是 Ctrl 的默认世界。
 *
 * 注意**不要**用 `navigator.userAgent.includes("Mac")` 单独判断：
 * iPad 的 UA 也包含 "Mac"（"Macintosh; Intel Mac OS X"），而 iPad 的硬件键盘
 * 主修饰键确实是 Command，所以那反而是对的 —— 但 iPhone 不含 Mac。
 * 这里两个来源都查，宁可多判成 mac，也不要让 Mac 用户按 Command 没反应。
 */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other"

  const raw =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ""
  if (/mac|iphone|ipad|ipod/i.test(raw)) return "mac"

  // platform 为空的老浏览器：退回 UA。iPadOS 13+ 的 UA 会伪装成 Mac，
  // 这里同样判成 mac —— 与它的硬件键盘行为一致
  const ua = navigator.userAgent ?? ""
  if (/macintosh|iphone|ipad|ipod/i.test(ua)) return "mac"

  return "other"
}

/** 当前平台的主修饰键是否需要 Command（Mac）而不是 Ctrl。 */
export function prefersMetaKey(): boolean {
  return detectPlatform() === "mac"
}

/**
 * 判断一个键盘事件是否按下了「平台主修饰键」。
 *
 * 只认对应平台的那一个：在 Mac 上按下 Ctrl 不该被当成快捷键修饰键
 * （否则 Ctrl+1 会在 Mac 上意外触发大纲，而用户以为自己按的是浏览器缩放）。
 */
export function isModifierPressed(e: {
  metaKey: boolean
  ctrlKey: boolean
  altKey?: boolean
}): boolean {
  return prefersMetaKey() ? e.metaKey : e.ctrlKey
}

/** 快捷键说明里显示的修饰键名（界面文案用）。 */
export function modifierKeyLabel(): string {
  return prefersMetaKey() ? "⌘" : "Ctrl"
}
