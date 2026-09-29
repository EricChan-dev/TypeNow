/**
 * 会员权益事实源的自检（src/lib/membership-benefits.ts）。
 *
 * 存在的理由：价格页曾经把权益在 4 处各写一份，漂移出「7 条里 4 条是代码里
 * 不存在的功能」。这份测试把当时的具体错误固化成回归约束：
 *
 *   1. 会员卖点必须**真的只给会员**（gate 为 content / grant / quota 且 pro > free）；
 *      "人人都有"的能力写进会员清单就是误导 —— 那正是 FSRS / 音素级 / AI 私教
 *      三条的性质。
 *   2. 额度数字必须**只有一份**：接口强制用的常量与文案渲染用的是同一份，
 *      因此这里同时断言路由确实从事实源 import，而不是自己写了个数。
 *   3. 已知的假宣称关键词不得重新出现（它们曾真实上线过）。
 *
 * **2026-09-29 新增第 4 条：推广权益不得回到付费档里。**
 * 此前 `PARTNER_BENEFITS` 把「邀请链接 / 佣金 / 提现 / 看板」整体挂在 ¥399 商品上，
 * 等于在商品说明里承诺「付费买到推广与赚钱资格」—— 命中《禁止传销条例》
 * 第七条(二) 的「变相入门费」，而且是在**经营对象**层面。
 * 现在拆成 LIFETIME_BENEFITS（学习权益）+ PROMOTER_BENEFITS（免费，人人可加入），
 * 由本文件最后一组测试看住这个结构不许退化。
 *
 * 顺带守住一条工程约束：本模块**不许**引入 db/drizzle —— 价格页是客户端组件，
 * 拖进服务端依赖会污染浏览器 bundle。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  COMPARISON_NOTE,
  COMPARISON_ROWS,
  FREE_AI_ANALYZE_PER_DAY,
  FREE_AI_CHAT_PER_DAY,
  FREE_PRONUNCIATION_PER_DAY,
  INCLUDED_FOR_EVERYONE,
  LIFETIME_BENEFITS,
  MEMBER_DAILY_DIAMONDS,
  NOT_APPLICABLE,
  PRO_AI_ANALYZE_PER_DAY,
  PRO_AI_CHAT_PER_DAY,
  PRO_BENEFITS,
  PRO_PRONUNCIATION_PER_DAY,
  PROMOTER_BENEFITS,
} from "@/lib/membership-benefits"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

/** 对比表的六列。新增列时这里会漏掉并让「字段齐全」测试失败——这是刻意的。 */
const COLUMNS = ["free", "monthly", "quarterly", "yearly", "lifetime"] as const

