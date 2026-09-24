/**
 * 课时导航（src/lib/course-nav.ts）。
 *
 * 存在的理由：完成一课后弹窗只有「再来一次 / 返回课程」，没有「继续下一课」，
 * 用户学完一课必须自己回课程详情页找下一课，学习流在这里断掉。
 *
 * 顺序以调用方传入的数组为准（/api/courses/[id]/lessons 已按 sort_order 升序返回），
 * 本函数不重新排序，避免出现「接口顺序」与「前端顺序」两套口径。
 */
import { describe, it, expect } from "vitest"
import { findNextLesson } from "@/lib/course-nav"

const lessons = [{ id: "a" }, { id: "b" }, { id: "c" }]

describe("findNextLesson", () => {
  it("返回当前课时的下一课", () => {
    expect(findNextLesson(lessons, "a")).toEqual({ id: "b" })
    expect(findNextLesson(lessons, "b")).toEqual({ id: "c" })
  })

  it("最后一课没有下一课", () => {
    expect(findNextLesson(lessons, "c")).toBeNull()
  })

  it("当前课时不在列表里 → 不去猜，返回 null", () => {
    expect(findNextLesson(lessons, "zzz")).toBeNull()
  })

  it("列表为空 / 缺省 / 当前 id 缺失 → null，不抛异常", () => {
    expect(findNextLesson([], "a")).toBeNull()
    expect(findNextLesson(null, "a")).toBeNull()
    expect(findNextLesson(undefined, "a")).toBeNull()
    expect(findNextLesson(lessons, null)).toBeNull()
    expect(findNextLesson(lessons, undefined)).toBeNull()
    expect(findNextLesson(lessons, "")).toBeNull()
  })

  it("保留调用方的数据类型（不只返回 id）", () => {
    const rich = [
      { id: "a", title: "第一课", sortOrder: 1 },
      { id: "b", title: "第二课", sortOrder: 2 },
    ]
    expect(findNextLesson(rich, "a")).toEqual({ id: "b", title: "第二课", sortOrder: 2 })
  })
})
