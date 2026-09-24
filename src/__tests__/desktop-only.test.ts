import { describe, it, expect } from "vitest"
import {
  DESKTOP_NOTICE_STORAGE_KEY,
  isTouchPrimaryDevice,
  parseDesktopNoticeDismissed,
  shouldShowDesktopNotice,
} from "@/lib/desktop-only"

/**
 * 这些用例锁定「PC 优先」这个决策的判定口径。
 *
 * 关键取舍：必须用「粗指针 且 无悬停」两个条件同时成立来判定触屏手机/平板。
 * 只看粗指针会把带触摸屏的笔记本也误判成手机——那些设备有物理键盘，
 * 打字体验完全正常，弹一个「请用电脑」的提示纯属打扰。
 */
describe("isTouchPrimaryDevice", () => {
  it("触屏手机/平板（粗指针且无悬停）判定为触屏为主", () => {
    expect(isTouchPrimaryDevice({ coarsePointer: true, noHover: true })).toBe(true)
  })

  it("带触摸屏的笔记本（粗指针但可悬停）不算触屏为主", () => {
    expect(isTouchPrimaryDevice({ coarsePointer: true, noHover: false })).toBe(false)
  })

  it("普通桌面（细指针且可悬停）不算触屏为主", () => {
    expect(isTouchPrimaryDevice({ coarsePointer: false, noHover: false })).toBe(false)
  })

  it("只有无悬停也不足以判定（可能是键盘操作的设备）", () => {
    expect(isTouchPrimaryDevice({ coarsePointer: false, noHover: true })).toBe(false)
  })
})

describe("parseDesktopNoticeDismissed", () => {
  it("读过存储标记时视为已关闭", () => {
    expect(parseDesktopNoticeDismissed("1")).toBe(true)
  })

  it("没有存储记录时视为未关闭", () => {
    expect(parseDesktopNoticeDismissed(null)).toBe(false)
  })

  it("存储里是别的值时不误判为已关闭", () => {
    expect(parseDesktopNoticeDismissed("0")).toBe(false)
    expect(parseDesktopNoticeDismissed("true")).toBe(false)
    expect(parseDesktopNoticeDismissed("")).toBe(false)
  })
})

describe("shouldShowDesktopNotice", () => {
  it("触屏且未关闭过提示时显示", () => {
    expect(shouldShowDesktopNotice({ touchPrimary: true, dismissed: false })).toBe(true)
  })

  it("用户关闭过之后不再显示，即使仍然在触屏设备上", () => {
    expect(shouldShowDesktopNotice({ touchPrimary: true, dismissed: true })).toBe(false)
  })

  it("桌面设备从不显示", () => {
    expect(shouldShowDesktopNotice({ touchPrimary: false, dismissed: false })).toBe(false)
    expect(shouldShowDesktopNotice({ touchPrimary: false, dismissed: true })).toBe(false)
  })
})

describe("DESKTOP_NOTICE_STORAGE_KEY", () => {
  it("是带命名空间的稳定字符串，避免与同源其他应用冲突", () => {
    expect(DESKTOP_NOTICE_STORAGE_KEY).toMatch(/^typenow\./)
  })
})
