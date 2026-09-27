/**
 * 链路：注册来源归因
 *
 * 起因（2026-09-28）：老板问「新增用户是从哪里来的，我还没对外推广过」，
 * 而系统**答不了** —— 建号时既没记渠道也没记来源。22 个微信用户只能事后写
 * 临时脚本去微信接口捞 subscribe_scene，还捞不回 referrer / UA / IP。
 *
 * 这个套件要把「以后能答」这件事钉住：
 *   1. 每条建号路径都写下 signup_channel
 *   2. 请求侧字段（Referer / UA / IP）真的落了库
 *   3. 首触 cookie 的来源被优先采用 —— 而不是注册那一刻**我们自己**的 /login
 *   4. 坏 cookie / 缺头都不能让注册失败（归因是旁路）
 *   5. register_success 事件带上渠道（users 表答不了"哪天从哪个渠道来的"）
 *   6. 后台列表与详情能看到来源
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { seedFixtures, q, one } from "./helpers/db"
import { insertUser, insertVerificationCode, nextPhone } from "./helpers/factories"
import { FIRST_TOUCH_COOKIE, serializeFirstTouch, type FirstTouch } from "@/lib/first-touch"

interface SignupRow {
  id: string
  signup_channel: string | null
  signup_source: Record<string, unknown> | string | null
}

/** mysql2 对 JSON 列的行为随版本而异，断言前统一归一 */
function sourceOf(row: SignupRow): Record<string, unknown> {
  const v = row.signup_source
  if (!v) return {}
  return typeof v === "string" ? JSON.parse(v) : v
}

async function userByPhone(phone: string): Promise<SignupRow | undefined> {
  return one<SignupRow>(
    "SELECT id, signup_channel, signup_source FROM users WHERE phone = ?",
    [phone],
  )
}

const FIRST_TOUCH: FirstTouch = {
  referrer: "https://mp.weixin.qq.com/s/some-article",
  landing: "/pricing?utm_source=wechat&utm_medium=group",
  utm: { utm_source: "wechat", utm_medium: "group" },
  at: "2026-09-28T02:00:00.000Z",
}

function cookieFor(ft: FirstTouch): string {
  return encodeURIComponent(serializeFirstTouch(ft))
}

/** 走手机号注册（e2e 里唯一能不依赖微信就建号的真实路径） */
async function registerByPhone(
  api: ApiClient,
  phone: string,
  opts: { headers?: Record<string, string>; firstTouch?: FirstTouch | null; rawCookie?: string } = {},
): Promise<number> {
  await insertVerificationCode(phone, "123456")
  if (opts.rawCookie !== undefined) api.setCookie(FIRST_TOUCH_COOKIE, opts.rawCookie)
  else if (opts.firstTouch) api.setCookie(FIRST_TOUCH_COOKIE, cookieFor(opts.firstTouch))

  const res = await api.post(
    "/api/auth/verify-code",
    { phone, code: "123456" },
    {
      headers: {
        referer: "https://typenow.cn/login",
        "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "x-forwarded-for": "203.0.113.77, 10.0.0.1",
        ...opts.headers,
      },
    },
  )
  return res.status
}

beforeEach(async () => {
  await seedFixtures()
})

describe("注册来源：手机号渠道", () => {
  it("渠道 + 请求侧字段 + 首触来源全部落库", async () => {
    const phone = nextPhone()
    const status = await registerByPhone(ApiClient.anonymous(), phone, { firstTouch: FIRST_TOUCH })
    expect(status).toBe(200)

    const row = await userByPhone(phone)
    expect(row?.signup_channel).toBe("phone")

    const src = sourceOf(row!)
    // 首触来源（外部来源）—— 这才是"他从哪来"的答案
    expect(src.referrer).toBe("https://mp.weixin.qq.com/s/some-article")
    expect(src.landing).toContain("utm_source=wechat")
    expect(src.utm).toEqual({ utm_source: "wechat", utm_medium: "group" })
    // 注册那次请求本身的信息（排查用）
    expect(src.requestReferrer).toBe("https://typenow.cn/login")
    expect(String(src.userAgent)).toContain("Macintosh")
    // x-forwarded-for 取第一段（最后一段是代理）
    expect(src.ip).toBe("203.0.113.77")
  })

  it("**没有首触 cookie 时不会把「我们自己」记成来源**", async () => {
    const phone = nextPhone()
    await registerByPhone(ApiClient.anonymous(), phone)

    const src = sourceOf((await userByPhone(phone))!)
    // requestReferrer 是我们自己的 /login（排查用），但 referrer（=首触来源）必须为空，
    // 否则归因报表会把"从登录页跳来的"算成一个真实来源
    expect(src.referrer).toBeUndefined()
    expect(src.requestReferrer).toBe("https://typenow.cn/login")
  })

  it("首触 cookie 被改坏 / 是垃圾值时，注册照常成功，只是没有首触来源", async () => {
    const phone = nextPhone()
    const status = await registerByPhone(ApiClient.anonymous(), phone, {
      rawCookie: "%7Bnot-json",
    })
    expect(status).toBe(200)

    const row = await userByPhone(phone)
    expect(row?.signup_channel).toBe("phone")
    expect(sourceOf(row!).referrer).toBeUndefined()
  })

  it("首触里的 utm 只收白名单键（cookie 是客户端可改的，不接受任意键进库）", async () => {
    const phone = nextPhone()
    const poisoned = encodeURIComponent(
      JSON.stringify({ r: "https://a.com", l: "/", t: "2026-09-28T00:00:00.000Z", u: { utm_source: "ok", evil: "payload" } }),
    )
    await registerByPhone(ApiClient.anonymous(), phone, { rawCookie: poisoned })

    const src = sourceOf((await userByPhone(phone))!)
    expect(src.utm).toEqual({ utm_source: "ok" })
    expect(JSON.stringify(src)).not.toContain("payload")
  })

  it("同一个人第二次登录不会新建账号，也不会覆盖已有的来源", async () => {
    const phone = nextPhone()
    await registerByPhone(ApiClient.anonymous(), phone, { firstTouch: FIRST_TOUCH })
    const first = await userByPhone(phone)

    // 第二次（没有首触 cookie）：find-or-create 命中已有用户
    const api2 = ApiClient.anonymous()
    await registerByPhone(api2, phone)
    const again = await userByPhone(phone)

    expect(again?.id).toBe(first?.id)
    expect(sourceOf(again!).referrer).toBe("https://mp.weixin.qq.com/s/some-article")
  })
})

