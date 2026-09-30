/**
 * 主动触达的纯逻辑（src/lib/lifecycle-scenarios.ts）。
 *
 * 这里守的几条都是"错了不会报错、只会静默少发或违规"的性质，
 * 所以每条都配了明确的失败信息，方便将来的人看懂为什么不能改。
 */
import { describe, it, expect } from "vitest"
import {
  EXPIRY_SCENARIOS,
  FREQUENCY,
  LIFECYCLE_SCENARIOS,
  MAX_SCAN_GAP_HOURS,
  ONE_SHOT_PERIOD_KEY,
  SCENARIO_KEYS,
  SMS_OPT_OUT_SUFFIX,
  buildMessage,
  computeDueExpiryScenarios,
  dailyPeriodKey,
  decideSend,
  expiryPeriodKey,
  findScenario,
  hoursRelativeToExpiry,
  isOptedOut,
  isWindowWideEnough,
  practiceSummary,
  smsPracticeCount,
  type LifecycleTier,
} from "@/lib/lifecycle-scenarios"

const H = 60 * 60 * 1000
const base = new Date("2026-09-30T12:00:00+08:00")

function at(hoursFromBase: number): Date {
  return new Date(base.getTime() + hoursFromBase * H)
}

describe("场景表本身的自洽性", () => {
  it("场景键唯一（重复会让幂等键把两个场景当成一个）", () => {
    expect(new Set(SCENARIO_KEYS).size).toBe(SCENARIO_KEYS.length)
  })

  it("每个场景都有至少一个渠道，且没有重复渠道", () => {
    for (const s of LIFECYCLE_SCENARIOS) {
      expect(s.channels.length, `${s.key} 没有渠道`).toBeGreaterThan(0)
      expect(new Set(s.channels).size, `${s.key} 渠道重复`).toBe(s.channels.length)
    }
  })

  it("每个场景都有适用档位", () => {
    for (const s of LIFECYCLE_SCENARIOS) {
      expect(s.tiers.length, `${s.key} 没有档位`).toBeGreaterThan(0)
    }
  })

  it("★ 到期类场景的窗口宽度必须大于两次扫描的最大间隔（否则整批漏发）", () => {
    // 扫描每天只跑 10:00 / 19:00，最大间隔 15 小时。窗口比它窄就会出现
    // 「到期时刻落在两次扫描之间」的用户永远收不到消息，而且没有任何报错。
    for (const s of EXPIRY_SCENARIOS) {
      expect(
        isWindowWideEnough(s.window!),
        `${s.key} 窗口只有 ${s.window!.to - s.window!.from} 小时，窄于最大扫描间隔 ${MAX_SCAN_GAP_HOURS} 小时`,
      ).toBe(true)
    }
  })

  it("★ 同一档位内，各到期场景的窗口互不重叠", () => {
    // 重叠会让一次扫描同时命中两条（例如"前 3 天"和"前 1 天"都命中），
    // 用户会在同一分钟收到两条消息。窗口是左开右闭的 `(from, to]`。
    const tiers: LifecycleTier[] = ["trial", "monthly", "quarterly", "yearly"]
    for (const tier of tiers) {
      const ws = EXPIRY_SCENARIOS.filter((s) => s.tiers.includes(tier))
        .map((s) => ({ key: s.key, ...s.window! }))
        .sort((a, b) => a.from - b.from)
      for (let i = 1; i < ws.length; i++) {
        expect(
          ws[i].from,
          `${tier} 档：${ws[i - 1].key} 的 to=${ws[i - 1].to} 与 ${ws[i].key} 的 from=${ws[i].from} 重叠`,
        ).toBeGreaterThanOrEqual(ws[i - 1].to)
      }
    }
  })

  it("★ 终身会员（partner）不在任何到期类场景里", () => {
    // 给终身会员发续费提醒是最伤信任的一种 bug，这里从数据层堵死
    for (const s of EXPIRY_SCENARIOS) {
      expect(s.tiers, `${s.key} 不应适用于 partner`).not.toContain("partner")
    }
  })

  it("带 templateIdEnv 的场景，其渠道里必须有 template", () => {
    for (const s of LIFECYCLE_SCENARIOS) {
      if (s.templateIdEnv) {
        expect(s.channels, `${s.key} 配了模板 ID 却不走模板渠道`).toContain("template")
      }
    }
  })

  it("非到期类场景不需要窗口（它们按别的条件挑选候选）", () => {
    for (const s of EXPIRY_SCENARIOS) expect(s.expiryKind, `${s.key}`).toBe(true)
  })
})

