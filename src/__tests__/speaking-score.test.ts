import { describe, expect, it } from "vitest"
import {
  buildSpeakingLimitMessage,
  formatSpeakingClock,
  getFeedbackMessage,
  getScoreColor,
  getSpeakingScoreLevel,
  mapEvaluateToSpeakingWords,
  speakingWordStatus,
} from "@/lib/speaking-score"
import type { EvaluateResult } from "@/lib/pronunciation"

/**
 * 口语评分的展示口径。这些阈值与文案必须与参考站 `speaking.js` 逐字一致
 * —— 它们是「一模一样」里最容易悄悄漂移的部分（没有类型系统兜着，
 * 只有数字和字符串）。
 *
 * 参考站对应位置：
 *   · `getSpeakingScoreLevel` speaking.js:965
 *   · `getScoreColor`        speaking.js:972
 *   · `getFeedbackMessage`   speaking.js:979
 *   · `renderSentenceWithScores` speaking.js:411（逐词三段阈值）
 *   · `buildSpeakingLimitMessage` speaking.js:109
 */

describe("getSpeakingScoreLevel", () => {
  it("按 90/80/60 三档切开，边界值归上档", () => {
    expect(getSpeakingScoreLevel(90)).toEqual({ text: "Outstanding", className: "excellent" })
    expect(getSpeakingScoreLevel(100)).toEqual({ text: "Outstanding", className: "excellent" })
    expect(getSpeakingScoreLevel(89.9)).toEqual({ text: "Excellent", className: "good" })
    expect(getSpeakingScoreLevel(80)).toEqual({ text: "Excellent", className: "good" })
    expect(getSpeakingScoreLevel(79.9)).toEqual({ text: "Good", className: "fair" })
    expect(getSpeakingScoreLevel(60)).toEqual({ text: "Good", className: "fair" })
    expect(getSpeakingScoreLevel(59.9)).toEqual({ text: "Keep Trying", className: "poor" })
    expect(getSpeakingScoreLevel(0)).toEqual({ text: "Keep Trying", className: "poor" })
  })
})