describe("注册来源：开发旁路", () => {
  it("dev-login 建的号打上 dev 渠道（否则本地调试会污染来源统计）", async () => {
    const res = await ApiClient.anonymous().get("/api/auth/dev-login", { redirect: "manual" })
    expect([302, 307]).toContain(res.status)

    const row = await one<SignupRow>(
      "SELECT id, signup_channel, signup_source FROM users WHERE wechat_openid = ?",
      ["dev_qrcode_login"],
    )
    expect(row?.signup_channel).toBe("dev")
  })
})

describe("注册来源：register_success 事件", () => {
  it("注册时由服务端写一条带渠道的事件（users 表答不了「哪天从哪个渠道来的」）", async () => {
    const phone = nextPhone()
    await registerByPhone(ApiClient.anonymous(), phone, { firstTouch: FIRST_TOUCH })
    const row = await userByPhone(phone)

    const ev = await one<{ event_type: string; properties: unknown; page_url: string }>(
      "SELECT event_type, properties, page_url FROM analytics_events WHERE user_id = ? AND event_type = ?",
      [row!.id, "register_success"],
    )
    expect(ev).toBeTruthy()
    const props = typeof ev!.properties === "string" ? JSON.parse(ev!.properties) : ev!.properties
    expect((props as { channel: string }).channel).toBe("phone")
  })

  it("事件名必须仍在白名单内（否则 recordServerEvent 会静默丢弃）", async () => {
    const phone = nextPhone()
    await registerByPhone(ApiClient.anonymous(), phone)
    const row = await userByPhone(phone)
    const n = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM analytics_events WHERE user_id = ? AND event_type = ?",
      [row!.id, "register_success"],
    )
    expect(Number(n?.c)).toBe(1)
  })
})

describe("注册来源：后台可见", () => {
  async function makeAdmin(): Promise<string> {
    const id = await insertUser({ name: "来源管理员" })
    await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
    return id
  }

  it("用户列表带出算好的来源摘要", async () => {
    const phone = nextPhone()
    await registerByPhone(ApiClient.anonymous(), phone, { firstTouch: FIRST_TOUCH })

    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ data: Array<{ phone: string; signupLabel: string; signupChannel: string }> }>(
      "/api/admin/users?pageSize=100",
    )
    const me = res.body.data.find((u) => u.phone === phone)
    expect(me?.signupChannel).toBe("phone")
    // 摘要由后端算好（渠道 · 来源），前端不重复实现优先级。
    // 这里断言**字面量**而不是再调一次 describeSignupSource —— 后者等于拿函数
    // 验证它自己，接不上线（接口少返一个字段也照样"通过"）。
    // 优先级是 utm > referrer：utm 是我们自己打的标签（更具体），
    // 而 referrer 只到 "mp.weixin.qq.com" 这一级。
    expect(me?.signupLabel).toBe("手机号 · wechat/group")
  })

  it("用户详情返回原始 signup_source（详情页要展示明细）", async () => {
    const phone = nextPhone()
    await registerByPhone(ApiClient.anonymous(), phone, { firstTouch: FIRST_TOUCH })
    const row = await userByPhone(phone)

    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ data: { signupChannel: string; signupSource: Record<string, unknown> } }>(
      `/api/admin/users/${row!.id}`,
    )
    expect(res.body.data.signupChannel).toBe("phone")
    expect(res.body.data.signupSource.referrer).toBe(FIRST_TOUCH.referrer)
    // 脱敏仍然生效：token/openid 之类不该出现在详情里
    expect(JSON.stringify(res.body.data)).not.toContain("wechatAccessToken")
  })

  it("存量用户（没有来源记录）显示渠道名而不是编造一个来源", async () => {
    const id = await insertUser({ name: "存量用户" })
    await q("UPDATE users SET signup_channel = NULL, signup_source = NULL WHERE id = ?", [id])

    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ data: Array<{ id: string; signupLabel: string }> }>(
      "/api/admin/users?pageSize=100&q=存量用户",
    )
    const found = res.body.data.find((u) => u.id === id)
    expect(found?.signupLabel).toBe("—")
  })
})
