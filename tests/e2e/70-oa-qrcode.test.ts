/**
 * 公众号扫码登录（/api/auth/wechat/oa-qrcode、/api/auth/wechat/oa-check）
 *
 * 环境前提：WECHAT_OA_* 被全部置空 → isWeChatOAConfigured() 为 false，
 * oa-qrcode 走 dev 分支，于是我们可以完整覆盖「生成二维码 → 轮询 → 建会话」
 * 这条闭环，而不需要真的连微信服务器。
 *
 * 这一组的核心是邀请码归属：scene 里必须带上 ref_code cookie 里的邀请码，
 * 否则公众号渠道注册的用户永远不会记到邀请人名下。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures } from "./helpers/db"

const REF_FIXTURE = FIXTURE.inviteCodePartner // "PARTNER8"

beforeEach(async () => {
  await seedFixtures()
})

describe("二维码生成 /api/auth/wechat/oa-qrcode", () => {
  it("绑定 session cookie 名一致：响应里种下 wechat_oa_scene，值与返回的 scene 相同", async () => {
    const api = ApiClient.anonymous()
    const res = await api.get<{ devMode: boolean; scene: string }>(
      "/api/auth/wechat/oa-qrcode"
    )

    expect(res.status).toBe(200)
    expect(res.body.devMode).toBe(true)
    expect(api.getCookie("wechat_oa_scene")).toBe(res.body.scene)
  })

  it("没有 ref_code cookie：scene 是纯随机串，不包含邀请码分隔符", async () => {
    const res = await ApiClient.anonymous().get<{ scene: string }>(
      "/api/auth/wechat/oa-qrcode"
    )
    expect(res.body.scene).toMatch(/^[0-9a-f]{48}$/)
    expect(res.body.scene).not.toContain("_")
  })

  it("带 ref_code cookie：scene 尾缀带上邀请码（随机部分保持 48 位十六进制）", async () => {
    const api = ApiClient.anonymous()
    api.setCookie("ref_code", REF_FIXTURE)

    const res = await api.get<{ scene: string }>("/api/auth/wechat/oa-qrcode")
    expect(res.body.scene).toMatch(new RegExp(`^[0-9a-f]{48}_${REF_FIXTURE}$`))
    // 微信 scene_str 上限 64 字符
    expect(res.body.scene.length).toBeLessThanOrEqual(64)
    // 随机部分不能被压缩：scene 同时是扫码登录的一次性令牌
    expect(res.body.scene.split("_")[0]).toHaveLength(48)
  })

  it("邀请码大小写不敏感，统一转成大写", async () => {
    const api = ApiClient.anonymous()
    api.setCookie("ref_code", REF_FIXTURE.toLowerCase())
    const res = await api.get<{ scene: string }>("/api/auth/wechat/oa-qrcode")
    expect(res.body.scene.endsWith(`_${REF_FIXTURE}`)).toBe(true)
  })

  it("非法 ref_code（过短/过长/含怪字符/带空格）一律忽略，不污染 scene", async () => {
    for (const bad of ["abc", "a".repeat(13), "PARTNER-8", "PART NER", "../../etc", "%00"]) {
      const api = ApiClient.anonymous()
      api.setCookie("ref_code", bad)
      const res = await api.get<{ scene: string }>("/api/auth/wechat/oa-qrcode")
      expect(res.body.scene).toMatch(/^[0-9a-f]{48}$/)
    }
  })

  it("每次生成的 scene 都不同（不能复用一次性令牌）", async () => {
    const a = await ApiClient.anonymous().get<{ scene: string }>("/api/auth/wechat/oa-qrcode")
    const b = await ApiClient.anonymous().get<{ scene: string }>("/api/auth/wechat/oa-qrcode")
    expect(a.body.scene).not.toBe(b.body.scene)
  })
})

describe("扫码登录闭环 /api/auth/wechat/oa-check", () => {
  it("缺少 scene cookie → 400 no_scene（前端据此提示二维码过期）", async () => {
    const res = await ApiClient.anonymous().get("/api/auth/wechat/oa-check")
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: "no_scene" })
  })

  it("带邀请码的 scene 不影响 dev 扫码登录：能建号并种下会话", async () => {
    const api = ApiClient.anonymous()
    api.setCookie("ref_code", REF_FIXTURE)

    const qr = await api.get<{ scene: string }>("/api/auth/wechat/oa-qrcode")
    const scene = qr.body.scene
    expect(scene.endsWith(`_${REF_FIXTURE}`)).toBe(true)

    const check = await api.get<{ success: boolean; isNewUser: boolean }>(
      `/api/auth/wechat/oa-check?dev_scene=${encodeURIComponent(scene)}`
    )
    expect(check.status).toBe(200)
    expect(check.body.success).toBe(true)
    expect(check.body.isNewUser).toBe(true)
    // 一次性令牌用完即清
    expect(api.getCookie("wechat_oa_scene")).toBeUndefined()

    const me = await api.get<{ user: { is_pro: boolean } }>("/api/auth/me")
    expect(me.status).toBe(200)
    // 公众号新用户送 3 天体验
    expect(me.body.user.is_pro).toBe(true)
  })

  it("scene 不匹配（伪造 dev_scene）→ 不返回 success", async () => {
    const api = ApiClient.anonymous()
    await api.get("/api/auth/wechat/oa-qrcode")

    const res = await api.get<{ success?: boolean }>(
      `/api/auth/wechat/oa-check?dev_scene=${"0".repeat(48)}`
    )
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(false)
  })
})
