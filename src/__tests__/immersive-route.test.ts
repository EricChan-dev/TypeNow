import { describe, it, expect } from "vitest"
import { isImmersivePracticeRoute } from "@/lib/immersive-route"

describe("isImmersivePracticeRoute", () => {
  it("把练习页认成沉浸路由", () => {
    expect(isImmersivePracticeRoute("/home/learn/course-1")).toBe(true)
    expect(isImmersivePracticeRoute("/home/learn/abc123/")).toBe(true)
  })

  it("把复习作答页认成沉浸路由", () => {
    expect(isImmersivePracticeRoute("/home/review/session")).toBe(true)
    expect(isImmersivePracticeRoute("/home/review/session/")).toBe(true)
  })

  it("前缀相同但不是练习页的路由不算", () => {
    // /home/learner 以 /home/learn 开头，用字符串拼接做前缀判断就会误伤
    expect(isImmersivePracticeRoute("/home/learner")).toBe(false)
    expect(isImmersivePracticeRoute("/home/learn")).toBe(false)
    expect(isImmersivePracticeRoute("/home/review")).toBe(false)
    expect(isImmersivePracticeRoute("/home/review/history")).toBe(false)
  })

  it("普通页面不算", () => {
    expect(isImmersivePracticeRoute("/home")).toBe(false)
    expect(isImmersivePracticeRoute("/home/store")).toBe(false)
    expect(isImmersivePracticeRoute("/pricing")).toBe(false)
    expect(isImmersivePracticeRoute("/")).toBe(false)
  })

  it("pathname 缺失时不算（宁可显示，也不要因为拿不到路由而永远不显示）", () => {
    expect(isImmersivePracticeRoute(null)).toBe(false)
    expect(isImmersivePracticeRoute(undefined)).toBe(false)
    expect(isImmersivePracticeRoute("")).toBe(false)
  })
})
