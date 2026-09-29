/**
 * 课时 / 课程完成奖励的判定规则（src/lib/reward-rules.ts）。
 *
 * 存在的理由：lesson_complete / course_complete 此前**完全不校验**——
 * refId 由客户端自选，而去重键是 (user, type, refId, 上海日历日)，
 * 于是 curl 一串随机字符串就能无限领 30 / 100 钻石，再兑换 /api/chat 的
 * DeepSeek 调用（真金白银）。这个文件把「必须真的练过」变成可回归的约束。
 *
 * 另一条同样重要的边界是**不能让真实用户领不到**：非会员在课程接口只能拿到
 * 每课前 FREE_TRIAL_SENTENCES 句，所以门槛必须与下发口径同源，不能要求他
 * 练完整节课。下面专门有一组用例钉住这一点。
 */
import { describe, it, expect } from "vitest"
import { FREE_TRIAL_SENTENCES } from "@/lib/free-trial"
import { COIN_COURSE_COMPLETE, COIN_LESSON_COMPLETE } from "@/lib/coins"
import {
  COURSE_COMPLETE_REWARD,
  LESSON_COMPLETE_REWARD,
  isCourseCompleted,
  isLessonCompleted,
  requiredPracticeCount,
} from "@/lib/reward-rules"

describe("奖励额度常量", () => {
  it("单位是金币，额度为 课时 20 / 课程 100（2026-09-29 由钻石改为金币）", () => {
    // 原值 30 / 100 是**钻石**口径。双货币拆分后练习奖励改发金币，
    // 课时额度同时下调到 20 —— 金币是准现金（1000 金币 ≈ 1 天会员），
    // 不能沿用钻石时代那种"随手给 30、100"的力度。
    expect(LESSON_COMPLETE_REWARD).toBe(20)
    expect(COURSE_COMPLETE_REWARD).toBe(100)
  })

  it("与 lib/coins.ts 同源（不得各写一份数）", () => {
    expect(LESSON_COMPLETE_REWARD).toBe(COIN_LESSON_COMPLETE)
    expect(COURSE_COMPLETE_REWARD).toBe(COIN_COURSE_COMPLETE)
  })
})

describe("requiredPracticeCount · 门槛推导", () => {
  it("会员必须练完整节课下发的全部句子", () => {
    expect(requiredPracticeCount(50, true)).toBe(50)
    expect(requiredPracticeCount(1, true)).toBe(1)
  })

  it("非会员门槛被试学上限封顶（他最多也只能拿到这么多）", () => {
    expect(requiredPracticeCount(50, false)).toBe(FREE_TRIAL_SENTENCES)
    expect(requiredPracticeCount(10, false)).toBe(FREE_TRIAL_SENTENCES)
  })

  it("整课句数少于试学上限时，门槛就是整课句数", () => {
    expect(requiredPracticeCount(2, false)).toBe(2)
    expect(requiredPracticeCount(1, false)).toBe(1)
  })

  it("没有可练内容的课时门槛为 0（无法判定为完成）", () => {
    expect(requiredPracticeCount(0, true)).toBe(0)
    expect(requiredPracticeCount(0, false)).toBe(0)
    expect(requiredPracticeCount(-3, false)).toBe(0)
    expect(requiredPracticeCount(Number.NaN, false)).toBe(0)
  })

  it("不变量：非会员门槛永远不超过试学上限", () => {
    for (const served of [0, 1, 2, 3, 4, 10, 100, 960]) {
      expect(requiredPracticeCount(served, false)).toBeLessThanOrEqual(FREE_TRIAL_SENTENCES)
    }
  })
})

describe("isLessonCompleted · 课时完成判定", () => {
  it("会员练满整课 → 通过", () => {
    expect(isLessonCompleted(50, 50, true)).toBe(true)
  })

  it("会员少练一句 → 不通过", () => {
    expect(isLessonCompleted(49, 50, true)).toBe(false)
  })

  it("非会员练完试学的 3 句 → 通过（不能让他领不到）", () => {
    expect(isLessonCompleted(FREE_TRIAL_SENTENCES, 50, false)).toBe(true)
  })

  it("非会员只练了 2 句 → 不通过", () => {
    expect(isLessonCompleted(2, 50, false)).toBe(false)
  })

  it("短课时：非会员练完 2 句（整课就 2 句）→ 通过", () => {
    expect(isLessonCompleted(2, 2, false)).toBe(true)
  })

  it("回归：零练习记录永远不通过（原漏洞是随机 refId 即可领奖）", () => {
    for (const served of [1, 3, 10, 50, 960]) {
      expect(isLessonCompleted(0, served, true)).toBe(false)
      expect(isLessonCompleted(0, served, false)).toBe(false)
    }
  })

  it("回归：可练句数为 0 的课时不能凭 0 >= 0 通过", () => {
    expect(isLessonCompleted(0, 0, true)).toBe(false)
    expect(isLessonCompleted(0, 0, false)).toBe(false)
    // 即使有练习记录（例如内容事后被下架），也不该把不可练的课时算成完成
    expect(isLessonCompleted(5, 0, true)).toBe(false)
  })

  it("多练几句仍然通过（幂等，不因超出而失败）", () => {
    expect(isLessonCompleted(80, 50, true)).toBe(true)
  })
})

describe("isCourseCompleted · 课程完成判定", () => {
  it("每一节可练课时都达标 → 通过", () => {
    expect(
      isCourseCompleted(
        [
          { served: 10, practiced: 10 },
          { served: 3, practiced: 3 },
        ],
        true,
      ),
    ).toBe(true)
  })

  it("只要有一节没达标 → 不通过（不能抽查式完成）", () => {
    expect(
      isCourseCompleted(
        [
          { served: 10, practiced: 10 },
          { served: 10, practiced: 9 },
        ],
        true,
      ),
    ).toBe(false)
  })

  it("整课不可练的课时（served=0）不计入门槛，否则奖励永远领不到", () => {
    expect(
      isCourseCompleted(
        [
          { served: 10, practiced: 10 },
          { served: 0, practiced: 0 },
        ],
        true,
      ),
    ).toBe(true)
  })

  it("课程里一节可练课时都没有 → 不通过（空课程不算完成）", () => {
    expect(isCourseCompleted([], true)).toBe(false)
    expect(
      isCourseCompleted(
        [
          { served: 0, practiced: 0 },
          { served: 0, practiced: 0 },
        ],
        true,
      ),
    ).toBe(false)
  })

  it("回归：整门课零练习永远不通过", () => {
    const stats = Array.from({ length: 12 }, () => ({ served: 20, practiced: 0 }))
    expect(isCourseCompleted(stats, true)).toBe(false)
    expect(isCourseCompleted(stats, false)).toBe(false)
  })

  it("非会员按试学口径可完成整门课（每课 3 句）", () => {
    const stats = Array.from({ length: 5 }, () => ({ served: 40, practiced: FREE_TRIAL_SENTENCES }))
    expect(isCourseCompleted(stats, false)).toBe(true)
    // 同一个人若被当成会员看，门槛抬高，就不再算完成
    expect(isCourseCompleted(stats, true)).toBe(false)
  })
})