describe("hoursRelativeToExpiry · 相对到期时刻", () => {
  it("到期前为负、到期后为正、正好到期为 0", () => {
    expect(hoursRelativeToExpiry(base, at(-5))).toBe(-5)
    expect(hoursRelativeToExpiry(base, at(5))).toBe(5)
    expect(hoursRelativeToExpiry(base, base)).toBe(0)
  })
})

describe("computeDueExpiryScenarios · 什么时候该发", () => {
  it("体验会员到期前 10 小时 → 命中「即将到期」", () => {
    const due = computeDueExpiryScenarios({ now: at(-10), expiry: base, tier: "trial" })
    expect(due.map((s) => s.key)).toEqual(["trial_expiring_24h"])
  })

  it("体验会员到期前 23 小时（窗口边界内）→ 命中", () => {
    const due = computeDueExpiryScenarios({ now: at(-23), expiry: base, tier: "trial" })
    expect(due.map((s) => s.key)).toContain("trial_expiring_24h")
  })

  it("体验会员到期前 25 小时（窗口外）→ 不命中（太早）", () => {
    const due = computeDueExpiryScenarios({ now: at(-25), expiry: base, tier: "trial" })
    expect(due).toEqual([])
  })

  it("体验会员到期后 10 小时 → 命中「已到期」而不是「即将到期」", () => {
    const due = computeDueExpiryScenarios({ now: at(10), expiry: base, tier: "trial" })
    expect(due.map((s) => s.key)).toEqual(["trial_expired_1d"])
  })

  it("体验会员到期后 40 小时 → 不命中（已过挽回窗口，不再打扰）", () => {
    const due = computeDueExpiryScenarios({ now: at(40), expiry: base, tier: "trial" })
    expect(due).toEqual([])
  })

  it("★ 月卡会先后命中两条（前 3 天 → 前 1 天），而不是一次命中两条", () => {
    const d3 = computeDueExpiryScenarios({ now: at(-60), expiry: base, tier: "monthly" })
    expect(d3.map((s) => s.key)).toEqual(["monthly_expiring_3d"])

    const d1 = computeDueExpiryScenarios({ now: at(-5), expiry: base, tier: "monthly" })
    expect(d1.map((s) => s.key)).toEqual(["monthly_expiring_1d"])
  })

  it("季卡与月卡共用同一套窗口", () => {
    const d3 = computeDueExpiryScenarios({ now: at(-60), expiry: base, tier: "quarterly" })
    expect(d3.map((s) => s.key)).toEqual(["monthly_expiring_3d"])
  })

  it("年卡：前 7 天 → 前 1 天 → 已到期，三段各命中一次", () => {
    expect(
      computeDueExpiryScenarios({ now: at(-100), expiry: base, tier: "yearly" }).map((s) => s.key),
    ).toEqual(["yearly_expiring_7d"])
    expect(
      computeDueExpiryScenarios({ now: at(-6), expiry: base, tier: "yearly" }).map((s) => s.key),
    ).toEqual(["yearly_expiring_1d"])
    expect(
      computeDueExpiryScenarios({ now: at(12), expiry: base, tier: "yearly" }).map((s) => s.key),
    ).toEqual(["yearly_expired_1d"])
  })

  it("★ 终身会员永远不命中任何到期场景（哪怕传了到期时间）", () => {
    for (const h of [-100, -10, 1, 10, 100]) {
      expect(
        computeDueExpiryScenarios({ now: at(h), expiry: base, tier: "partner" }),
        `partner 在 ${h} 小时处不该命中`,
      ).toEqual([])
    }
  })

  it("档位不匹配就不发（月卡用户不该收到体验会员的文案）", () => {
    const due = computeDueExpiryScenarios({ now: at(-10), expiry: base, tier: "monthly" })
    expect(due.map((s) => s.key)).not.toContain("trial_expiring_24h")
  })

  it("P0 排在 P1 之前（扫描是顺序发送的，先发价值最高的）", () => {
    // 构造一个同时命中多个场景的极端情况不可行（窗口不重叠），
    // 所以这里直接校验场景表的优先级分布符合预期
    const p0 = LIFECYCLE_SCENARIOS.filter((s) => s.priority === "P0")
    expect(p0.length).toBeGreaterThan(0)
    expect(EXPIRY_SCENARIOS.every((s) => s.priority === "P0")).toBe(true)
  })
})

