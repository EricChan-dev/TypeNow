/**
 * 注册来源归因的纯逻辑单测。
 *
 * 覆盖三件事：词汇表（渠道 / 微信 scene 的中文映射）、白名单清洗
 * （signup_source 只收认识的键）、以及来源摘要的优先级。
 */
import { describe, it, expect } from "vitest"
import {
  SIGNUP_CHANNELS,
  SIGNUP_SOURCE_KEYS,
  WECHAT_SCENE_LABELS,
  signupChannelLabel,
  wechatSceneLabel,
  buildSignupSource,
  parseSignupSource,
  mergeSignupSource,
  signupFields,
  describeSignupSource,
  requestSignupContext,
} from "@/lib/signup-source"
import { clientIpOf, referrerOf, userAgentOf, truncateMeta, isExternalReferrer } from "@/lib/request-meta"

describe("词汇表", () => {
  it("渠道是有限集合，且都有中文名", () => {
    expect(SIGNUP_CHANNELS.length).toBeGreaterThan(0)
    for (const c of SIGNUP_CHANNELS) {
      expect(signupChannelLabel(c), `${c} 缺中文名`).not.toBe(c)
    }
  })

  it("认不出的渠道 / scene 原样返回，不吞掉信息", () => {
    expect(signupChannelLabel("some_new_channel")).toBe("some_new_channel")
    expect(wechatSceneLabel("ADD_SCENE_FUTURE")).toBe("ADD_SCENE_FUTURE")
    expect(signupChannelLabel(null)).toBe("—")
    expect(wechatSceneLabel(undefined)).toBe("—")
  })

  it("微信的 ADD_SCENE_* 都在词表里（这就是「他怎么找到我们的」那个答案）", () => {
    expect(WECHAT_SCENE_LABELS.ADD_SCENE_SEARCH).toBe("公众号搜索")
    expect(WECHAT_SCENE_LABELS.ADD_SCENE_QR_CODE).toBe("扫描二维码")
    expect(WECHAT_SCENE_LABELS.ADD_SCENE_PROFILE_CARD).toBe("名片分享")
  })
})

describe("buildSignupSource（白名单清洗）", () => {
  it("只保留白名单键，丢掉调用方多塞的", () => {
    const out = buildSignupSource({
      scene: "ADD_SCENE_SEARCH",
      ip: "1.2.3.4",
      // @ts-expect-error 故意塞一个不在白名单里的键
      evil: "x",
    })
    expect(out).toEqual({ scene: "ADD_SCENE_SEARCH", ip: "1.2.3.4" })
    expect(Object.keys(out!)).not.toContain("evil")
  })

  it("空值 / null / undefined 一律不写（避免库里出现一堆空字符串）", () => {
    expect(buildSignupSource({ scene: "", ip: null, referrer: undefined })).toBeNull()
    expect(buildSignupSource(null)).toBeNull()
    expect(buildSignupSource({})).toBeNull()
  })

  it("按字段各自的列宽截断", () => {
    const out = buildSignupSource({ ip: "9".repeat(200), qrScene: "a".repeat(200) })
    expect(out!.ip!.length).toBe(64)
    expect(out!.qrScene!.length).toBe(64)
  })

  it("utm 嵌套一层，只收字符串值", () => {
    const out = buildSignupSource({
      landing: "/",
      utm: { utm_source: "wechat", n: 1 as unknown as string },
    })
    expect(out!.utm).toEqual({ utm_source: "wechat" })
  })

  it("白名单键清单是导出的（文档与单测共用，加字段时不会漏）", () => {
    expect(SIGNUP_SOURCE_KEYS).toEqual(
      expect.arrayContaining(["scene", "qrScene", "referrer", "landing", "userAgent", "ip"]),
    )
  })
})

