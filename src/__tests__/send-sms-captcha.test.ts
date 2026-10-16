import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * `/api/auth/send-sms` 的人机校验闸门（自建滑块拼图版）。
 *
 * 这是**两个发短信入口**（登录页、设置页绑定手机号）共用的唯一后端入口，
 * 所以校验只在这里做一次、也必须在这里做对。
 *
 * 契约（旧阿里云方案的替代，同样 fail-closed）：
 *   · 请求体带 captcha: { id, x, duration, trail }；缺参/类型不对 → 400 captchaFailed
 *   · id 先**原子认领**（used 0→1，一题一用，无论对错——防对同一题枚举 x）；
 *     认领不到（不存在/已用/已过期）→ 400 captchaFailed
 *   · 再按库里的 answerX 判分（±5px，见 slider-captcha.test.ts）；
 *     不过 → 400 captchaFailed
 *   · 全过才放行到限流与发信。全程没有"不可用放行"分支 —— 服务端自管题目，
 *     不存在外部服务异常的借口。
 *
 * captchaFailed 标记的语义：前端 SmsSlider 据此区分「人机没过」（reject →
 * 控件自动换题重拖）与「业务失败」（resolve + 提示，不把用户赶回去重拖）。
 *
 * 这里 mock 掉 db / aliyun-sms / verifySliderAnswer：验的是**路由的编排**
 * （顺序、拦与放、标记对不对），判分实现在 slider-captcha.test.ts。
 */

const h = vi.hoisted(() => {
  // 形状感知的假 db：按 select 投影的键名决定返回行，模拟各段查询。
  let updateAffectedRows = 1
  let challengeRows: Array<{ answerX: number }> = [{ answerX: 100 }]
  let rateRows: Record<string, number> = { ipCount: 0, ph1h: 0, ph24h: 0 }
  let recentRows: Array<{ createdAt: Date }> = []
  const updateCalls: Array<{ set: unknown; table: unknown }> = []

  // 链式假查询：await 立刻解析为 rows，同时支持 .orderBy().limit() 与 .catch()
  function chain(rows: unknown[]) {
    const make = () => {
      const p = {
        then: (res: (v: unknown[]) => unknown) => res(rows),
        catch: () => make(),
        orderBy: () => make(),
        limit: () => make(),
      }
      return p
    }
    return {
      from: () => ({
        where: () => make(),
      }),
    }
  }

  const db = {
    update: (table: unknown) => ({
      set: (vals: unknown) => ({
        where: async () => {
          updateCalls.push({ set: vals, table })
          return [{ affectedRows: updateAffectedRows }]
        },
      }),
    }),
    select: (proj: Record<string, unknown> | undefined) => {
      const keys = Object.keys(proj ?? {})
      if (keys.includes("answerX")) return chain(challengeRows)
      if (keys.includes("ipCount")) return chain([{ ipCount: rateRows.ipCount }])
      if (keys.includes("ph1h")) return chain([{ ph1h: rateRows.ph1h }])
      if (keys.includes("ph24h")) return chain([{ ph24h: rateRows.ph24h }])
      if (keys.includes("createdAt")) return chain(recentRows)
      return chain([])
    },
    insert: () => ({ values: async () => {} }),
    delete: () => ({ where: async () => {} }),
  }

  return {
    db,
    updateCalls,
    reset(opts?: { affectedRows?: number; answerX?: number; ph1h?: number; recent?: boolean }) {
      updateAffectedRows = opts?.affectedRows ?? 1
      challengeRows = [{ answerX: opts?.answerX ?? 100 }]
      rateRows = { ipCount: 0, ph1h: opts?.ph1h ?? 0, ph24h: 0 }
      recentRows = opts?.recent ? [{ createdAt: new Date() }] : []
      updateCalls.length = 0
    },
    sendVerificationCode: vi.fn(),
    verifySliderAnswer: vi.fn(),
  }
})

vi.mock("@/lib/db", () => ({ db: h.db }))
vi.mock("@/lib/aliyun-sms", () => ({ sendVerificationCode: h.sendVerificationCode }))
vi.mock("@/lib/slider-captcha", () => ({ verifySliderAnswer: h.verifySliderAnswer }))

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

