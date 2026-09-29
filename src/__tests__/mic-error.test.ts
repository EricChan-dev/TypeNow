/**
 * 麦克风失败提示（src/lib/mic-error.ts）。
 *
 * 这一处真的错过一次：所有 `NotAllowedError` 都被翻译成
 * 「请点地址栏的锁图标允许麦克风」，而用户的实际情况是"浏览器里已经允许了" ——
 * 提示把他推向了一个本来就是「允许」的开关。
 *
 * 所以测试的重点是**分岔正确**，尤其是：
 * 站点权限已经是 granted 时，绝不能再让人去点锁图标。
 */
import { describe, it, expect } from "vitest"
import { describeMicError, isWeChatWebview } from "@/lib/mic-error"

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
const WECHAT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.49"

describe("isWeChatWebview", () => {
  it("识别微信内置浏览器（大小写不敏感）", () => {
    expect(isWeChatWebview(WECHAT_UA)).toBe(true)
    expect(isWeChatWebview("... micromessenger/8.0")).toBe(true)
  })
  it("普通 Chrome 不算", () => {
    expect(isWeChatWebview(CHROME_UA)).toBe(false)
    expect(isWeChatWebview("")).toBe(false)
  })
})

describe("describeMicError · 设备类失败", () => {
  it("没有设备 → 直接说没有设备（不要扯权限）", () => {
    const msg = describeMicError({ name: "NotFoundError", permission: "granted", userAgent: CHROME_UA })
    expect(msg).toContain("没有检测到麦克风设备")
    expect(msg).not.toContain("锁图标")
  })

  it("设备被占用 → 说被占用", () => {
    expect(
      describeMicError({ name: "NotReadableError", permission: "granted", userAgent: CHROME_UA }),
    ).toContain("占用")
  })
})

describe("describeMicError · NotAllowedError 的三种来源必须分岔", () => {
  it("站点权限确实被拒 → 这时候「点锁图标」才是正确建议", () => {
    const msg = describeMicError({ name: "NotAllowedError", permission: "denied", userAgent: CHROME_UA })
    expect(msg).toContain("锁图标")
  })

  it("**站点已允许却仍被拒 → 不能再说点锁图标**（这正是修掉的那个误导）", () => {
    const msg = describeMicError({ name: "NotAllowedError", permission: "granted", userAgent: CHROME_UA })
    expect(msg).toContain("系统")
    expect(msg).toContain("重启浏览器")
    expect(msg).not.toContain("锁图标")
  })

  it("微信内置浏览器 → 先把人带出死路（换电脑 Chrome/Edge）", () => {
    const msg = describeMicError({ name: "NotAllowedError", permission: "granted", userAgent: WECHAT_UA })
    expect(msg).toContain("微信")
    expect(msg).toContain("Chrome")
    // 微信里谈"点锁图标"没有意义（那个权限项往往根本不存在）
    expect(msg).not.toContain("锁图标")
  })

  it("拿不到权限状态（Firefox / Safari 不提供查询）→ 给通用但可照做的建议", () => {
    const msg = describeMicError({ name: "NotAllowedError", permission: "unknown", userAgent: CHROME_UA })
    expect(msg).toContain("系统设置")
    expect(msg).toContain("重启浏览器")
  })

  it("SecurityError 与 NotAllowedError 同等处理", () => {
    expect(
      describeMicError({ name: "SecurityError", permission: "denied", userAgent: CHROME_UA }),
    ).toContain("锁图标")
  })

  it("prompt 状态（用户还没做选择）不会给出「已拒绝」这种断言", () => {
    const msg = describeMicError({ name: "NotAllowedError", permission: "prompt", userAgent: CHROME_UA })
    expect(msg).not.toContain("被浏览器阻止")
  })
})

describe("describeMicError · 兜底", () => {
  it("未识别的错误名给出通用提示，不假装知道原因", () => {
    const msg = describeMicError({ name: "AbortError", permission: "granted", userAgent: CHROME_UA })
    expect(msg).toContain("无法访问麦克风")
  })

  it("任何情况下都返回非空中文提示（不会把 toast 变成空白）", () => {
    for (const name of ["", "NotAllowedError", "NotFoundError", "NotReadableError", "Whatever"]) {
      for (const permission of ["granted", "denied", "prompt", "unknown"] as const) {
        const msg = describeMicError({ name, permission, userAgent: CHROME_UA })
        expect(msg.length).toBeGreaterThan(4)
        expect(msg).toMatch(/[\u4e00-\u9fa5]/)
      }
    }
  })
})