describe("parseSignupSource", () => {
  it("接受对象与 JSON 字符串两种形态", () => {
    expect(parseSignupSource({ scene: "ADD_SCENE_QR_CODE" })).toEqual({
      scene: "ADD_SCENE_QR_CODE",
    })
    expect(parseSignupSource('{"scene":"ADD_SCENE_QR_CODE"}')).toEqual({
      scene: "ADD_SCENE_QR_CODE",
    })
  })

  it("坏值当没有，不抛错", () => {
    for (const bad of [null, undefined, "", "not json", "[]", "3"]) {
      expect(parseSignupSource(bad as unknown)).toBeNull()
    }
  })

  it("读回来时同样过一遍白名单（库里的 JSON 可能被人工改过）", () => {
    expect(parseSignupSource({ scene: "s", whatever: 1 })).toEqual({ scene: "s" })
  })
})

describe("mergeSignupSource", () => {
  it("**合并而不是覆盖**：扫码链第一步的微信 scene 不能被第二步的浏览器字段抹掉", () => {
    const step1 = buildSignupSource({ scene: "ADD_SCENE_QR_CODE", qrScene: "abc_REF1" })
    const merged = mergeSignupSource(step1, { ip: "1.2.3.4", userAgent: "UA" })
    expect(merged).toEqual({
      scene: "ADD_SCENE_QR_CODE",
      qrScene: "abc_REF1",
      ip: "1.2.3.4",
      userAgent: "UA",
    })
  })

  it("补丁里的空值不会把已有值清掉", () => {
    const merged = mergeSignupSource({ scene: "ADD_SCENE_SEARCH" }, { ip: null, userAgent: "" })
    expect(merged).toEqual({ scene: "ADD_SCENE_SEARCH" })
  })

  it("两边都空时返回 null", () => {
    expect(mergeSignupSource(null, null)).toBeNull()
  })
})

describe("signupFields", () => {
  it("把微信侧、首触、请求侧三处信息合成一次写入", () => {
    const { signupChannel, signupSource } = signupFields({
      channel: "wechat_oa_qr",
      wechat: {
        subscribeScene: "ADD_SCENE_QR_CODE",
        qrScene: "deadbeef_REF1",
        subscribeTime: 1780000000,
      },
      firstTouch: {
        referrer: "https://mp.weixin.qq.com/s/x",
        landing: "/",
        utm: { utm_source: "wechat" },
        at: "2026-09-28T00:00:00.000Z",
      },
      request: { referrer: "https://typenow.cn/login", userAgent: "MicroMessenger", ip: "1.2.3.4" },
    })

    expect(signupChannel).toBe("wechat_oa_qr")
    expect(signupSource!.scene).toBe("ADD_SCENE_QR_CODE")
    expect(signupSource!.qrScene).toBe("deadbeef_REF1")
    // subscribe_time 是秒级时间戳，落库前转成 ISO
    expect(signupSource!.subscribedAt).toBe(new Date(1780000000 * 1000).toISOString())
    expect(signupSource!.referrer).toBe("https://mp.weixin.qq.com/s/x")
    expect(signupSource!.requestReferrer).toBe("https://typenow.cn/login")
    expect(signupSource!.utm).toEqual({ utm_source: "wechat" })
  })

  it("没有任何附加信息时 signupSource 为 null（只有渠道）", () => {
    const { signupSource } = signupFields({ channel: "dev" })
    expect(signupSource).toBeNull()
  })

  it("首触里的 utm 为空对象时不写 utm 键", () => {
    const { signupSource } = signupFields({
      channel: "phone",
      firstTouch: { referrer: "", landing: "/", utm: {}, at: "2026-09-28T00:00:00.000Z" },
    })
    expect(signupSource!.utm).toBeUndefined()
    expect(signupSource!.landing).toBe("/")
  })
})

