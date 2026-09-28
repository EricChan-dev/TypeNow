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
import fs from "node:fs"
import path from "node:path"
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

  it("**关键不变量**：声明来自埋点事件的步骤，其 key 必须在白名单里", () => {
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

  it("**关键不变量**：traffic 类步骤是推导量，不能与某个事件名同名", () => {
    // 同名会让人误以为"这一步就是那个事件的次数"，而两者口径完全不同
    // （traffic 按 visitor 去重，events 按事件行数）。真同名时这里直接拦住。
    const trafficSteps = FUNNEL_STEPS.filter((s) => s.source === "traffic")
    expect(trafficSteps.length).toBeGreaterThan(0)
    for (const step of trafficSteps) {
      expect(
        isAllowedEvent(step.key),
        `漏斗步骤 ${step.key} 声明为推导量（traffic），但恰好是一个事件名 —— ` +
          `这会让"报表口径"与"事件次数"混淆，请改名或改 source`,
      ).toBe(false)
    }
  })

  it("漏斗从访问站点开始、以付费结束（顺序即展示顺序）", () => {
    // 第一步曾经是 registered，导致"来了多少人 → 注册了多少"这个获客顶端
    // 在后台完全无法回答（匿名数据其实一直在库里）
    expect(FUNNEL_STEPS[0].key).toBe("visited")
    expect(FUNNEL_STEPS[1].key).toBe("registered")
    expect(FUNNEL_STEPS[FUNNEL_STEPS.length - 1].key).toBe("paid")
  })

  it("每一步都有中文标签", () => {
    for (const s of FUNNEL_STEPS) {
      expect(s.label.length).toBeGreaterThan(0)
    }
  })
})

// ─── 事件字典（EVENT_META） ──────────────────────────────────────────────────

describe("触屏提示事件与 device 维度", () => {
  it("两个触屏提示事件都在白名单里，且归在学习分类", () => {
    for (const name of ["touch_notice_shown", "touch_notice_dismissed"] as const) {
      expect(ALLOWED_EVENTS).toContain(name)
      expect(EVENT_META[name].category).toBe("learning")
      expect(EVENT_META[name].label.length).toBeGreaterThan(0)
    }
  })

  it("track() 给**每个**事件自动挂上 device，且不允许调用点覆盖", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/analytics.ts"), "utf8")
    // 放在展开之后 = 调用点传的同名值会被覆盖：device 是维度，必须只有一个口径
    expect(src).toMatch(/properties:\s*\{\s*\.\.\.\(properties \|\| \{\}\),\s*device: currentDeviceClass\(\)\s*\}/)
    // 判定必须复用 desktop-only 的那一套，否则会出现
    // 「提示条说你是手机、埋点说你是桌面」
    expect(src).toContain('from "@/lib/desktop-only"')
    expect(src).toContain("deviceClassOf(")
    expect(src).not.toContain('window.innerWidth <')
  })

  it("练习页的提示接线完整：出现报一次、关闭也报一次", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/home/learn/LearnClient.tsx"),
      "utf8",
    )
    expect(src).toContain("trackTouchNoticeShown()")
    expect(src).toContain("trackTouchNoticeDismissed()")
    // 每次挂载只报一次，否则 showDesktopNotice 随 (hover:none) 变化会重复计数
    expect(src).toContain("touchNoticeTrackedRef")
  })
})

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
