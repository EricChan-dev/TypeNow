import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * 服务端人机校验（`src/lib/aliyun-captcha.ts`）的四条判定口径。
 *
 * SDK 是 mock 掉的：真调用要网络 + 真 AK，而这里要验的是**我们对返回值的解释**，
 * 尤其是那两条最容易被写反的：
 *   · 接口正常返回 `verifyResult: false` → **必须拦**（不能 fail-open）；
 *   · 接口抛异常 → **必须放行**（官方口径：验证码不应成为业务可用性的单点故障）。
 * 写反任何一条，要么形同虚设、要么阿里云一抖动全站发不出短信。
 */

const verifyResult = vi.fn()

class MockConfig {
  endpoint = ""
  readTimeout = 0
  connectTimeout = 0
  constructor(public opts: Record<string, unknown>) {}
}

class MockCaptchaClient {
  /** 最近一次构造出来的 client，供用例检查 endpoint / 超时等配置。 */
  static last: MockCaptchaClient | null = null
  constructor(public config: MockConfig) {
    MockCaptchaClient.last = this
  }
  verifyIntelligentCaptcha(request: unknown) {
    return verifyResult(request)
  }
}

class MockRequest {
  constructor(public body: Record<string, unknown>) {}
}

vi.mock("@alicloud/captcha20230305", () => ({
  default: MockCaptchaClient,
  VerifyIntelligentCaptchaRequest: MockRequest,
}))
vi.mock("@alicloud/openapi-core", () => ({
  $OpenApiUtil: { Config: MockConfig },
}))

const ENV_KEYS = [
  "NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID",
  "NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX",
  "ALIYUN_ACCESS_KEY_ID",
  "ALIYUN_ACCESS_KEY_SECRET",
] as const

const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, vars)
}

/** 每个用例都重新 import：模块里缓存了 SDK client，且 sceneId/AK 是调用时才读。 */
async function loadModule() {
  vi.resetModules()
  return await import("@/lib/aliyun-captcha")
}