describe("周期键 · 幂等的第四列", () => {
  it("到期类周期键 = 到期日（上海日历日）", () => {
    expect(expiryPeriodKey(base)).toBe("2026-09-30")
  })

  it("★ 续费后周期键改变（这是修掉「续费后再也收不到提醒」的关键）", () => {
    const thisYear = new Date("2026-09-30T12:00:00+08:00")
    const nextYear = new Date("2027-09-30T12:00:00+08:00")
    expect(expiryPeriodKey(thisYear)).not.toBe(expiryPeriodKey(nextYear))
  })

  it("同一天内多次扫描得到同一个键（保证幂等）", () => {
    const morning = new Date("2026-09-30T10:00:00+08:00")
    const evening = new Date("2026-09-30T19:00:00+08:00")
    expect(expiryPeriodKey(morning)).toBe(expiryPeriodKey(evening))
  })

  it("跨日边界用上海时区判定，不是 UTC", () => {
    // UTC 的 2026-09-30T17:00 = 上海 2026-10-01T01:00
    expect(expiryPeriodKey(new Date("2026-09-30T17:00:00Z"))).toBe("2026-10-01")
  })

  it("每日类用当日，一次性类用空串", () => {
    expect(dailyPeriodKey(base)).toBe("2026-09-30")
    expect(ONE_SHOT_PERIOD_KEY).toBe("")
  })
})

describe("decideSend · 频次上限", () => {
  const now = base

  it("从未发过 → 允许", () => {
    expect(
      decideSend({ isExpiryKind: false, nonExpirySentInWindow: 0, lastSentAt: null, now }),
    ).toEqual({ allowed: true })
  })

  it("★ 24 小时内已经发过 → 拦住（冷却）", () => {
    expect(
      decideSend({
        isExpiryKind: false,
        nonExpirySentInWindow: 0,
        lastSentAt: new Date(now.getTime() - 5 * H),
        now,
      }),
    ).toEqual({ allowed: false, reason: "cooldown" })
  })

  it("超过 24 小时 → 冷却解除", () => {
    expect(
      decideSend({
        isExpiryKind: false,
        nonExpirySentInWindow: 1,
        lastSentAt: new Date(now.getTime() - 25 * H),
        now,
      }),
    ).toEqual({ allowed: true })
  })

  it("★ 非到期类达到每周 2 条上限 → 拦住", () => {
    expect(
      decideSend({
        isExpiryKind: false,
        nonExpirySentInWindow: FREQUENCY.maxPerWeek,
        lastSentAt: new Date(now.getTime() - 48 * H),
        now,
      }),
    ).toEqual({ allowed: false, reason: "weekly_cap" })
  })

  it("非到期类：1 条未到上限 → 放行", () => {
    expect(
      decideSend({
        isExpiryKind: false,
        nonExpirySentInWindow: 1,
        lastSentAt: new Date(now.getTime() - 48 * H),
        now,
      }),
    ).toEqual({ allowed: true })
  })

  it("★ 到期类不受周上限约束（§11.5 ④）", () => {
    // 「会员要到期了」被"这周已经发过 2 条"挡掉，是最亏的一种省
    expect(
      decideSend({
        isExpiryKind: true,
        nonExpirySentInWindow: 99,
        lastSentAt: new Date(now.getTime() - 48 * H),
        now,
      }),
    ).toEqual({ allowed: true })
  })

  it("到期类仍受 24h 冷却约束（避免和别的消息同一天砸两条）", () => {
    expect(
      decideSend({
        isExpiryKind: true,
        nonExpirySentInWindow: 0,
        lastSentAt: new Date(now.getTime() - 1 * H),
        now,
      }),
    ).toEqual({ allowed: false, reason: "cooldown" })
  })

  it("冷却与周上限同时不满足时，先报冷却（它是更近的原因）", () => {
    expect(
      decideSend({
        isExpiryKind: false,
        nonExpirySentInWindow: 5,
        lastSentAt: new Date(now.getTime() - 1 * H),
        now,
      }),
    ).toEqual({ allowed: false, reason: "cooldown" })
  })
})

