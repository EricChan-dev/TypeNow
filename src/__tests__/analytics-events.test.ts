/**
 * 埋点事件清单与漏斗定义（src/lib/analytics-events.ts）。
 *
 * 这个模块存在的理由就是把事件名收敛成单一来源，所以测试的重点不是「函数能跑」，
 * 而是**两端不会漂移**：
 *   1. 漏斗里每一步若声明来自埋点（source="events"），该事件名必须真的在白名单里
 *      —— 否则前端发了、后端 400 拒绝，报表永远查不到（这正是写这个模块时
 *      当场踩到的坑：漏斗引用了 pricing_view，白名单里却没有）。
 *   2. 白名单不能有重复项（Set 会静默吞掉，事件名写重了看不出来）。
 */
import { describe, it, expect } from "vitest"
import {
  ALLOWED_EVENTS,
  EVENT_CATEGORIES,
  EVENT_META,
  FUNNEL_STEPS,
  eventLabel,
  eventsByCategory,
  isAllowedEvent,
} from "@/lib/analytics-events"

describe("ALLOWED_EVENTS", () => {
  it("没有重复项", () => {
    expect(new Set(ALLOWED_EVENTS).size).toBe(ALLOWED_EVENTS.length)
  })

  it("都是非空字符串", () => {
    for (const e of ALLOWED_EVENTS) {
      expect(typeof e).toBe("string")
      expect(e.length).toBeGreaterThan(0)
    }
  })
})

describe("isAllowedEvent", () => {
  it("白名单内的事件通过", () => {
    for (const e of ALLOWED_EVENTS) {
      expect(isAllowedEvent(e)).toBe(true)
    }
  })

  it("未登记的事件被拒（防灌库）", () => {
    expect(isAllowedEvent("随便编的事件")).toBe(false)
    expect(isAllowedEvent("pageview")).toBe(false)      // 少个下划线也不行
    expect(isAllowedEvent("")).toBe(false)
  })

  it("非字符串一律拒绝", () => {
    expect(isAllowedEvent(null)).toBe(false)
    expect(isAllowedEvent(undefined)).toBe(false)
    expect(isAllowedEvent(123)).toBe(false)
    expect(isAllowedEvent({ toString: () => "page_view" })).toBe(false)
  })
})

describe("FUNNEL_STEPS", () => {
  it("step key 唯一", () => {
    const keys = FUNNEL_STEPS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("**关键不变量**：声明来自埋点的步骤，其 key 必须在白名单里", () => {
    const eventSteps = FUNNEL_STEPS.filter((s) => s.source === "events")
    expect(eventSteps.length).toBeGreaterThan(0)
    for (const step of eventSteps) {
      expect(
        isAllowedEvent(step.key),
        `漏斗步骤 ${step.key} 声明来自埋点，但不在 ALLOWED_EVENTS 里 —— ` +
          `前端上报会被后端 400 拒绝，报表永远为空`,
      ).toBe(true)
    }
  })

  it("漏斗以注册开始、以付费结束（顺序即展示顺序）", () => {
    expect(FUNNEL_STEPS[0].key).toBe("registered")
    expect(FUNNEL_STEPS[FUNNEL_STEPS.length - 1].key).toBe("paid")
  })

  it("每一步都有中文标签", () => {
    for (const s of FUNNEL_STEPS) {
      expect(s.label.length).toBeGreaterThan(0)
    }
  })
})

// ─── 事件字典（EVENT_META） ──────────────────────────────────────────────────

describe("EVENT_META", () => {
  it("每个白名单事件都有字典条目（漏写会被 TS 拦住，这里再兜一层运行时保证）", () => {
    for (const e of ALLOWED_EVENTS) {
      expect(EVENT_META[e], `缺少 ${e} 的字典条目`).toBeDefined()
      expect(EVENT_META[e].label.length).toBeGreaterThan(0)
      expect(EVENT_META[e].description.length).toBeGreaterThan(0)
    }
  })

  it("字典里没有白名单之外的多余条目", () => {
    for (const key of Object.keys(EVENT_META)) {
      expect(ALLOWED_EVENTS).toContain(key)
    }
  })

  it("每个事件只属于一个分类，且分类在 EVENT_CATEGORIES 内", () => {
    for (const e of ALLOWED_EVENTS) {
      expect(EVENT_CATEGORIES).toContain(EVENT_META[e].category)
    }
  })

  it("事件名不重复出现在多个分类分组里（分组是划分，不是标签）", () => {
    const seen = new Set<string>()
    for (const group of eventsByCategory()) {
      for (const e of group.events) {
        expect(seen.has(e), `${e} 出现在多个分类`).toBe(false)
        seen.add(e)
      }
    }
    expect(seen.size).toBe(ALLOWED_EVENTS.length)
  })
})

describe("eventLabel", () => {
  it("白名单内返回中文名", () => {
    expect(eventLabel("page_view")).toBe(EVENT_META.page_view.label)
    expect(eventLabel("trial_claimed")).toBe("领取体验会员")
  })

  it("未知事件名原样返回，不抛错（历史脏数据必须能展示）", () => {
    expect(eventLabel("legacy_event_from_2024")).toBe("legacy_event_from_2024")
    expect(eventLabel("")).toBe("")
  })

  it("漏斗里每一个 source=events 的步骤都能翻译成中文", () => {
    for (const step of FUNNEL_STEPS.filter((s) => s.source === "events")) {
      expect(isAllowedEvent(step.key), `漏斗步骤 ${step.key} 不在白名单`).toBe(true)
      expect(eventLabel(step.key)).not.toBe(step.key)
    }
  })
})
