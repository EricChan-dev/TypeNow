import { describe, expect, it } from "vitest"
import {
  FINGER_COLORS,
  FINGER_LABELS,
  KEY_FINGER,
  KEYBOARD_ROWS,
  TYPING_BEST_KEY,
  TYPING_LESSONS,
  accuracyOf,
  computeWpm,
  fingerOfKey,
  isBetterScore,
} from "@/lib/typing"

/** 键盘可视化里的每个键都必须有手指映射，否则渲染不出颜色与提示 */
describe("KEY_FINGER 覆盖", () => {
  it("KEYBOARD_ROWS 里每个键 + 空格都有手指映射，且值是合法 FingerId", () => {
    const validFingers = new Set(Object.keys(FINGER_LABELS))
    const flatKeys = KEYBOARD_ROWS.flat()
    for (const k of flatKeys) {
      expect(KEY_FINGER[k], `键 ${k} 缺手指映射`).toBeDefined()
      expect(validFingers.has(KEY_FINGER[k]), `键 ${k} 的手指 ${KEY_FINGER[k]} 非法`).toBe(true)
    }
    expect(KEY_FINGER[" "]).toBe("th")
  })

  it("KEY_FINGER 不包含键盘上不存在的多余键", () => {
    const onKeyboard = new Set([...KEYBOARD_ROWS.flat(), " "])
    for (const k of Object.keys(KEY_FINGER)) {
      expect(onKeyboard.has(k), `KEY_FINGER 里的 ${k} 不在键盘上`).toBe(true)
    }
  })

  it("fingerOfKey 未知键返回 null（调用方先 toLowerCase 再查）", () => {
    expect(fingerOfKey("Q")).toBeNull()
    expect(fingerOfKey("§")).toBeNull()
    expect(fingerOfKey("")).toBeNull()
  })

  it("标准盲打分工抽查：F/J 食指、E 右手中指应错、八指基准位正确", () => {
    expect(KEY_FINGER.f).toBe("li")
    expect(KEY_FINGER.j).toBe("ri")
    expect(KEY_FINGER.a).toBe("lp")
    expect(KEY_FINGER[";"]).toBe("rp")
    // 常见错法：E 属于左手中指，不是右手
    expect(KEY_FINGER.e).toBe("lm")
    expect(KEY_FINGER.i).toBe("rm")
    // 右手三排：K 中指、L 无名指、逗号中指（标准盲打，K/逗号最容易错标成左手）
    expect(KEY_FINGER.k).toBe("rm")
    expect(KEY_FINGER.l).toBe("rr")
    expect(KEY_FINGER[","]).toBe("rm")
    // 食指各管两列：T/U 归右手？—— T 左手、U 右手
    expect(KEY_FINGER.t).toBe("li")
    expect(KEY_FINGER.u).toBe("ri")
  })
})

/** 练习文本只允许已映射的键（小写+空格），出现未映射字符会卡在录入判定 */
describe("练习文本合法性", () => {
  it("所有 drill 文本只用已映射键，且全小写（第一期不练 Shift）", () => {
    for (const lesson of TYPING_LESSONS) {
      for (const drill of lesson.drills) {
        expect(drill.text.length).toBeGreaterThan(0)
        for (const ch of drill.text) {
          expect(KEY_FINGER[ch], `${lesson.id}/${drill.id} 的字符「${ch}」无映射`).toBeDefined()
          expect(ch, `${lesson.id}/${drill.id} 有大写字母（第一期不练 Shift）`).toBe(ch.toLowerCase())
        }
      }
    }
  })

  it("lesson 与 drill 的 id 全局唯一（localStorage 最佳成绩按 drill id 存）", () => {
    const lessonIds = TYPING_LESSONS.map((l) => l.id)
    expect(new Set(lessonIds).size).toBe(lessonIds.length)
    const drillIds = TYPING_LESSONS.flatMap((l) => l.drills.map((d) => d.id))
    expect(new Set(drillIds).size).toBe(drillIds.length)
  })
})

/** 计分口径：1 词 = 5 字符；没开始/没击键不给满分 */
describe("计分函数", () => {
  it("computeWpm：300 字符 = 60 词，60 秒敲完 = 60 WPM；未开始返回 0", () => {
    expect(computeWpm(300, 60_000)).toBe(60)
    expect(computeWpm(100, 30_000)).toBe(40)
    expect(computeWpm(0, 60_000)).toBe(0)
    expect(computeWpm(50, 0)).toBe(0)
    expect(computeWpm(50, -1)).toBe(0)
  })

  it("accuracyOf：95/100 = 95%，无击键返回 0（不是 100）", () => {
    expect(accuracyOf(95, 100)).toBe(95)
    expect(accuracyOf(1, 3)).toBe(33)
    expect(accuracyOf(0, 0)).toBe(0)
    expect(accuracyOf(10, 0)).toBe(0)
  })
})

/** 最佳成绩规则：wpm 更高，或 wpm 持平且正确率更高 */
describe("isBetterScore", () => {
  it("无旧成绩总是新纪录；只有综合更好才刷新", () => {
    expect(isBetterScore({ wpm: 10, accuracy: 50 }, undefined)).toBe(true)
    expect(isBetterScore({ wpm: 40, accuracy: 90 }, { wpm: 30, accuracy: 95 })).toBe(true)
    expect(isBetterScore({ wpm: 30, accuracy: 99 }, { wpm: 30, accuracy: 95 })).toBe(true)
    expect(isBetterScore({ wpm: 30, accuracy: 90 }, { wpm: 30, accuracy: 95 })).toBe(false)
    expect(isBetterScore({ wpm: 20, accuracy: 100 }, { wpm: 30, accuracy: 10 })).toBe(false)
  })
})

describe("常量完整性", () => {
  it("9 根手指都有颜色与中文标签，localStorage key 稳定", () => {
    expect(Object.keys(FINGER_LABELS).length).toBe(9)
    expect(Object.keys(FINGER_COLORS).length).toBe(9)
    for (const f of Object.keys(FINGER_LABELS)) {
      expect(FINGER_COLORS[f as keyof typeof FINGER_COLORS]).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(TYPING_BEST_KEY).toBe("typenow_typing_best")
  })
})