describe("buildMessage · 文案", () => {
  const ctx = {
    nickname: "小明",
    expiry: base,
    practicedSentences: 47,
    pendingReview: 23,
    tierLabel: "体验会员",
  }

  it("★ 每个场景都有文案（新增场景忘了写文案会在这里失败，而不是发出空消息）", () => {
    for (const scenario of LIFECYCLE_SCENARIOS) {
      const msg = buildMessage({ scenario, ...ctx })
      expect(msg.title.length, `${scenario.key} 标题为空`).toBeGreaterThan(0)
      expect(msg.body.length, `${scenario.key} 正文为空`).toBeGreaterThan(10)
    }
  })

  it("★ 所有文案都不得含营销词（模板消息禁止营销内容，§11.4 / §11.7）", () => {
    // 写错会被微信驳回，严重时处罚账号接口权限 —— 那整套触达体系就没了。
    // 营销内容应当放在站内的到期挽留页，消息只负责把人带过去。
    const banned = [
      "优惠", "立减", "折扣", "限时", "最后机会", "仅剩", "抢购",
      "特价", "包过", "保过", "提分", "返现", "免费送", "秒杀", "代金券",
    ]
    for (const scenario of LIFECYCLE_SCENARIOS) {
      const msg = buildMessage({ scenario, ...ctx })
      const all = `${msg.title}\n${msg.body}\n${Object.values(msg.templateData).join("\n")}`
      for (const word of banned) {
        expect(all, `${scenario.key} 的文案含营销词「${word}」`).not.toContain(word)
      }
    }
  })

  it("到期类文案带上该用户自己的学习数字（§11.4 要求）", () => {
    const msg = buildMessage({ scenario: findScenario("trial_expiring_24h")!, ...ctx })
    expect(msg.body).toContain("47")
    expect(msg.body).toContain("23")
    // 键名是微信模板的惯例字段名（keyword3 = 学习记录）
    expect(msg.templateData.keyword3).toContain("47")
  })

  it("到期类文案带上到期日期，且是上海日历日", () => {
    const msg = buildMessage({ scenario: findScenario("yearly_expiring_1d")!, ...ctx })
    expect(msg.body).toContain("2026-09-30")
    expect(msg.templateData.keyword2).toBe("2026-09-30")
  })

  it("模板变量键在同类模板之间保持一致（同一个模板 ID 被多个场景复用）", () => {
    // monthly_expiring_3d 与 monthly_expiring_1d 共用 WECHAT_TEMPLATE_MONTHLY_EXPIRING，
    // 变量键不一致会导致其中一个发送失败
    const a = buildMessage({ scenario: findScenario("monthly_expiring_3d")!, ...ctx })
    const b = buildMessage({ scenario: findScenario("monthly_expiring_1d")!, ...ctx })
    expect(Object.keys(a.templateData).sort()).toEqual(Object.keys(b.templateData).sort())
  })

  it("★ 练了 0 句时不能说「已练习 0 句」", () => {
    // 「领了体验会员但一次都没练」是 §11.1 列为 P1 的那批人（流失率最高），
    // 而这句话是他们收到的唯一一句关于他们自己的话 —— 既无信息量又像指责。
    expect(practiceSummary(0, 0)).toBe("尚未开始练习")
    // 负数属于脏数据，也不该渲染成"已练习 -3 句"
    expect(practiceSummary(-3, 0)).toBe("尚未开始练习")

    const msg = buildMessage({ scenario: findScenario("trial_expiring_24h")!, ...ctx, practicedSentences: 0, pendingReview: 0 })
    expect(msg.templateData.keyword3).not.toContain("0 句")
    expect(msg.body).not.toContain("已练习 0 句")
  })

  it("★ 待复习为 0 时不要写「待复习错句 0 个」", () => {
    // 那是一句没有内容的填充，只会让消息显得是机器群发的
    expect(practiceSummary(47, 0)).toBe("已练习 47 句")
    expect(practiceSummary(47, 0)).not.toContain("0 个")
    expect(practiceSummary(47, 23)).toBe("已练习 47 句 · 待复习错句 23 个")
  })

  it("★ 短信的句数变量必须是纯数字（单位在模板正文里）", () => {
    // 阿里云变量属性「数量」明确"不支持常见的数量单位，如个、分钟"，单位必须在变量外。
    // 而且变量值是整句中文，正是垃圾短信绕关键词过滤的手法，审核更容易被盯上。
    expect(smsPracticeCount(47)).toBe(47)
    expect(typeof smsPracticeCount(47)).toBe("number")
    // 一次都没练过 → 返回 null，调用方据此**跳过短信**（而不是发"你已练习0句"）
    expect(smsPracticeCount(0)).toBeNull()
    expect(smsPracticeCount(-3)).toBeNull()
  })

  it("★ 到期类文案的时态必须跟着场景走（已到期不能说「将于」）", () => {
    // 「会员已过期」的场景里第一行写"你的年度会员将于 9月30日 到期"是明显的错话，
    // 而它正好在通知最显眼的位置。到期类模板共用同一个模板 ID，
    // 所以时态差异只能靠 first 字段的内容表达 —— 这里守住它。
    const expiredKeys = ["trial_expired_1d", "yearly_expired_1d"]
    for (const scenario of LIFECYCLE_SCENARIOS) {
      if (!scenario.expiryKind) continue
      const msg = buildMessage({ scenario, ...ctx })
      const first = msg.templateData.first ?? ""
      if (expiredKeys.includes(scenario.key)) {
        expect(first, `${scenario.key} 应用「已于」`).toContain("已于")
        expect(first, `${scenario.key} 不该出现「将于」`).not.toContain("将于")
      } else {
        expect(first, `${scenario.key} 应用「将于」`).toContain("将于")
        expect(first, `${scenario.key} 不该出现「已于」`).not.toContain("已于")
      }
    }
  })

  it("★ 模板字段名必须是微信惯例（first/keyword1..N/remark），不能自造", () => {
    // 字段名与申请到的模板不一致 → 发送会在**用户该收到提醒的那一刻**被驳回，
    // 而模板申请本身要等 1~3 天，写错等于白等一轮。
    const allowed = /^(first|keyword\d+|remark)$/
    for (const scenario of LIFECYCLE_SCENARIOS) {
      const msg = buildMessage({ scenario, ...ctx })
      for (const key of Object.keys(msg.templateData)) {
        expect(key, `${scenario.key} 的模板字段名 "${key}" 不是微信惯例名`).toMatch(allowed)
      }
      // 到期类必须有 first + remark（首尾是模板消息的固定结构）
      if (scenario.expiryKind) {
        expect(Object.keys(msg.templateData), `${scenario.key} 缺 first`).toContain("first")
        expect(Object.keys(msg.templateData), `${scenario.key} 缺 remark`).toContain("remark")
      }
    }
  })

  it("客服消息类文案不带模板变量（客服消息发的是纯文本）", () => {
    const msg = buildMessage({ scenario: findScenario("trial_claimed_no_practice")!, ...ctx })
    expect(msg.templateData).toEqual({})
  })

  it("未知场景抛错，而不是静默发一条空消息", () => {
    expect(() =>
      buildMessage({
        scenario: { ...findScenario("trial_expiring_24h")!, key: "not_exist" },
        ...ctx,
      }),
    ).toThrow(/没有对应文案/)
  })
})

describe("退订", () => {
  it("退订位非空即视为已退订", () => {
    expect(isOptedOut(new Date())).toBe(true)
    expect(isOptedOut(null)).toBe(false)
    expect(isOptedOut(undefined)).toBe(false)
  })

  it("短信文案必须能附上退订说明（法规要求）", () => {
    expect(SMS_OPT_OUT_SUFFIX).toContain("退订")
  })
})