describe("额度常量", () => {
  it("会员额度严格高于免费额度（否则不构成差异化，不能当卖点）", () => {
    expect(PRO_PRONUNCIATION_PER_DAY).toBeGreaterThan(FREE_PRONUNCIATION_PER_DAY)
    expect(PRO_AI_CHAT_PER_DAY).toBeGreaterThan(FREE_AI_CHAT_PER_DAY)
    expect(PRO_AI_ANALYZE_PER_DAY).toBeGreaterThan(FREE_AI_ANALYZE_PER_DAY)
  })

  it("免费用户的 AI 助手额度必须 > 0（2026-09-29 修正：原为 0，是误抄句乐部）", () => {
    // 句乐部的「每日 2 次免费提问」是给所有人的；我们把 2 抄到了 PRO 上、
    // 把免费设成 0，导致免费用户一次都用不了。这条看住它不许回退。
    expect(FREE_AI_CHAT_PER_DAY).toBeGreaterThan(0)
  })

  it("额度都是正整数", () => {
    for (const n of [
      FREE_PRONUNCIATION_PER_DAY,
      PRO_PRONUNCIATION_PER_DAY,
      FREE_AI_CHAT_PER_DAY,
      PRO_AI_CHAT_PER_DAY,
      FREE_AI_ANALYZE_PER_DAY,
      PRO_AI_ANALYZE_PER_DAY,
      MEMBER_DAILY_DIAMONDS,
    ]) {
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("PRO_BENEFITS · 会员卖点必须真的只给会员", () => {
  it("每条都有 label / claim / gate，且 id 唯一", () => {
    const ids = new Set<string>()
    for (const b of PRO_BENEFITS) {
      expect(b.id).toBeTruthy()
      expect(b.label).toBeTruthy()
      expect(b.claim).toBeTruthy()
      expect(ids.has(b.id)).toBe(false)
      ids.add(b.id)
    }
    expect(PRO_BENEFITS.length).toBeGreaterThan(0)
  })

  it("gate 只能是 content / grant / lifetime，或「pro > free 的 quota」", () => {
    for (const b of PRO_BENEFITS) {
      if (b.gate.kind === "quota") {
        expect(b.gate.proPerDay).toBeGreaterThan(b.gate.freePerDay)
        continue
      }
      // 若出现"人人都有"的权益，说明它被错当成会员卖点了。
      expect(["content", "grant", "lifetime"]).toContain(b.gate.kind)
    }
  })

  it("至少有一条 content 权益（本项目唯一真实门禁是每课试学句数）", () => {
    expect(PRO_BENEFITS.some((b) => b.gate.kind === "content")).toBe(true)
  })

  it("额度类权益的文案里的数字与常量一致（不写死、不改口径）", () => {
    // 遍历**所有** quota 权益而不是逐个点名：以后再加额度点位时，
    // 漏掉文案同步会在这里失败，而不是悄悄漂移。
    const quotaBenefits = PRO_BENEFITS.filter((b) => b.gate.kind === "quota")
    expect(quotaBenefits.length).toBeGreaterThan(0)
    for (const b of quotaBenefits) {
      if (b.gate.kind !== "quota") continue
      // 会员额度必须出现在文案里
      expect(`${b.label} ${b.claim}`).toContain(String(b.gate.proPerDay))
      // 免费额度若 > 0 也必须出现（否则用户不知道免费用得完多少）
      if (b.gate.freePerDay > 0) {
        expect(`${b.label} ${b.claim}`).toContain(String(b.gate.freePerDay))
      }
    }
  })

  it("赠钻类权益的文案里的数字与常量一致", () => {
    const grants = PRO_BENEFITS.filter((b) => b.gate.kind === "grant")
    expect(grants.length).toBeGreaterThan(0)
    for (const b of grants) {
      if (b.gate.kind !== "grant") continue
      expect(`${b.label} ${b.claim}`).toContain(String(b.gate.diamondsPerDay))
    }
  })

  it("同一个能力在价格页与功能介绍页必须是同一个名字", () => {
    // 这曾经真的漂移过：价格页写「AI 句子解析」、功能介绍页写「AI 句子讲解」，
    // 同一个能力两个名字。用户面统一叫「讲解」（内部代码叫 analyze 没关系，
    // 那是对实现的描述）。
    const pricingSide = read("src/lib/membership-benefits.ts")
    const featuresSide = read("src/lib/product-features.ts")
    for (const [name, src] of [["membership-benefits", pricingSide], ["product-features", featuresSide]] as const) {
      expect(src, `${name} 不该再出现另一种叫法`).not.toContain("句子解析")
      expect(src, `${name} 应使用「句子讲解」`).toContain("句子讲解")
    }
  })

  it("AI 句子解析也进了权益清单（此前它只被限流、没有任何会员区分）", () => {
    const analyze = PRO_BENEFITS.find((b) => b.id === "ai-analyze")
    expect(analyze).toBeDefined()
    expect(analyze?.gate).toEqual({
      kind: "quota",
      freePerDay: FREE_AI_ANALYZE_PER_DAY,
      proPerDay: PRO_AI_ANALYZE_PER_DAY,
    })
    // 免费用户也有这一项（有全局缓存兜底），所以 free 必须 > 0
    expect(FREE_AI_ANALYZE_PER_DAY).toBeGreaterThan(0)
  })

  it("回归：不得再出现曾经上线过的假宣称", () => {
    // 这些词对应的功能在代码里不存在，或不属于会员专属。
    const banned = ["FSRS", "音素级", "报告导出", "自定义上传", "专属徽章", "听说读写"]
    const allText = [
      ...PRO_BENEFITS.map((b) => `${b.label} ${b.claim}`),
      ...LIFETIME_BENEFITS.map((b) => `${b.label} ${b.claim}`),
      ...PROMOTER_BENEFITS.map((b) => `${b.label} ${b.claim}`),
      ...COMPARISON_ROWS.map((r) => r.feature),
    ].join(" ")
    for (const word of banned) {
      expect(allText).not.toContain(word)
    }
  })

  it("会员卖点不能与「人人都有」的能力重复", () => {
    // 按关键能力词做交叉检查：出现在 INCLUDED_FOR_EVERYONE 的，不能同时
    // 作为 PRO_BENEFITS 的 label 出现。
    const included = INCLUDED_FOR_EVERYONE.join(" ")
    for (const b of PRO_BENEFITS) {
      expect(included).not.toContain(b.label)
    }
  })
})

describe("COMPARISON_ROWS · 对比表", () => {
  it("每行 6 个字段都齐全（含免费列与季度列）", () => {
    expect(COMPARISON_ROWS.length).toBeGreaterThan(0)
    for (const r of COMPARISON_ROWS) {
      expect(typeof r.feature).toBe("string")
      expect(r.feature.length).toBeGreaterThan(0)
      for (const key of COLUMNS) {
        expect(typeof r[key]).toBe("string")
        expect(r[key].length).toBeGreaterThan(0)
      }
    }
  })

  it("已不再有 partner 列（列名要表达语义，不能被误读成卖推广资格）", () => {
    for (const r of COMPARISON_ROWS) {
      expect((r as unknown as Record<string, unknown>).partner).toBeUndefined()
    }
  })

  it("存在免费列与付费列**不同**的行（否则这张表回答不了「为什么要付费」）", () => {
    const differing = COMPARISON_ROWS.filter(
      (r) => r.free !== r.monthly && r.free !== NOT_APPLICABLE,
    )
    expect(differing.length).toBeGreaterThan(0)
  })

  it("跟读评分与 AI 助手的行直接取自额度常量", () => {
    const row = (feature: string) => COMPARISON_ROWS.find((r) => r.feature === feature)
    expect(row("跟读评分")?.free).toContain(String(FREE_PRONUNCIATION_PER_DAY))
    expect(row("跟读评分")?.monthly).toContain(String(PRO_PRONUNCIATION_PER_DAY))
    expect(row("AI 私教助手")?.free).toContain(String(FREE_AI_CHAT_PER_DAY))
    expect(row("AI 私教助手")?.monthly).toContain(String(PRO_AI_CHAT_PER_DAY))
  })

  it("月/季/年三档功能一致（只差时长与价格）", () => {
    for (const r of COMPARISON_ROWS) {
      if (r.feature === "会员有效期" || r.feature === "价格") continue
      expect(r.monthly).toBe(r.quarterly)
      expect(r.monthly).toBe(r.yearly)
    }
  })

  it("价格行必须同时写出首期价与标准价（原价不写出来就是虚构原价）", () => {
    const price = COMPARISON_ROWS.find((r) => r.feature === "价格")
    expect(price).toBeDefined()
    // 三档订阅写「续费」，终身档没有续费这回事，写「老用户」——
    // 把终身档也标成续费会是一句假话。
    for (const key of ["monthly", "quarterly", "yearly"] as const) {
      expect(price?.[key]).toContain("续费")
    }
    expect(price?.lifetime).toContain("老用户")
    expect(price?.lifetime).not.toContain("续费")
  })
})

/**
 * 2026-09-29 合规改造的回归护栏。
 *
 * 这一组是整个文件里最重要的：它保证「付费＝取得推广资格」这个结构
 * 不会以任何形式复活 —— 无论是改回数据表、还是改文案。
 */
describe("合规结构：推广权益必须与付费档彻底分离", () => {
  it("对比表里不得出现任何推广/佣金/提现行", () => {
    const features = COMPARISON_ROWS.map((r) => r.feature).join(" ")
    for (const word of ["佣金", "提现", "邀请", "推广", "返佣"]) {
      expect(features).not.toContain(word)
    }
  })

  it("付费档的权益文案里不得出现「佣金」", () => {
    const paidText = [
      ...PRO_BENEFITS.map((b) => `${b.label} ${b.claim}`),
      ...LIFETIME_BENEFITS.map((b) => `${b.label} ${b.claim}`),
    ].join(" ")
    expect(paidText).not.toContain("佣金")
  })

  it("LIFETIME_BENEFITS 只有 lifetime gate，不含任何 promoter gate", () => {
    expect(LIFETIME_BENEFITS.length).toBeGreaterThan(0)
    for (const b of LIFETIME_BENEFITS) {
      expect(b.gate.kind).toBe("lifetime")
    }
  })

  it("PROMOTER_BENEFITS 全部是 promoter gate（免费权益，与套餐无关）", () => {
    expect(PROMOTER_BENEFITS.length).toBeGreaterThan(0)
    for (const b of PROMOTER_BENEFITS) {
      expect(b.gate.kind).toBe("promoter")
    }
  })

  it("提现口径是「全额」而不是「¥50 起」（后者与 partner/withdraw 不符）", () => {
    const withdraw = PROMOTER_BENEFITS.find((b) => b.id === "promoter-withdraw")
    expect(withdraw?.claim).toContain("全额")
    expect(withdraw?.claim).not.toContain("¥50")
  })

  it("佣金口径写的是「按实际成交金额」，不是按人数", () => {
    // 计酬依据是销售额而非人头数，这是 2013 年两高一部《意见》第 5 条划的线。
    const first = PROMOTER_BENEFITS.find((b) => b.id === "promoter-commission-first")
    expect(first?.claim).toContain("实际成交金额")
  })

  it("对比表下方的说明必须点明「推广与付费档无关」", () => {
    expect(COMPARISON_NOTE).toContain("免费")
    expect(COMPARISON_NOTE).toContain("推广")
    expect(COMPARISON_NOTE).not.toContain("合伙人会员额外获得推广权益")
  })
})

describe("事实源本身", () => {
  it("不得引入 db / drizzle（价格页是客户端组件，会被拖进浏览器 bundle）", () => {
    const src = read("src/lib/membership-benefits.ts")
    // 只看真实的 import 语句：注释里提到 "drizzle" 是说明性文字，不算引入。
    const importLines = src
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n")
    expect(importLines).not.toContain("@/lib/db")
    expect(importLines).not.toContain("drizzle")
    // 允许的依赖都是纯常量模块
    expect(importLines).toContain("@/lib/free-trial")
    expect(importLines).toContain("@/lib/pricing")
    expect(importLines).toContain("@/lib/coins")
  })

  it("额度类权益的文案确实被价格页/首页消费（不是只写在测试里）", () => {
    for (const p of [
      "src/components/pricing/PricingClient.tsx",
      "src/app/(public)/page.tsx",
      "src/app/(public)/pricing/page.tsx",
    ]) {
      expect(read(p)).toContain("membership-benefits")
    }
  })

  it("PARTNER_BENEFITS 不得再被导出或被消费（它表达的正是「付费买推广身份」）", () => {
    // 只查**导出与消费**，不查字符串是否出现：在说明性注释里提到旧名字是有价值的
    // （它解释了这次合规改造为什么发生），把注释也算违规会让测试逼着人删掉理由。
    expect(read("src/lib/membership-benefits.ts")).not.toMatch(
      /export\s+(const|type|interface)\s+PARTNER_BENEFITS/,
    )
    for (const p of [
      "src/components/pricing/PricingClient.tsx",
      "src/app/(public)/page.tsx",
      "src/app/(public)/pricing/page.tsx",
    ]) {
      expect(read(p)).not.toContain("PARTNER_BENEFITS")
    }
  })
})

describe("接口与文案同源（防漂移的核心）", () => {
  it("evaluate 路由从事实源 import 额度常量，而不是自己写数", () => {
    const src = read("src/app/api/youdao/evaluate/route.ts")
    expect(src).toContain("@/lib/membership-benefits")
    expect(src).toContain("PRO_PRONUNCIATION_PER_DAY")
    expect(src).toContain("FREE_PRONUNCIATION_PER_DAY")
    // 旧实现是"每用户 30 次/小时"的硬编码常量，不得回退
    expect(src).not.toContain("MAX_EVALUATE_PER_USER_HOUR")
  })

  it("analyze 路由用「日期键 + 一天窗口」的每日额度，且按会员区分", () => {
    const src = read("src/app/api/knowledge/analyze/route.ts")
    expect(src).toContain("@/lib/membership-benefits")
    expect(src).toContain("PRO_AI_ANALYZE_PER_DAY")
    expect(src).toContain("FREE_AI_ANALYZE_PER_DAY")
    // 日期键 + 一天窗口：跨天重置，且不会被清理截短成 1 小时
    expect(src).toContain("toShanghaiDateStr()")
    expect(src).toContain("DAY_MS")
    // 旧实现是「每用户 20 次/小时」，且提示写着"今日"——文案与窗口不符
    expect(src).not.toContain("MAX_ANALYZE_PER_HOUR")
    expect(src).not.toContain('"knowledge-analyze-hour"')
  })

  it("chat 路由从事实源 import 免费与会员两档额度", () => {
    const src = read("src/app/api/chat/route.ts")
    expect(src).toContain("@/lib/membership-benefits")
    expect(src).toContain("PRO_AI_CHAT_PER_DAY")
    // 免费额度也要走同一份常量，否则免费用户的门槛会各写一份
    expect(src).toContain("FREE_AI_CHAT_PER_DAY")
  })

  it("rate-limit 的清理按桶窗口，而不是硬编码的 1 小时", () => {
    // 硬编码会把「每天 N 次」的每日额度在 1 小时后清空，静默变成每小时额度。
    const src = read("src/lib/rate-limit.ts")
    expect(src).toContain("bucket.windowMs")
    expect(src).not.toMatch(/filter\(\(t\) => now - t < 3600_000\)/)
  })
})
