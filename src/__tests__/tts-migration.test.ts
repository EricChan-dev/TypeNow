/**
 * 朗读设置的一次性迁移（src/lib/hooks/useTTSSettings.ts）。
 *
 * 背景：全站朗读统一切到有道。但 `load()` 是 `{...defaults, ...localStorage}`，
 * 老用户 localStorage 里**已经存了** `source:"browser"`（任何一次 updateSettings
 * 都会把整个对象写回），只改 defaults 对他们完全无效 —— 声音依旧不统一。
 * 所以 v1 → v2 必须主动改写 source，这段逻辑不允许被"顺手简化"掉。
 */
import { describe, it, expect } from "vitest"
import { migrateTTSSettings } from "@/lib/hooks/useTTSSettings"

describe("migrateTTSSettings", () => {
  it("v1 老配置（source=browser、无 version）被强制刷成有道", () => {
    const out = migrateTTSSettings({ source: "browser", voice: "Daniel", volume: 0.5, rate: 0.8 })
    expect(out.source).toBe("youdao")
    expect(out.version).toBeGreaterThanOrEqual(2)
  })

  it("迁移保留用户调过的音量/语速/音色，只改来源", () => {
    const out = migrateTTSSettings({ source: "browser", voice: "Samantha", volume: 0.5, rate: 1.2 })
    expect(out.voice).toBe("Samantha")
    expect(out.volume).toBe(0.5)
    expect(out.rate).toBe(1.2)
  })

  it("没有存储时用新默认（有道）", () => {
    expect(migrateTTSSettings(null).source).toBe("youdao")
    expect(migrateTTSSettings(undefined).source).toBe("youdao")
    expect(migrateTTSSettings({}).source).toBe("youdao")
  })

  it("已经是 v2 的用户，其选择被尊重（可停留在浏览器语音）", () => {
    const out = migrateTTSSettings({ source: "browser", version: 2 })
    expect(out.source).toBe("browser")
  })

  it("迁移结果带 version，保证只跑一次", () => {
    const once = migrateTTSSettings({ source: "browser" })
    const twice = migrateTTSSettings(once)
    expect(twice.source).toBe("youdao")

    // 迁移后用户改回浏览器，再读不能被再次覆盖
    const userChanged = migrateTTSSettings({ ...once, source: "browser" })
    expect(userChanged.source).toBe("browser")
  })

  it("有道发音人默认值存在（否则迁移后没声音可选）", () => {
    expect(migrateTTSSettings(null).youdaoVoice).toBeTruthy()
  })
})

// ─── v3：默认音色改成「有雅婷」 ──────────────────────────────────────────────

describe("migrateTTSSettings v3 音色迁移", () => {
  it("v2 的老配置：音色被刷成 youyating（不刷的话改了默认值对老用户完全无效）", () => {
    // localStorage 里躺着旧默认 youxiaomei —— 包括从没进过设置页的人，
    // 因为任何一次 updateSettings 都会把整个对象写回去
    const out = migrateTTSSettings({ youdaoVoice: "youxiaomei", version: 2 })
    expect(out.youdaoVoice).toBe("youyating")
    expect(out.version).toBe(3)
  })

  it("从未存过配置（version 缺失）也拿到新音色", () => {
    expect(migrateTTSSettings(null).youdaoVoice).toBe("youyating")
    expect(migrateTTSSettings({}).youdaoVoice).toBe("youyating")
  })

  it("已经是 v3 的配置不再被动：用户自己换的音色要保住", () => {
    // 迁移只发生一次。否则每次朗读都把人选的音色改回去 —— 那比不迁移更糟
    const out = migrateTTSSettings({ youdaoVoice: "youxiaoguan", version: 3 })
    expect(out.youdaoVoice).toBe("youxiaoguan")
  })

  it("v1 配置同时完成两件事：source 归一到 youdao、音色刷成新默认", () => {
    const out = migrateTTSSettings({ source: "browser", voice: "Daniel", version: 1 })
    expect(out.source).toBe("youdao")
    expect(out.youdaoVoice).toBe("youyating")
    expect(out.version).toBe(3)
    // 与音色无关的设置不能被顺手清掉
    expect(out.voice).toBe("Daniel")
  })
})
