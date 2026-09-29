/**
 * 把 getUserMedia 的失败翻译成用户能照做的提示。
 *
 * ── 为什么单独一个模块 ──────────────────────────────────────────────────────
 *
 * 这里曾经只有一句话兜住所有 `NotAllowedError`：
 * 「麦克风权限被拒绝：请点地址栏的锁图标允许麦克风后重试」。
 * 但 `NotAllowedError` **不等于**"站点权限被拒"，它至少有三种来源，
 * 处置方式完全不同：
 *
 *   1. 站点权限被拒（锁图标里是「阻止」）→ 改站点权限，然后刷新；
 *   2. 站点已允许，但**系统层面**没给浏览器麦克风权限 → 去系统设置里勾选，
 *      而且 macOS / Windows 改完都**需要完全退出并重启浏览器**才生效；
 *   3. 微信内置浏览器等 webview 不允许录音 → 换电脑上的 Chrome / Edge。
 *
 * 实际遇到过"浏览器里明明允许了、仍然报被拒" —— 那就是第 2 种，而原提示
 * 让用户去点一个本来就是「允许」的锁图标，纯属把人指向错误的方向。
 *
 * 抽出来是为了可单测：提示文本是用户唯一能看到的诊断信息，
 * 它错了用户就只能瞎试（而这一处真的错过一次）。
 */

export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown"

export interface MicErrorInput {
  /** DOMException.name，例如 NotAllowedError / NotFoundError */
  name: string
  /** 站点级权限状态；浏览器不提供该查询时为 "unknown" */
  permission: MicPermissionState
  userAgent: string
}

/** 是否运行在微信内置浏览器里（那里的录音基本一定失败）。 */
export function isWeChatWebview(userAgent: string): boolean {
  return /MicroMessenger/i.test(userAgent)
}

export function describeMicError(input: MicErrorInput): string {
  const { name, permission, userAgent } = input

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有检测到麦克风设备"
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风被其它程序占用，请关掉后重试"
  }

  if (name === "NotAllowedError" || name === "SecurityError") {
    // 站点已被明确阻止 —— 这时"点锁图标"确实是正确建议
    if (permission === "denied") {
      return "麦克风被浏览器阻止：点地址栏的锁图标把麦克风改成「允许」，然后刷新页面重试"
    }
    // 微信内置浏览器：先把人从死路上带出来，再谈权限（那里的权限项往往根本不存在）
    if (isWeChatWebview(userAgent)) {
      return "微信内置浏览器不允许录音：请在电脑上用 Chrome / Edge 打开本页练习跟读"
    }
    // 站点已允许却仍被拒 → 拦住的是系统或浏览器进程本身
    if (permission === "granted") {
      return "浏览器已允许麦克风，但系统层面还没有放行：请在系统设置的隐私 → 麦克风里勾选你的浏览器，然后完全退出并重启浏览器再试"
    }
    return "没能拿到麦克风权限：请确认系统设置里已允许浏览器使用麦克风（macOS / Windows 改完都需要重启浏览器），再刷新重试"
  }

  return "无法访问麦克风，请检查设备与浏览器权限"
}
