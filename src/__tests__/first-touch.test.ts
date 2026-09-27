/**
 * 首触归因的纯逻辑单测。
 *
 * 这些规则决定了「新增用户从哪来」这个问题的答案对不对，而且**错了不会有任何
 * 报错**——只是报表上的渠道分布悄悄变得不可信。所以每条取舍都钉一个用例。
 */
import { describe, it, expect } from "vitest"
import {
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE_DAYS,
  buildFirstTouch,
  parseFirstTouch,
  serializeFirstTouch,
  describeFirstTouch,
  referrerHost,
} from "@/lib/first-touch"

const SITE = "typenow.cn"
const NOW = new Date("2026-09-28T10:00:00.000Z")

function build(referrer: string, search = "", pathname = "/", host = SITE) {
  return buildFirstTouch({ referrer, search, pathname, host, now: NOW })
}

describe("buildFirstTouch", () => {
  it("外部来源写成 referrer", () => {
    const ft = build("https://www.google.com/search?q=x", "", "/pricing")
    expect(ft.referrer).toBe("https://www.google.com/search?q=x")
    expect(ft.landing).toBe("/pricing")
    expect(ft.at).toBe("2026-09-28T10:00:00.000Z")
  })

  it("**站内跳转不算来源**（referrer 记为空串，而不是记我们自己）", () => {
    const ft = build("https://typenow.cn/home/courses", "", "/pricing")
    expect(ft.referrer).toBe("")
    // landing 仍然要记：它说明落地页是哪个
    expect(ft.landing).toBe("/pricing")
  })

  it("www 前缀与大小写差异都算自己人", () => {
    expect(build("https://WWW.TypeNow.cn/x").referrer).toBe("")
  })

  it("直接访问（没有 referrer）也要产出一个对象 —— 「记了但为空」与「没记」必须可区分", () => {
    const ft = build("")
    expect(ft.referrer).toBe("")
    expect(ft.landing).toBe("/")
    expect(ft.at).toBe(NOW.toISOString())
  })

  it("收集 utm_* 与 ref，并写进 landing 的 query", () => {
    const ft = build(
      "https://mp.weixin.qq.com/s/abc",
      "?utm_source=wechat&utm_medium=group&ref=AB12CD&other=1",
      "/",
    )
    expect(ft.utm).toEqual({ utm_source: "wechat", utm_medium: "group", ref: "AB12CD" })
    // landing 带完整 query，便于回看当时点的什么链接
    expect(ft.landing).toContain("utm_source=wechat")
  })

  it("search 不带问号、是空串、或含有非法内容都不炸", () => {
    expect(build("https://a.com", "utm_source=x").utm).toEqual({ utm_source: "x" })
    expect(build("https://a.com", "").utm).toEqual({})
    expect(build("https://a.com", "%%%").utm).toEqual({})
  })

  it("超长的 referrer 与 landing 会被截断（cookie 有大小限制）", () => {
    const longRef = `https://evil.example/${"a".repeat(2000)}`
    const ft = build(longRef, "", `/${"b".repeat(2000)}`)
    expect(ft.referrer.length).toBeLessThanOrEqual(512)
    expect(ft.landing.length).toBeLessThanOrEqual(512)
  })

  it("非 http(s) 的 referrer 不算外部来源（例如 android-app:// 或 javascript:）", () => {
    expect(build("android-app://com.tencent.mm/").referrer).toBe("")
    expect(build("javascript:alert(1)").referrer).toBe("")
  })
})

describe("serialize / parse 往返", () => {
  it("序列化后再解析应当等价", () => {
    const ft = build("https://www.google.com/", "?utm_source=google", "/learn")
    const back = parseFirstTouch(serializeFirstTouch(ft))
    expect(back).toEqual(ft)
  })

  it("没有 utm 时不写 u 键（cookie 每个请求都要带，能省则省）", () => {
    const raw = serializeFirstTouch(build("https://a.com"))
    expect(raw).not.toContain('"u"')
  })

  it("坏值一律当没有，绝不让注册流程失败", () => {
    for (const bad of [null, undefined, "", "not json", "[]", '"str"', "123", "null"]) {
      expect(parseFirstTouch(bad as string | null)).toBeNull()
    }
  })

  it("缺 landing 也缺时间 → 视为不是我们写的 cookie", () => {
    expect(parseFirstTouch(JSON.stringify({ r: "https://a.com" }))).toBeNull()
  })

  it("**只接受白名单里的 utm 键**：cookie 是客户端可改的，不接受任意键进库", () => {
    const parsed = parseFirstTouch(
      JSON.stringify({ l: "/", t: NOW.toISOString(), u: { utm_source: "ok", evil: "x" } }),
    )
    expect(parsed?.utm).toEqual({ utm_source: "ok" })
  })

  it("utm 值类型不对就丢掉，不做字符串强转", () => {
    const parsed = parseFirstTouch(
      JSON.stringify({ l: "/", t: NOW.toISOString(), u: { utm_source: 123 } }),
    )
    expect(parsed?.utm).toEqual({})
  })

  it("cookie 名与 TTL 是导出常量（客户端与服务端必须用同一个）", () => {
    expect(FIRST_TOUCH_COOKIE).toBe("typ_first_touch")
    expect(FIRST_TOUCH_MAX_AGE_DAYS).toBe(90)
  })
})

describe("describeFirstTouch", () => {
  it("有 utm_source 时优先显示它（微信内不带 Referer，utm 是我们能控制的那个）", () => {
    expect(describeFirstTouch("", { utm_source: "wechat", utm_medium: "group" })).toBe(
      "wechat / group",
    )
  })

  it("没有 utm 时显示来源主机名（去掉 www）", () => {
    expect(describeFirstTouch("https://www.google.com/search?q=x")).toBe("google.com")
  })

  it("记过但没有外部来源 = 直接访问（与「没记」区分开）", () => {
    expect(describeFirstTouch("")).toBe("直接访问")
  })

  it("referrer 不是合法 URL 时原样返回，不吞掉信息", () => {
    expect(referrerHost("weird-thing")).toBe("weird-thing")
  })
})