describe("describeSignupSource（后台显示的一行话）", () => {
  it("微信 scene 优先：它回答的是「他怎么找到我们的」", () => {
    expect(
      describeSignupSource("wechat_oa_qr", { scene: "ADD_SCENE_SEARCH" }),
    ).toBe("公众号扫码 · 公众号搜索")
  })

  it("没有 scene 时用首触 utm，再退到 referrer 主机", () => {
    expect(describeSignupSource("wechat_open_qr", { utm: { utm_source: "weibo" } })).toBe(
      "开放平台扫码 · weibo",
    )
    expect(describeSignupSource("phone", { referrer: "https://www.google.com/x" })).toBe(
      "手机号 · google.com",
    )
  })

  it("记过首触但无外部来源 = 直接访问", () => {
    expect(describeSignupSource("phone", { landing: "/", referrer: "" })).toBe("手机号 · 直接访问")
  })

  it("**完全没有来源记录时只显示渠道**（存量用户就是这样，不能编造）", () => {
    expect(describeSignupSource("phone", null)).toBe("手机号")
    expect(describeSignupSource(null, null)).toBe("—")
  })

  it("库里的值是被改坏的 JSON 也不炸", () => {
    expect(describeSignupSource("phone", "{oops")).toBe("手机号")
  })

  it("**渠道为空但有 scene 时不显示占位符**（存量数据里就有一行这种）", () => {
    // 有 token 的两个存量用户建号路径无从考证，channel 留空但 scene 是真的：
    // "— · 公众号搜索" 会让人以为渠道那格坏了，而 scene 本身就是完整答案
    expect(describeSignupSource(null, { scene: "ADD_SCENE_SEARCH" })).toBe("公众号搜索")
  })

  it("渠道与来源都没有 → 一个占位符", () => {
    expect(describeSignupSource(null, {})).toBe("—")
  })
})

describe("request-meta（请求头提取，唯一实现）", () => {
  const mk = (h: Record<string, string>) => new Request("http://x/", { headers: h })

  it("IP 取 x-forwarded-for 的第一段，并归一 IPv6 映射写法", () => {
    expect(clientIpOf(mk({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4")
    expect(clientIpOf(mk({ "x-forwarded-for": "::ffff:127.0.0.1" }))).toBe("127.0.0.1")
    expect(clientIpOf(mk({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8")
    expect(clientIpOf(null)).toBeNull()
  })

  it("referrer / user-agent 取不到时返回 null", () => {
    expect(referrerOf(mk({ referer: "https://a.com" }))).toBe("https://a.com")
    expect(referrerOf(mk({}))).toBeNull()
    expect(userAgentOf(mk({ "user-agent": "UA" }))).toBe("UA")
    expect(userAgentOf(null)).toBeNull()
  })

  it("truncateMeta 截断并保留省略号，空串归一为 null", () => {
    expect(truncateMeta("abcdef", 4)).toBe("abc…")
    expect(truncateMeta("", 4)).toBeNull()
    expect(truncateMeta(undefined, 4)).toBeNull()
  })

  it("isExternalReferrer：同站（含 www/大小写/端口）不算外部", () => {
    expect(isExternalReferrer("https://typenow.cn/home", "typenow.cn")).toBe(false)
    expect(isExternalReferrer("https://www.TypeNow.cn/home", "typenow.cn")).toBe(false)
    expect(isExternalReferrer("https://typenow.cn/home", "typenow.cn:3000")).toBe(false)
    expect(isExternalReferrer("https://google.com/", "typenow.cn")).toBe(true)
    expect(isExternalReferrer("", "typenow.cn")).toBe(false)
    expect(isExternalReferrer("nonsense", "typenow.cn")).toBe(false)
  })

  it("requestSignupContext 一次取齐三个字段", () => {
    const req = mk({
      referer: "https://typenow.cn/login",
      "user-agent": "MicroMessenger/8.0",
      "x-forwarded-for": "203.0.113.9",
    })
    expect(requestSignupContext(req)).toEqual({
      referrer: "https://typenow.cn/login",
      userAgent: "MicroMessenger/8.0",
      ip: "203.0.113.9",
    })
    expect(requestSignupContext(null)).toEqual({ referrer: null, userAgent: null, ip: null })
  })
})
