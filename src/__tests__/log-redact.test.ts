/**
 * 日志脱敏（src/lib/log-redact.ts）。
 *
 * 守两件具体的事，都不是假想问题：
 *   · `/api/wechat/oa/event` 原先每次事件都把 `FromUserName`（用户的 openid）
 *     明文打印；
 *   · `/api/` 的请求日志会打印完整 path+query，而
 *     `/api/auth/wechat/callback?code=…&state=…` 里的 code 是 OAuth 授权码、
 *     state 是 CSRF 令牌。
 *
 * 脱敏必须在**写日志之前**发生，所以这里既测纯函数，也用源码断言钉住调用点
 * 真的接上了 —— 只写一个没人调用的脱敏函数等于没做。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { isSensitiveQueryKey, maskId, redactQuery } from "@/lib/log-redact"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

describe("maskId", () => {
  const openid = "oABCDEFGHIJKLMNOPQRSTUVWXYZ1234"

  it("同一个标识总是得到同一个短哈希（日志里仍可跨行关联同一个人）", () => {
    expect(maskId(openid)).toBe(maskId(openid))
    expect(maskId(openid)).toMatch(/^id:[0-9a-f]{8}$/)
  })

  it("不同标识得到不同哈希，且不含原标识的任何片段", () => {
    const a = maskId(openid)
    const b = maskId("oZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")
    expect(a).not.toBe(b)
    expect(a).not.toContain(openid.slice(0, 6))
  })

  it("空值返回占位符而不是抛错", () => {
    expect(maskId(null)).toBe("id:-")
    expect(maskId(undefined)).toBe("id:-")
    expect(maskId("   ")).toBe("id:-")
  })
})

describe("isSensitiveQueryKey", () => {
  it("覆盖日志里真正会出现的凭据参数", () => {
    for (const key of ["code", "state", "token", "access_token", "key", "secret", "sign", "openid"]) {
      expect(isSensitiveQueryKey(key)).toBe(true)
    }
  })

  it("大小写、下划线/连字符/点号变体都算（apiKey / api-key / api.key）", () => {
    for (const key of ["apiKey", "API_KEY", "api-key", "api.key", "AppKey"]) {
      expect(isSensitiveQueryKey(key)).toBe(true)
    }
  })

  it("普通业务参数不脱敏（否则日志就没法用来排查了）", () => {
    for (const key of ["page", "pageSize", "lessonId", "courseId", "categoryKey", "scene", "q", "text"]) {
      expect(isSensitiveQueryKey(key)).toBe(false)
    }
  })
})

describe("redactQuery", () => {
  it("敏感参数的值换成 ***，参数名保留（仍能看出走的是哪条链路）", () => {
    expect(redactQuery("?code=abc123&state=xyz")).toBe("?code=***&state=***")
  })

  it("非敏感参数原样保留", () => {
    expect(redactQuery("?lessonId=abc&page=2")).toBe("?lessonId=abc&page=2")
    expect(redactQuery("?lessonId=abc&code=secret&page=2")).toBe("?lessonId=abc&code=***&page=2")
  })

  it("值里含 = 不会被截断（base64 / 签名很常见）", () => {
    expect(redactQuery("?sign=aGVsbG8=&code=zz")).toBe("?sign=***&code=***")
    expect(redactQuery("?q=a=b=c")).toBe("?q=a=b=c")
  })

  it("不带 ? 前缀时保持同样形态（request.nextUrl.search 通常带，但不依赖它）", () => {
    expect(redactQuery("code=abc")).toBe("code=***")
  })

  it("参数名被 urlencode 过也要识别", () => {
    // %61pi_key → api_key
    expect(redactQuery("?%61pi_key=secret")).toBe("?%61pi_key=***")
  })

  it("空值 / 只有 ? / 无值的参数都不炸", () => {
    expect(redactQuery("")).toBe("")
    expect(redactQuery(null)).toBe("")
    expect(redactQuery(undefined)).toBe("")
    expect(redactQuery("?")).toBe("?")
    expect(redactQuery("?code")).toBe("?code")
    // 连续 & 与空的键值对
    expect(redactQuery("?a=1&&code=x&")).toBe("?a=1&&code=***&")
  })
})

describe("调用点真的接上了（只写函数不接线等于没做）", () => {
  it("proxy 的请求日志经过 redactQuery", () => {
    const src = read("src/proxy.ts")
    expect(src).toContain("redactQuery(request.nextUrl.search)")
    // 不能再有直接把 search 拼进日志的写法
    expect(src).not.toContain("${pathname}${request.nextUrl.search || \"\"}")
  })

  it("oa/event 的日志打印 openid 的哈希，而不是 openid 本身", () => {
    const src = read("src/app/api/wechat/oa/event/route.ts")
    expect(src).toContain("maskId(event.FromUserName)")
    expect(src).toContain("maskId(openid)")
    expect(src).not.toContain('"from:", event.FromUserName')
    expect(src).not.toContain('"User not found or not subscribed:", openid')
  })
})
