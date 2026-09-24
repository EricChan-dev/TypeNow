import { describe, it, expect } from "vitest"
import { describeKnowledgeFailure } from "@/lib/knowledge-failure"

/**
 * 这些用例锁定的是一条产品决策：
 * AI 解析不可用时，界面必须说实话，绝不能再拿 mock 占位文案冒充分析结果。
 * 因此每个分支都要明确「能不能重试」，且文案里不能出现暗示"已有内容"的措辞。
 */
describe("describeKnowledgeFailure", () => {
  it("未配置 AI key（503）时说明是服务未配置，且重试无意义", () => {
    const v = describeKnowledgeFailure(503, { error: "AI 解析服务暂未配置", code: "unconfigured" })
    expect(v.title).toBe("AI 解析服务暂未配置")
    expect(v.canRetry).toBe(false)
  })

  it("服务端用 code 标记未配置时，即使状态码不是 503 也判定为未配置", () => {
    const v = describeKnowledgeFailure(500, { code: "unconfigured" })
    expect(v.canRetry).toBe(false)
    expect(v.title).toContain("未配置")
  })

  it("未登录（401）时提示登录，且不提供重试", () => {
    const v = describeKnowledgeFailure(401, { error: "未登录" })
    expect(v.title).toContain("登录")
    expect(v.canRetry).toBe(false)
  })

  it("限流（429）时保留服务端给的重试提示，并允许重试", () => {
    const v = describeKnowledgeFailure(429, { error: "请求过于频繁，请37秒后重试" })
    expect(v.detail).toBe("请求过于频繁，请37秒后重试")
    expect(v.canRetry).toBe(true)
  })

  it("网络失败（status 为 null）时提示网络问题并允许重试", () => {
    const v = describeKnowledgeFailure(null, undefined)
    expect(v.canRetry).toBe(true)
    expect(v.detail).toContain("网络")
  })

  it("服务端返回了具体错误信息时原样透出，便于排查", () => {
    const v = describeKnowledgeFailure(500, { error: "句子分析失败，请稍后重试" })
    expect(v.detail).toBe("句子分析失败，请稍后重试")
    expect(v.canRetry).toBe(true)
  })

  it("服务端没给信息时使用兜底文案，不出现空字符串", () => {
    const v = describeKnowledgeFailure(500, null)
    expect(v.detail.length).toBeGreaterThan(0)
    expect(v.title.length).toBeGreaterThan(0)
  })

  it("payload 是字符串或非对象时不会崩，且能当错误信息使用", () => {
    for (const payload of ["坏掉了", 42, [], true]) {
      const v = describeKnowledgeFailure(500, payload)
      expect(v.title.length).toBeGreaterThan(0)
      expect(v.detail.length).toBeGreaterThan(0)
    }
  })

  it("句子本身有问题（400）时归类为无法解析，不诱导用户反复重试", () => {
    const v = describeKnowledgeFailure(400, { error: "句子不能为空且不超过2048字符" })
    expect(v.canRetry).toBe(false)
  })

  describe("任何分支都不应把伪造内容当作可用结果", () => {
    it("不存在可重试且无 detail 的组合", () => {
      const statuses = [null, 400, 401, 429, 500, 503, 418]
      for (const s of statuses) {
        const v = describeKnowledgeFailure(s, undefined)
        expect(v.detail.trim()).not.toBe("")
        expect(v.title.trim()).not.toBe("")
      }
    })
  })

  it("等待超时不能被说成网络故障，否则用户会去排查一个没坏的网络", () => {
    const v = describeKnowledgeFailure(null, undefined, { timedOut: true })
    expect(v.detail).not.toContain("网络")
    expect(v.title).toContain("耗时")
    expect(v.canRetry).toBe(true)
  })
})
