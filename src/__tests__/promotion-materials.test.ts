/**
 * 推广素材库与推广规则的守门测试。
 *
 * 这组测试守的是**两件会持续复发的事**，而不是某次改动：
 *
 * 1. **素材里混进禁用词。** 禁用词表来自 distribution-compliance.md 第七节，
 *    是最高检文中要求平台做敏感词拦截的那张表。素材是靠人不断新增的，
 *    没有测试挡着，下一次加素材一定会漏。
 *
 * 2. **复制按钮又无条件把邀请链接拼上去。** 原先的写法是
 *    `text + " " + inviteLink`，在小红书直接违反《交易导流违规管理细则》
 *    （禁止发布链接/二维码/水印，处罚可到永久封禁账号）。
 *    这种"看起来更贴心"的改动最容易被重新引入，所以用源码断言钉住。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  BANNED_WORDS,
  PLATFORM_RULES,
  PROMOTION_MATERIALS,
  PROMOTION_MATERIALS_PUBLISHED_AT,
  PROMOTION_MATERIALS_VERSION,
  buildCopyText,
  canAttachLink,
  findBannedWords,
  materialsForPlatform,
  ruleForPlatform,
  type PromotionPlatform,
} from "@/lib/promotion-materials"
import {
  ATTRIBUTION_WINDOW_DAYS,
  ATTRIBUTION_WINDOW_MS,
  COMMISSION_COOLING_DAYS,
  MIN_WITHDRAW_FEN,
  attributionDeadline,
  daysLeftInWindow,
  fmtFen,
  isWithinAttributionWindow,
  withdrawProgress,
} from "@/lib/partner-rules"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

describe("素材库的留档形态", () => {
  it("带版本号与发布日期 —— 这是「物料审核记录」这类留档物的最小可用形态", () => {
    expect(PROMOTION_MATERIALS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(PROMOTION_MATERIALS_PUBLISHED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("每条素材都有唯一 id（改素材要能找到是哪一条被改过）", () => {
    const ids = PROMOTION_MATERIALS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("每个平台都有规则，且规则标了依据与时间 —— 不标日期的红线表比没有更危险", () => {
    const platforms: PromotionPlatform[] = ["小红书", "抖音", "微信"]
    for (const p of platforms) {
      const rule = ruleForPlatform(p)
      expect(rule, `${p} 缺规则`).not.toBeNull()
      expect(rule!.asOf.length).toBeGreaterThan(0)
      expect(rule!.note.length).toBeGreaterThan(0)
      expect(materialsForPlatform(p).length).toBeGreaterThan(0)
    }
  })
})

describe("禁用词（distribution-compliance.md 第七节）", () => {
  it("禁用词表覆盖三类：收益承诺 / 传销结构 / 缴费入门", () => {
    for (const w of ["零风险", "躺赚", "月入过万", "拉人头", "团队计酬", "加盟", "保证金"]) {
      expect(BANNED_WORDS as readonly string[]).toContain(w)
    }
  })

  it("findBannedWords 能真的查出来（否则下面的全量断言是空转）", () => {
    expect(findBannedWords("跟我做，零风险月入过万")).toEqual(
      expect.arrayContaining(["零风险", "月入过万"]),
    )
    expect(findBannedWords("这是一段干净的文案")).toEqual([])
  })

  it("**全部素材**的骨架、示例、why 都不含禁用词", () => {
    const offenders: string[] = []
    for (const m of PROMOTION_MATERIALS) {
      // 只查"要发出去的内容"和"解释文案"。
      // avoid 是**禁令列表**，本身必然要提到被禁的东西
      // （例如「不要承诺保底收益」），所以它对禁用词单独放宽 —— 见下一个用例。
      for (const f of [m.scene, m.example, m.why, ...m.skeleton]) {
        const hit = findBannedWords(f)
        if (hit.length) offenders.push(`${m.id}: ${hit.join("/")} ← ${f.slice(0, 30)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("avoid 里提到禁用词时，必须处在否定语境里（不能变成正面宣称）", () => {
    for (const m of PROMOTION_MATERIALS) {
      for (const a of m.avoid) {
        if (findBannedWords(a).length) {
          expect(a, `${m.id} 的 avoid 提到禁用词却不是禁令语气：${a}`).toMatch(
            /不要|禁止|避免|⚠️/,
          )
        }
      }
    }
  })
})

describe("平台导流红线：复制按钮不得无条件拼链接", () => {
  it("小红书：不允许放链接，也不允许放二维码", () => {
    const rule = ruleForPlatform("小红书")!
    expect(rule.linkAllowed).toBe(false)
    expect(rule.qrAllowed).toBe(false)
    // 规则文本要点明处罚，否则推广员不会当真
    expect(rule.note).toContain("永久封禁")
  })

  it("微信：允许链接与二维码（唯一能直接带到产品的场景）", () => {
    const rule = ruleForPlatform("微信")!
    expect(rule.linkAllowed).toBe(true)
    expect(rule.qrAllowed).toBe(true)
  })

  it("buildCopyText 在小红书**不拼链接**，并且如实告知调用方", () => {
    const r = buildCopyText("笔记正文", "小红书", "https://typenow.cn/ref/ABCD1234")
    expect(r.linkIncluded).toBe(false)
    expect(r.text).not.toContain("typenow.cn")
    expect(r.text).not.toContain("/ref/")
  })

  it("buildCopyText 在微信拼上链接", () => {
    const r = buildCopyText("私聊正文", "微信", "https://typenow.cn/ref/ABCD1234")
    expect(r.linkIncluded).toBe(true)
    expect(r.text).toContain("https://typenow.cn/ref/ABCD1234")
  })

  it("canAttachLink 与规则表同源（不是另写一份判断）", () => {
    for (const rule of PLATFORM_RULES) {
      expect(canAttachLink(rule.platform)).toBe(rule.linkAllowed)
    }
  })

  it("小红书素材的骨架与示例里不得出现链接或二维码字样", () => {
    for (const m of materialsForPlatform("小红书")) {
      for (const text of [m.example, ...m.skeleton]) {
        expect(text).not.toMatch(/https?:\/\//)
        expect(text).not.toContain("/ref/")
      }
    }
  })

  it("**源码断言**：推广中心的复制走 buildCopyText，不再手拼 inviteLink", () => {
    const src = read("src/app/home/partner/PartnerDashboard.tsx")
    expect(src).toContain("buildCopyText")
    // 旧写法是 `s.text + " " + inviteLink`；出现它就说明红线又被绕过了
    expect(src).not.toMatch(/\.text\s*\+\s*["'`]\s*["'`]\s*\+\s*inviteLink/)
  })
})

describe("骨架不能退化回成品话术", () => {
  it("每条素材的骨架是多步结构（≥2 步），不是一条可以直接抄的成品", () => {
    for (const m of PROMOTION_MATERIALS) {
      expect(m.skeleton.length, `${m.id} 骨架只有 ${m.skeleton.length} 步`).toBeGreaterThanOrEqual(2)
    }
  })

  it("骨架里不得已经包含邀请链接（那是复制时才拼的东西）", () => {
    for (const m of PROMOTION_MATERIALS) {
      for (const s of m.skeleton) {
        expect(s).not.toMatch(/https?:\/\/typenow/)
      }
    }
  })
})

describe("推广规则数值（lib/partner-rules）", () => {
  it("归因窗口 90 天、冷静期 15 天、最低提现 ¥50", () => {
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(90)
    expect(ATTRIBUTION_WINDOW_MS).toBe(90 * 24 * 60 * 60 * 1000)
    expect(COMMISSION_COOLING_DAYS).toBe(15)
    expect(MIN_WITHDRAW_FEN).toBe(5000)
  })

  it("daysLeftInWindow：还剩半天要说「今天截止」，不能说 0 天", () => {
    const registered = new Date(Date.now() - (ATTRIBUTION_WINDOW_MS - 12 * 60 * 60 * 1000))
    expect(daysLeftInWindow(registered)).toBe(1)
  })

  it("daysLeftInWindow：已过期返回负数（界面据此显示「窗口已过」）", () => {
    const registered = new Date(Date.now() - (ATTRIBUTION_WINDOW_MS + 24 * 60 * 60 * 1000))
    expect(daysLeftInWindow(registered)).toBeLessThan(0)
  })

  it("attributionDeadline 与 isWithinAttributionWindow 边界一致", () => {
    const registered = new Date("2026-01-01T00:00:00Z")
    const deadline = attributionDeadline(registered)
    // 恰好在截止时刻：仍在窗口内（判定用 `>`，不是 `>=`）
    expect(isWithinAttributionWindow(registered, deadline.getTime())).toBe(true)
    // 超过 1 毫秒：窗口外
    expect(isWithinAttributionWindow(registered, deadline.getTime() + 1)).toBe(false)
  })

  it("withdrawProgress：差的钱要算出来给界面显示，而不是只把按钮置灰", () => {
    // 月卡一单佣金 ¥14.5，离 ¥50 还差 ¥35.5 —— 这正是最需要解释清楚的那个状态
    const p = withdrawProgress(1450)
    expect(p.canWithdraw).toBe(false)
    expect(p.shortfallFen).toBe(3550)
    expect(fmtFen(p.shortfallFen)).toBe("¥35.50")

    expect(withdrawProgress(5000).canWithdraw).toBe(true)
    expect(withdrawProgress(5000).shortfallFen).toBe(0)
    // 超过门槛时 shortfall 不得为负（界面会显示"还差 -¥x"）
    expect(withdrawProgress(20000).shortfallFen).toBe(0)
  })

  it("**源码断言**：佣金链路与提现路由都从 partner-rules 取数，不再各写一份字面量", () => {
    const sub = read("src/lib/subscription.ts")
    // 归因窗口不能再出现裸的 90 天字面量
    expect(sub).not.toContain("90 * 24 * 60 * 60 * 1000")
    expect(sub).toContain("ATTRIBUTION_WINDOW_MS")
    // 冷静期不能再出现裸的 15 天字面量
    expect(sub).not.toContain("15 * 24 * 60 * 60 * 1000")
    expect(sub).toContain("COMMISSION_COOLING_DAYS")
    // 佣金比例不能再写字面量（否则协议改了、这里不改，推广员会被少付钱）
    expect(sub).not.toMatch(/isFirst \? 0\.5 : 0\.3/)
    expect(sub).toContain("COMMISSION_RATE")

    const withdraw = read("src/app/api/partner/withdraw/route.ts")
    expect(withdraw).not.toMatch(/const MIN_WITHDRAW = 5000/)
    expect(withdraw).toContain("MIN_WITHDRAW_FEN")
  })

  it("**源码断言**：提现门槛在界面上有解释，不能只有灰按钮", () => {
    const src = read("src/app/home/partner/PartnerDashboard.tsx")
    expect(src).toContain("withdrawProgress")
  })
})
