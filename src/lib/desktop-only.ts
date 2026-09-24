/**
 * 「练习页 PC 优先」的判定与提示记忆。
 *
 * 背景（这是一个已经拍板的产品决策，不是临时折中）：
 *   练习页的输入完全依赖 document 上的 keydown，页面上没有可见输入框。
 *   触屏设备没有物理键盘，软键盘是否吐出可用的 keydown 完全取决于各家输入法，
 *   实测并不可靠。彻底修好需要把输入层改成 beforeinput/input 事件差分，
 *   工作量大且收益不确定，因此决定退守 PC 优先：
 *   不重写输入层，改为在触屏设备上如实告知用户换电脑，并修正定价页里
 *   「手机浏览器也能打开用」这类我们兑现不了的承诺。
 *
 * 注意这里只做「要不要提示」的判断，不做「禁止练习」的拦截：
 * 有用户在平板上配了外接键盘，或某些 Android 输入法确实工作正常，
 * 硬拦会把本来能用的场景一并挡掉。
 */

export const DESKTOP_NOTICE_STORAGE_KEY = "typenow.practice.desktopNoticeDismissed"

/**
 * 判断是否「以触屏为主要输入方式」。
 *
 * 必须两个条件同时成立：
 *   - `(pointer: coarse)`：主指针是手指而非鼠标；
 *   - `(hover: none)`：设备无法悬停。
 * 只看粗指针会把触屏笔记本误判成手机——那类设备有物理键盘，打字毫无问题，
 * 弹提示只会打扰用户。
 */
export function isTouchPrimaryDevice(input: {
  coarsePointer: boolean
  noHover: boolean
}): boolean {
  return input.coarsePointer && input.noHover
}

/** 读取「用户关闭过提示」的持久化标记。只认 "1"，其他一律视为未关闭。 */
export function parseDesktopNoticeDismissed(raw: string | null): boolean {
  return raw === "1"
}

/** 是否应当显示提示：在触屏设备上，且用户没有主动关掉过。 */
export function shouldShowDesktopNotice(input: {
  touchPrimary: boolean
  dismissed: boolean
}): boolean {
  return input.touchPrimary && !input.dismissed
}

// ── 订阅（useSyncExternalStore）────────────────────────────────────────────
//
// 与 sfx.ts 同样的理由：在 effect 里 setState 读 matchMedia 会同时踩水合不一致
// 和「状态变了但界面不更新」两个坑。这里改成订阅式读值，额外拿到一个好处：
// 用户在平板上插上鼠标/键盘时 (hover: none) 会变为 false，提示条能自动消失。
//
// 首屏快照恒为 false —— 服务端不知道设备形态，若先渲染提示条再撤掉会闪一下。

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

const MEDIA_QUERIES = ["(pointer: coarse)", "(hover: none)"] as const

/** 订阅「指针形态」与「关闭动作」两类变化，返回取消订阅函数。 */
export function subscribeDesktopNotice(listener: () => void): () => void {
  const cleanups: Array<() => void> = []

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    for (const query of MEDIA_QUERIES) {
      const mq = window.matchMedia(query)
      mq.addEventListener("change", listener)
      cleanups.push(() => mq.removeEventListener("change", listener))
    }
  }

  listeners.add(listener)
  cleanups.push(() => {
    listeners.delete(listener)
  })

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}

/** 客户端快照。返回布尔字面量，值不变时引用天然相等。 */
export function getDesktopNoticeSnapshot(): boolean {
  if (typeof window === "undefined") return false
  const touchPrimary = isTouchPrimaryDevice({
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    noHover: window.matchMedia("(hover: none)").matches,
  })
  // localStorage 在隐私模式下可能直接抛异常；读不到就当作没关过，
  // 最坏结果是多提示一次，比崩掉整个练习页轻得多。
  let dismissed = false
  try {
    dismissed = parseDesktopNoticeDismissed(
      window.localStorage.getItem(DESKTOP_NOTICE_STORAGE_KEY),
    )
  } catch {
    /* ignore */
  }
  return shouldShowDesktopNotice({ touchPrimary, dismissed })
}

/** 服务端/首屏快照：恒 false，保证 SSR 输出与客户端首帧一致。 */
export function getDesktopNoticeServerSnapshot(): boolean {
  return false
}

/** 记录用户关闭了提示，并通知订阅者立即收起。 */
export function dismissDesktopNotice(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(DESKTOP_NOTICE_STORAGE_KEY, "1")
  } catch {
    /* ignore */
  }
  notify()
}