const VALID_CAPTCHA = { id: "ch-1", x: 102, duration: 800, trail: [[0, 0], [50, 1], [102, 2]] }

beforeEach(() => {
  h.reset()
  h.verifySliderAnswer.mockReturnValue(true)
  h.sendVerificationCode.mockResolvedValue({ success: true })
  process.env.ALIYUN_ACCESS_KEY_ID = "test-key"
  process.env.ALIYUN_ACCESS_KEY_SECRET = "test-secret"
})

afterEach(() => {
  delete process.env.ALIYUN_ACCESS_KEY_ID
  delete process.env.ALIYUN_ACCESS_KEY_SECRET
  vi.restoreAllMocks()
})

describe("send-sms 人机校验闸门（自建滑块）", () => {
  it("没带 captcha → 400 captchaFailed，且不碰题目表（fail-closed）", async () => {
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000" }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.captchaFailed).toBe(true)
    expect(h.updateCalls).toHaveLength(0)
  })

  it("captcha.id 不是非空字符串（数字/对象/null/空串）一律拦下", async () => {
    const { POST } = await loadRoute()

    for (const bad of [123, {}, [], true, null, ""]) {
      const res = await POST(post({ phone: "13800138000", captcha: { ...VALID_CAPTCHA, id: bad } }))
      expect(res.status, `id=${JSON.stringify(bad)} 应被拦`).toBe(400)
      expect((await res.json()).captchaFailed).toBe(true)
    }
    expect(h.updateCalls).toHaveLength(0)
  })

  it("手机号非法时先拦参数，不做无谓的题目认领", async () => {
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "12345", captcha: VALID_CAPTCHA }))
    expect(res.status).toBe(400)
    expect(h.updateCalls).toHaveLength(0)
    expect(h.verifySliderAnswer).not.toHaveBeenCalled()
  })

  it("认领失败（题目已用/过期/不存在，affectedRows=0）→ 400 captchaFailed", async () => {
    h.reset({ affectedRows: 0 })
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captcha: VALID_CAPTCHA }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain("已失效")
    expect(data.captchaFailed).toBe(true)
    // 认领失败就不该再读答案、更不该判分
    expect(h.verifySliderAnswer).not.toHaveBeenCalled()
  })

  it("判分不过 → 400 captchaFailed（但题目已被认领消费）", async () => {
    h.verifySliderAnswer.mockReturnValue(false)
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captcha: VALID_CAPTCHA }))
    expect(res.status).toBe(400)
    expect((await res.json()).captchaFailed).toBe(true)
    expect(h.updateCalls).toHaveLength(1)
  })

  it("判分依据来自库里的 answerX，x/duration/trail 原样透传给判分器", async () => {
    h.reset({ answerX: 137 })
    const { POST } = await loadRoute()

    await POST(post({ phone: "13800138000", captcha: VALID_CAPTCHA }))
    expect(h.verifySliderAnswer).toHaveBeenCalledWith({
      expectedX: 137,
      x: 102,
      duration: 800,
      trail: [[0, 0], [50, 1], [102, 2]],
    })
  })

  it("人机通过 + 短信成功 → 200，验证码入库走原链路", async () => {
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captcha: VALID_CAPTCHA }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(h.sendVerificationCode).toHaveBeenCalledTimes(1)
  })

  it("人机通过但发送超限（429）不带 captchaFailed —— 人机已过，前端不该把用户赶回去重拖", async () => {
    h.reset({ ph1h: 5 })
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captcha: VALID_CAPTCHA }))
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.captchaFailed).toBeUndefined()
  })

  it("短信服务未配置 → 500（人机已通过的业务失败，同样不带 captchaFailed）", async () => {
    delete process.env.ALIYUN_ACCESS_KEY_ID
    const { POST } = await loadRoute()

    const res = await POST(post({ phone: "13800138000", captcha: VALID_CAPTCHA }))
    expect(res.status).toBe(500)
    expect((await res.json()).captchaFailed).toBeUndefined()
  })

  it("请求体不是合法 JSON → 400，不抛异常", async () => {
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
})
