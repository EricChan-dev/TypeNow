import { describe, it, expect } from "vitest"
import { getClientIP } from "@/lib/rate-limit"

/**
 * getClientIP 是全部基于 IP 的限流（短信发送、验证码校验、登录等）的唯一取值来源。
 *
 * 线上拓扑：客户端 → nginx → 127.0.0.1:3000（Next.js）。
 * nginx 配置：
 *   proxy_set_header X-Real-IP        $remote_addr;                  ← 覆盖写入，不可伪造
 *   proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;   ← 客户端值在左，真实值在右
 *
 * 历史缺陷：实现取 XFF 的最左段，而该段由客户端自带，
 * 攻击者只需每次带一个随机 X-Forwarded-For 就能让限流逐请求失效。
 * 这些用例锁定「不得信任可伪造输入」这一行为。
 */

function req(headers: Record<string, string>): Request {
  return new Request("https://typenow.cn/api/x", { headers })
}

describe("getClientIP — 抗 IP 伪造", () => {
  it("优先采用 nginx 覆盖写入的 X-Real-IP", () => {
    // 即便同时存在伪造的 XFF，也必须以不可伪造的 X-Real-IP 为准
    expect(
      getClientIP(
        req({
          "x-real-ip": "203.0.113.9",
          "x-forwarded-for": "1.2.3.4, 203.0.113.9",
        }),
      ),
    ).toBe("203.0.113.9")
  })

  it("绝不返回 X-Forwarded-For 的最左段（可伪造）", () => {
    const ip = getClientIP(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }))
    expect(ip).not.toBe("9.9.9.9")
    expect(ip).toBe("203.0.113.9")
  })

  it("XFF 只有单段时返回该段（无 nginx 追加，属兜底路径）", () => {
    expect(getClientIP(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9")
  })

  it("攻击者追加伪造段时不取最右以外的任意中间值", () => {
    // 攻击者可能构造 "fake1, fake2, real"，仍应取最右
    expect(
      getClientIP(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" })),
    ).toBe("203.0.113.9")
  })

  it("去除 X-Real-IP 两侧空白", () => {
    expect(getClientIP(req({ "x-real-ip": "  203.0.113.9  " }))).toBe("203.0.113.9")
  })

  it("忽略 XFF 中的空白段", () => {
    expect(getClientIP(req({ "x-forwarded-for": " , 203.0.113.9 , " }))).toBe("203.0.113.9")
  })

  it("两者都缺失时回退到本地地址", () => {
    expect(getClientIP(req({}))).toBe("127.0.0.1")
  })

  it("X-Real-IP 为空字符串时回退到 XFF 最右段", () => {
    expect(
      getClientIP(req({ "x-real-ip": "", "x-forwarded-for": "1.1.1.1, 203.0.113.9" })),
    ).toBe("203.0.113.9")
  })
})
