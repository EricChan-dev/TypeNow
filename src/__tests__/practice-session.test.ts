import { describe, it, expect } from "vitest"
import { clampResumeIndex, decideResume } from "@/lib/practice-session"

// 「继续上次练习」的恢复决策：纯函数，不碰 DB / React，便于把边界钉死。
//
// 背景：practice_sessions.current_index 存的是「下一句要练的下标」，不是「已练句数」。
// 三种状态里只有 active 值得恢复；completed / abandoned 都不该把用户拽回半途。
// 旧的实现把 user_course_progress.sentence_count（GREATEST 单调累计的历史句数）
// 当成恢复下标，句子总数一变就会指到越界位置，因此这里必须显式钳制。

describe("clampResumeIndex", () => {
  it("范围内的下标原样返回", () => {
    expect(clampResumeIndex(3, 10)).toBe(3)
  })

  it("等于总句数（最后一句也练完了）时钳到倒数第二句之前的最后一句，绝不越界", () => {
    // 选择：夹到 total - 1 而不是 0。完成全部句子后再恢复，应停在最后一句，
    // 让用户补一遍而不是被无声地送回开头。
    expect(clampResumeIndex(10, 10)).toBe(9)
  })

  it("远超总句数（例如中途删题导致总数缩水）同样钳到最后一句", () => {
    expect(clampResumeIndex(999, 10)).toBe(9)
  })

  it("总句数为 0 时直接返回 0", () => {
    expect(clampResumeIndex(5, 0)).toBe(0)
  })

  it("总句数为负数时返回 0", () => {
    expect(clampResumeIndex(5, -3)).toBe(0)
  })

  it("NaN 回退到默认 0", () => {
    expect(clampResumeIndex(NaN, 10)).toBe(0)
  })

  it("-1 回退到默认 0", () => {
    expect(clampResumeIndex(-1, 10)).toBe(0)
  })

  it("Infinity / -Infinity 这类非有限值回退到默认 0", () => {
    expect(clampResumeIndex(Infinity, 10)).toBe(0)
    expect(clampResumeIndex(-Infinity, 10)).toBe(0)
  })

  it("显式 fallback 用于非法入参", () => {
    expect(clampResumeIndex(NaN, 10, 4)).toBe(4)
    expect(clampResumeIndex(-1, 10, 4)).toBe(4)
  })

  it("fallback 自己越界时也照样被钳制", () => {
    expect(clampResumeIndex(NaN, 3, 99)).toBe(2)
  })
})

describe("decideResume", () => {
  it("没有会话记录时不恢复", () => {
    expect(decideResume(null, 10)).toEqual({ index: 0, restored: false })
    expect(decideResume(undefined, 10)).toEqual({ index: 0, restored: false })
  })

  it("已完成的会话不恢复", () => {
    expect(decideResume({ currentIndex: 5, state: "completed" }, 10)).toEqual({
      index: 0,
      restored: false,
    })
  })

  it("已放弃的会话不恢复", () => {
    expect(decideResume({ currentIndex: 5, state: "abandoned" }, 10)).toEqual({
      index: 0,
      restored: false,
    })
  })

  it("active 但停在开头时不算「恢复」，不要打扰本来就从第一句开始的人", () => {
    expect(decideResume({ currentIndex: 0, state: "active" }, 10)).toEqual({
      index: 0,
      restored: false,
    })
  })

  it("active 且停在中途时恢复并给出提示", () => {
    expect(decideResume({ currentIndex: 3, state: "active" }, 10)).toEqual({
      index: 3,
      restored: true,
    })
    expect(decideResume({ currentIndex: 1, state: "active" }, 10)).toEqual({
      index: 1,
      restored: true,
    })
  })

  it("下标正好等于总句数时钳到最后一句，并保留恢复提示", () => {
    expect(decideResume({ currentIndex: 10, state: "active" }, 10)).toEqual({
      index: 9,
      restored: true,
    })
  })

  it("下标远超总句数时同样钳到最后一句", () => {
    expect(decideResume({ currentIndex: 500, state: "active" }, 10)).toEqual({
      index: 9,
      restored: true,
    })
  })

  it("钳制结果落回 0 时不能伪造恢复提示（只有一句且已练完）", () => {
    // 这是「钳制不得凭空造出 restored」的关键用例：currentIndex=1 看似有进度，
    // 但 total=1 钳到 0，等于从头开始，此时再提示「已为你恢复」就是骗人。
    expect(decideResume({ currentIndex: 1, state: "active" }, 1)).toEqual({
      index: 0,
      restored: false,
    })
  })

  it("总句数为 0 时不恢复", () => {
    expect(decideResume({ currentIndex: 3, state: "active" }, 0)).toEqual({
      index: 0,
      restored: false,
    })
  })

  it("NaN 下标不恢复", () => {
    expect(decideResume({ currentIndex: NaN, state: "active" }, 10)).toEqual({
      index: 0,
      restored: false,
    })
  })

  it("-1 下标不恢复", () => {
    expect(decideResume({ currentIndex: -1, state: "active" }, 10)).toEqual({
      index: 0,
      restored: false,
    })
  })
})
