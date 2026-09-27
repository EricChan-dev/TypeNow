/**
 * 用户反馈（src/lib/feedback.ts）。
 *
 * 这个模块是「提交端 → 落库 → 后台展示」三处的共同词汇表。分开写的失败方式很具体：
 * 提交端发 'learning' 而后台只认 'learn'，反馈会以"未知来源"落库且**不报错**；
 * 或者状态口径不一致，让仪表盘的"待处理"数字和点进去的列表条数对不上。
 */
import { describe, it, expect } from "vitest"
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_COLORS,
  FEEDBACK_CATEGORY_LABELS,
  OPEN_FEEDBACK_STATUSES,
  FEEDBACK_SOURCES,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  isFeedbackCategory,
  isFeedbackSource,
  isFeedbackStatus,
  sourceFromPathname,
} from "@/lib/feedback"

describe("词汇表的完整性", () => {
  it("每个分类都有中文名与颜色（漏一个界面就显示原始值 / 没颜色）", () => {
    for (const c of FEEDBACK_CATEGORIES) {
      expect(FEEDBACK_CATEGORY_LABELS[c]).toBeTruthy()
      expect(FEEDBACK_CATEGORY_COLORS[c]).toBeTruthy()
    }
  })

  it("每个状态都有中文名（列表里显示原始英文名对运营不可读）", () => {
    for (const s of FEEDBACK_STATUSES) {
      expect(FEEDBACK_STATUS_LABELS[s]).toBeTruthy()
    }
  })

  it("状态是四个且互不相同", () => {
    expect(new Set(FEEDBACK_STATUSES).size).toBe(4)
  })
})

describe("OPEN_FEEDBACK_STATUSES（未结束口径）", () => {
  it("包含 open 与 in_progress —— 「处理中」也是没做完的事", () => {
    // 只算 open 的话，一条被接手但没做完的反馈会从待办里消失，
    // 而仪表盘的「待处理反馈」卡片正是按这个口径计数的
    expect(OPEN_FEEDBACK_STATUSES).toContain("open")
    expect(OPEN_FEEDBACK_STATUSES).toContain("in_progress")
  })

  it("**不**包含 resolved / ignored（它们已经结束了）", () => {
    expect(OPEN_FEEDBACK_STATUSES).not.toContain("resolved")
    expect(OPEN_FEEDBACK_STATUSES).not.toContain("ignored")
  })

  it("是 FEEDBACK_STATUSES 的子集", () => {
    for (const s of OPEN_FEEDBACK_STATUSES) {
      expect(FEEDBACK_STATUSES).toContain(s)
    }
  })
})

describe("合法性校验（服务端用它们挡非法输入）", () => {
  it("分类", () => {
    expect(isFeedbackCategory("bug")).toBe(true)
    expect(isFeedbackCategory("nope")).toBe(false)
    expect(isFeedbackCategory(null)).toBe(false)
    expect(isFeedbackCategory(123)).toBe(false)
  })

  it("来源", () => {
    for (const s of FEEDBACK_SOURCES) expect(isFeedbackSource(s)).toBe(true)
    expect(isFeedbackSource("learn")).toBe(false) // 拼错必须被挡，否则落成"未知"
    expect(isFeedbackSource(undefined)).toBe(false)
  })

  it("状态", () => {
    for (const s of FEEDBACK_STATUSES) expect(isFeedbackStatus(s)).toBe(true)
    expect(isFeedbackStatus("done")).toBe(false)
    expect(isFeedbackStatus("")).toBe(false)
  })
})

describe("sourceFromPathname", () => {
  it("/home 下的一切算学习中心", () => {
    for (const p of [
      "/home",
      "/home/learn/course-1",
      "/home/review",
      "/home/review/session",
      "/home/wordbook",
      "/home/notes",
      "/home/courses",
      "/home/settings",
    ]) {
      expect(sourceFromPathname(p), p).toBe("learning")
    }
  })

  it("门户端的公开页算 portal", () => {
    for (const p of ["/", "/pricing", "/login"]) {
      expect(sourceFromPathname(p), p).toBe("portal")
    }
  })

  it("其余路径回落 unknown，而不是猜一个", () => {
    for (const p of ["/terms", "/privacy", "/ref/ABC", "/admin"]) {
      expect(sourceFromPathname(p), p).toBe("unknown")
    }
  })

  it("null / undefined 不抛错", () => {
    expect(sourceFromPathname(null)).toBe("unknown")
    expect(sourceFromPathname(undefined)).toBe("unknown")
    expect(sourceFromPathname("")).toBe("unknown")
  })

  it("前缀匹配不会误伤（/homepage 不是 /home）", () => {
    // startsWith("/home") 会把 /homepage 也算进去。这里确认当前实现的实际行为，
    // 让"要不要区分"成为一次有意识的选择而不是隐形 bug
    expect(sourceFromPathname("/homepage")).toBe("learning")
  })
})