beforeEach(() => {
  verifyResult.mockReset()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("isCaptchaConfigured", () => {
  it("两个 NEXT_PUBLIC 变量齐全时才算已配置", async () => {
    setEnv({ NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "s1" })
    expect((await loadModule()).isCaptchaConfigured()).toBe(false)

    setEnv({ NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1" })
    expect((await loadModule()).isCaptchaConfigured()).toBe(false)

    setEnv({
      NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "s1",
      NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1",
    })
    expect((await loadModule()).isCaptchaConfigured()).toBe(true)
  })

  it("只看 NEXT_PUBLIC 变量，不需要 AK（AK 是校验时才需要）", async () => {
    setEnv({
      NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "s1",
      NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1",
    })
    expect((await loadModule()).isCaptchaConfigured()).toBe(true)
  })
})

describe("verifyCaptcha：参数守卫", () => {
  const CONFIGURED = {
    NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "s1",
    NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1",
    ALIYUN_ACCESS_KEY_ID: "ak",
    ALIYUN_ACCESS_KEY_SECRET: "sk",
  }

  it("空参数 → fail（不是 unavailable）——这是防绕过的关键", async () => {
    setEnv(CONFIGURED)
    const { verifyCaptcha } = await loadModule()
    const verdict = await verifyCaptcha("")
    expect(verdict.result).toBe("fail")
    // 绝不能走到网络请求：空参数是「没验证过」，不是「阿里云挂了」
    expect(verifyResult).not.toHaveBeenCalled()
  })

  it("纯空白 → fail", async () => {
    setEnv(CONFIGURED)
    const { verifyCaptcha } = await loadModule()
    expect((await verifyCaptcha("   \n\t ")).result).toBe("fail")
    expect(verifyResult).not.toHaveBeenCalled()
  })

  it("超长参数 → fail（防滥用，不进网络）", async () => {
    setEnv(CONFIGURED)
    const { verifyCaptcha } = await loadModule()
    expect((await verifyCaptcha("x".repeat(8193))).result).toBe("fail")
    expect(verifyResult).not.toHaveBeenCalled()
  })

  it("恰好等于上限的参数会被送进 SDK（边界不算越界）", async () => {
    setEnv(CONFIGURED)
    verifyResult.mockResolvedValue({
      body: { result: { verifyResult: true } },
    })
    const { verifyCaptcha } = await loadModule()
    const verdict = await verifyCaptcha("x".repeat(8192))
    expect(verdict.result).toBe("pass")
    expect(verifyResult).toHaveBeenCalledTimes(1)
  })
})

describe("verifyCaptcha：对阿里云返回值的解释", () => {
  const CONFIGURED = {
    NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "s1",
    NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1",
    ALIYUN_ACCESS_KEY_ID: "ak",
    ALIYUN_ACCESS_KEY_SECRET: "sk",
  }

  it("verifyResult === true → pass，并带回 certifyId（用于安全审计/对账）", async () => {
    setEnv(CONFIGURED)
    verifyResult.mockResolvedValue({
      body: { result: { verifyResult: true, certifyId: "cert-1" } },
    })
    const { verifyCaptcha } = await loadModule()
    const verdict = await verifyCaptcha('{"sceneId":"s1"}')
    expect(verdict).toEqual({ result: "pass", certifyId: "cert-1" })
  })

  it("接口**正常返回** verifyResult:false → fail（官方口径：正常返回 false 必须拦）", async () => {
    setEnv(CONFIGURED)
    verifyResult.mockResolvedValue({
      body: { result: { verifyResult: false, verifyCode: "F001" } },
    })
    const { verifyCaptcha } = await loadModule()
    const verdict = await verifyCaptcha('{"sceneId":"s1"}')
    expect(verdict.result).toBe("fail")
    expect(verdict).toMatchObject({ code: "F001" })
  })

  it("接口返回体缺 result → fail（视为没通过，而不是放行）", async () => {
    setEnv(CONFIGURED)
    verifyResult.mockResolvedValue({ body: {} })
    const { verifyCaptcha } = await loadModule()
    expect((await verifyCaptcha('{"sceneId":"s1"}')).result).toBe("fail")
  })

  it("verifyResult 不是布尔 true（如字符串）→ fail（严格比较，不做弱等于）", async () => {
    setEnv(CONFIGURED)
    verifyResult.mockResolvedValue({
      body: { result: { verifyResult: "true" } },
    })
    const { verifyCaptcha } = await loadModule()
    expect((await verifyCaptcha('{"sceneId":"s1"}')).result).toBe("fail")
  })

  it("接口抛异常（超时/5xx/限流）→ unavailable，调用方据此放行", async () => {
    setEnv(CONFIGURED)
    verifyResult.mockRejectedValue(new Error("ETIMEDOUT"))
    const { verifyCaptcha } = await loadModule()
    const verdict = await verifyCaptcha('{"sceneId":"s1"}')
    expect(verdict.result).toBe("unavailable")
    expect(verdict).toMatchObject({ error: "ETIMEDOUT" })
  })

  it("抛的不是 Error（字符串/对象）也不会把异常漏出去", async () => {
    setEnv(CONFIGURED)
    verifyResult.mockRejectedValue("boom")
    const { verifyCaptcha } = await loadModule()
    const verdict = await verifyCaptcha('{"sceneId":"s1"}')
    expect(verdict.result).toBe("unavailable")
    expect(verdict).toMatchObject({ error: "boom" })
  })
})

describe("verifyCaptcha：配置不全时的行为", () => {
  it("缺场景 ID → unavailable（放行），不抛异常", async () => {
    setEnv({ ALIYUN_ACCESS_KEY_ID: "ak", ALIYUN_ACCESS_KEY_SECRET: "sk" })
    const { verifyCaptcha } = await loadModule()
    expect((await verifyCaptcha("param")).result).toBe("unavailable")
    expect(verifyResult).not.toHaveBeenCalled()
  })

  it("缺 AK → unavailable（放行）", async () => {
    setEnv({
      NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "s1",
      NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1",
    })
    const { verifyCaptcha } = await loadModule()
    expect((await verifyCaptcha("param")).result).toBe("unavailable")
    expect(verifyResult).not.toHaveBeenCalled()
  })
})

describe("verifyCaptcha：请求构造", () => {
  it("原样透传参数并把 SceneId 一并交给 SDK（防止前端被换成别的场景）", async () => {
    setEnv({
      NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "scene-9",
      NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1",
      ALIYUN_ACCESS_KEY_ID: "ak",
      ALIYUN_ACCESS_KEY_SECRET: "sk",
    })
    verifyResult.mockResolvedValue({ body: { result: { verifyResult: true } } })
    const { verifyCaptcha } = await loadModule()
    await verifyCaptcha("  RAW-PARAM  ")

    const sent = verifyResult.mock.calls[0][0] as { body: Record<string, unknown> }
    expect(sent.body).toEqual({
      captchaVerifyParam: "RAW-PARAM", // 前后空白被裁掉，其余**不做任何改动**
      sceneId: "scene-9",
    })
  })

  it("endpoint 固定为中国内地站点（必须与客户端 region:'cn' 一致）", async () => {
    setEnv({
      NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID: "s1",
      NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX: "p1",
      ALIYUN_ACCESS_KEY_ID: "ak",
      ALIYUN_ACCESS_KEY_SECRET: "sk",
    })
    verifyResult.mockResolvedValue({ body: { result: { verifyResult: true } } })
    const { verifyCaptcha } = await loadModule()
    await verifyCaptcha("p")
    expect(MockCaptchaClient.last?.config.endpoint).toBe(
      "captcha.cn-shanghai.aliyuncs.com",
    )
    // 超时必须设短：这一步在用户点「获取验证码」的关键路径上，
    // 宁可快速 fail-open，也不要把人晾在那等一个可能永远不来的响应。
    expect(MockCaptchaClient.last?.config.readTimeout).toBe(5000)
    expect(MockCaptchaClient.last?.config.connectTimeout).toBe(3000)
  })
})
