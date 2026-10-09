import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * `/api/auth/send-sms` 的人机校验闸门。
 *
 * 这是**两个发短信入口**（登录页、设置页绑定手机号）共用的唯一后端入口，
 * 所以校验只在这里做一次、也必须在这里做对。
 *
 * 本用例把 `@/lib/aliyun-captcha` 整个 mock 掉：这里要验的是**路由的编排**
 * （参数缺失拦不拦、失败拦不拦、不可用放不放行、顺序对不对），
 * 而不是校验实现本身（那在 captcha.test.ts 里覆盖）。
 *
 * 无 DATABASE_URL 时 `db` 为 null，路由会在校验通过后短路返回"开发模式"
 * 成功响应 —— 正好让我们不用起数据库就能观察到闸门到底放行还是拦截。
 */

const isCaptchaConfigured = vi.fn()
const verifyCaptcha = vi.fn()

vi.mock("@/lib/aliyun-captcha", () => ({
  isCaptchaConfigured: () => isCaptchaConfigured(),
  verifyCaptcha: (p: string) => verifyCaptcha(p),
}))

async function loadRoute() {
  vi.resetModules()
  return await import("@/app/api/auth/send-sms/route")
}

function post(body: unknown) {
  return new Request("http://localhost/api/auth/send-sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  isCaptchaConfigured.mockReset()
  verifyCaptcha.mockReset()
})

describe("send-sms 人机校验闸门", () => {
  it("未配置人机校验时完全不介入（本地开发/未开通环境不受影响）", async () => {
    isCaptchaConfigured.mockReturnValue(false)
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000" }))
    expect(res.status).toBe(200)
    expect(verifyCaptcha).not.toHaveBeenCalled()
  })

  it("已配置但请求没带 captchaVerifyParam → 400 拦下（fail-closed，防掐 CDN 绕过）", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000" }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.captchaFailed).toBe(true)
    // 关键：连校验请求都不该发出去 —— 没参数就是"没验证过"
    expect(verifyCaptcha).not.toHaveBeenCalled()
  })

  it("空字符串 / 纯空白 参数同样被拦（不能靠塞空串绕过）", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    const { POST } = await loadRoute()

    for (const bad of ["", "   ", "\n"]) {
      const res = await POST(post({ phone: "13800138000", captchaVerifyParam: bad }))
      expect(res.status, `参数 ${JSON.stringify(bad)} 应被拦`).toBe(400)
    }
    expect(verifyCaptcha).not.toHaveBeenCalled()
  })

  it("参数不是字符串（如对象/数字）也被拦，不会漏给 SDK", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    const { POST } = await loadRoute()

    for (const bad of [123, {}, [], true, null]) {
      const res = await POST(post({ phone: "13800138000", captchaVerifyParam: bad }))
      expect(res.status, `参数 ${JSON.stringify(bad)} 应被拦`).toBe(400)
    }
    expect(verifyCaptcha).not.toHaveBeenCalled()
  })

  it("校验判定 fail → 400 拦下，并标记 captchaFailed（前端据此刷新验证码）", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    verifyCaptcha.mockResolvedValue({ result: "fail", code: "F001" })
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captchaVerifyParam: "p" }))
    expect(res.status).toBe(400)
    expect((await res.json()).captchaFailed).toBe(true)
    expect(verifyCaptcha).toHaveBeenCalledWith("p")
  })

  it("校验判定 pass → 放行到后续业务", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    verifyCaptcha.mockResolvedValue({ result: "pass", certifyId: "c1" })
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captchaVerifyParam: "p" }))
    expect(res.status).toBe(200)
  })

  it("校验服务不可用（超时/5xx）→ **放行**，不阻塞短信", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    verifyCaptcha.mockResolvedValue({ result: "unavailable", error: "ETIMEDOUT" })
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captchaVerifyParam: "p" }))
    expect(res.status).toBe(200)
  })

  it("手机号非法时不走人机校验（先拦参数，不做无谓的外部调用）", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "12345", captchaVerifyParam: "p" }))
    expect(res.status).toBe(400)
    expect(verifyCaptcha).not.toHaveBeenCalled()
  })

  it("请求体不是合法 JSON → 400，不抛异常", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    const { POST } = await loadRoute()

    const res = await POST(
      new Request("http://localhost/api/auth/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("原样透传参数给校验实现（不得做任何改写，官方明确要求）", async () => {
    isCaptchaConfigured.mockReturnValue(true)
    verifyCaptcha.mockResolvedValue({ result: "pass" })
    const { POST } = await loadRoute()

    await POST(
      post({ phone: "13800138000", captchaVerifyParam: '{"sceneId":"s1"}' }),
    )
    expect(verifyCaptcha).toHaveBeenCalledWith('{"sceneId":"s1"}')
  })
})
