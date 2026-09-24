/**
 * 「打开 AI 助手」的请求通道。
 *
 * 存在的理由：AI 助手面板挂在首页 layout 上，而练习页是全屏沉浸界面 ——
 * 浮在右下角的按钮会盖住练习 UI，所以按钮在练习页必须隐藏。但练习页又最需要
 * 这个老师（材料里 C12 的原话是「随时有一个英语老师在旁边」）。
 *
 * 折中：练习页不放浮窗按钮，改为 Ctrl+/ 打开讲解面板，面板里的「问小码」通过
 * 这条通道请 layout 上的面板打开自己。用具名事件而不是把 open 状态提到 Context，
 * 是因为全站约定「不用 React Context 做全局状态」。
 */
import { describe, it, expect, vi } from "vitest"
import { requestOpenAiChat, subscribeOpenAiChat } from "@/lib/ai-chat"

describe("AI 助手打开请求", () => {
  it("请求打开时通知订阅者", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeOpenAiChat(listener)
    requestOpenAiChat()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("取消订阅后不再收到通知", () => {
    const listener = vi.fn()
    subscribeOpenAiChat(listener)()
    requestOpenAiChat()
    expect(listener).not.toHaveBeenCalled()
  })

  it("多个订阅者都能收到（布局里可能不止一处挂面板）", () => {
    const a = vi.fn()
    const b = vi.fn()
    const ua = subscribeOpenAiChat(a)
    const ub = subscribeOpenAiChat(b)
    requestOpenAiChat()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    ua()
    ub()
  })
})