describe("getScoreColor", () => {
  it("返回 CSS 变量名，而不是硬编码色值", () => {
    // 这条断言是防漂移的关键：改回 hex 会让浅色主题下的环形进度条看不清。
    for (const score of [95, 85, 65, 10]) {
      expect(getScoreColor(score)).toMatch(/^var\(--score-/)
    }
  })

  it("四档变量与等级同源", () => {
    expect(getScoreColor(90)).toBe("var(--score-excellent)")
    expect(getScoreColor(80)).toBe("var(--score-good)")
    expect(getScoreColor(60)).toBe("var(--score-fair)")
    expect(getScoreColor(59)).toBe("var(--score-poor)")
  })
})

describe("getFeedbackMessage", () => {
  it("五档文案逐字一致，边界归上档", () => {
    expect(getFeedbackMessage(90)).toBe("发音完美，甚至超越了原音！")
    expect(getFeedbackMessage(80)).toBe("发音清晰，非常地道！")
    expect(getFeedbackMessage(70)).toBe("不错，继续保持！")
    expect(getFeedbackMessage(60)).toBe("勉强及格，多加练习。")
    expect(getFeedbackMessage(59)).toBe("请大声一点，或者再多听几遍原音。")
  })

  it("70 档的存在意味着 70–79 会出现「不错」但等级是 Good", () => {
    // 两者阈值不同源（等级 60/80/90，评语 60/70/80/90），这是参考站原样。
    expect(getSpeakingScoreLevel(75).text).toBe("Good")
    expect(getFeedbackMessage(75)).toBe("不错，继续保持！")
  })
})

describe("speakingWordStatus", () => {
  it("漏读优先于分数", () => {
    expect(speakingWordStatus(100, true)).toBe("missing")
    expect(speakingWordStatus(0, true)).toBe("missing")
  })

  it("按 60/80 两档切开", () => {
    expect(speakingWordStatus(80, false)).toBe("correct")
    expect(speakingWordStatus(79.9, false)).toBe("warning")
    expect(speakingWordStatus(60, false)).toBe("warning")
    expect(speakingWordStatus(59.9, false)).toBe("error")
    expect(speakingWordStatus(0, false)).toBe("error")
  })
})

describe("mapEvaluateToSpeakingWords", () => {
  const base: EvaluateResult = {
    score: 88,
    accuracy: 90,
    fluency: 85,
    integrity: 80,
    speed: 3,
    words: [
      { word: "The", score: 95 },
      { word: "red", score: 70 },
      { word: "bus", score: 40 },
    ],
  }

  it("保留顺序与分数", () => {
    const out = mapEvaluateToSpeakingWords(base)
    expect(out.map((w) => w.content)).toEqual(["The", "red", "bus"])
    expect(out.map((w) => w.totalScore)).toEqual([95, 70, 40])
    expect(out.every((w) => !w.isMissing)).toBe(true)
  })

  it("score 为 null 视为漏读，而不是 0 分", () => {
    // 这是 `EvaluateWordScore.score` 的契约（pronunciation.ts:41）：
    // null 表示「接口没给这个词的分」，不是「读得极差」。
    const out = mapEvaluateToSpeakingWords({
      ...base,
      words: [{ word: "bus", score: null }],
    })
    expect(out).toEqual([{ content: "bus", totalScore: 0, isMissing: true }])
  })

  it("过滤静音占位与空词", () => {
    const out = mapEvaluateToSpeakingWords({
      ...base,
      words: [
        { word: "sil", score: 0 },
        { word: "silv", score: 0 },
        { word: "", score: 50 },
        { word: "ok", score: 50 },
      ],
    })
    expect(out.map((w) => w.content)).toEqual(["ok"])
  })

  it("words 缺失或为 null 返回空数组", () => {
    expect(mapEvaluateToSpeakingWords(null)).toEqual([])
    expect(mapEvaluateToSpeakingWords({ ...base, words: [] })).toEqual([])
  })
})

describe("buildSpeakingLimitMessage", () => {
  it("服务端给了 message 就用它", () => {
    expect(
      buildSpeakingLimitMessage({ message: "自定义提示", currentCount: 3, maxCount: 3 }),
    ).toBe("自定义提示")
  })

  it("没有 message 时按当前/上限拼", () => {
    expect(buildSpeakingLimitMessage({ currentCount: 3, maxCount: 3 })).toBe(
      "今日口语评测 3/3 次已用完，明天 00:00 后恢复。",
    )
  })

  it("maxCount 非正时退化为不带数字的说法", () => {
    // 合伙人曾经走 maxCount = -1 这条（我们没启用，但端口保留）。
    expect(buildSpeakingLimitMessage({ currentCount: 0, maxCount: 0 })).toBe(
      "今日口语评测次数已用完，明天 00:00 后恢复。",
    )
    expect(buildSpeakingLimitMessage({ currentCount: 0, maxCount: -1 })).toBe(
      "今日口语评测次数已用完，明天 00:00 后恢复。",
    )
  })
})

describe("formatSpeakingClock", () => {
  it("补零到 mm:ss", () => {
    expect(formatSpeakingClock(0)).toBe("00:00")
    expect(formatSpeakingClock(9)).toBe("00:09")
    expect(formatSpeakingClock(60)).toBe("01:00")
    expect(formatSpeakingClock(605)).toBe("10:05")
  })

  it("超过一小时不进位到时（参考站也不进位，继续累加分钟）", () => {
    expect(formatSpeakingClock(3661)).toBe("61:01")
  })

  it("负数与小数被夹平", () => {
    expect(formatSpeakingClock(-5)).toBe("00:00")
    expect(formatSpeakingClock(1.9)).toBe("00:01")
  })
})
