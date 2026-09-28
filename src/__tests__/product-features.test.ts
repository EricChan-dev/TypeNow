/**
 * 功能介绍与版本更新的事实源自检。
 *
 * 这份测试守的是同一件事的两面：
 *
 *   1. **不得再写没实现的功能。** 落地页曾同时给出「出题练习 / 场景对话 /
 *      AI 写作批改 / 报告导出」四项代码里不存在的能力。这里把当时的具体错误
 *      固化成黑名单，并额外要求数量类宣称只写向下取整的安全值。
 *   2. **更新日志不得泄露漏洞细节。** 安全修复写进公开日志等于给未升级的
 *      环境留一份说明，所以除了"已修复"之外不许出现接口路径或利用条件。
 *
 * 另外守住两条工程约束：两个页面都必须消费事实源（而不是内联文案），
 * 且都要出现在 sitemap 里 —— 新站没有 sitemap 就等于对搜索引擎不存在。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { FEATURE_GROUPS } from "@/lib/product-features"
import { RELEASES } from "@/lib/releases"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

/** 曾经真实上线过、但在代码里不存在的宣称（含"人人都有却当会员卖"的措辞）。 */
const BANNED_CLAIMS = [
  "分块模式",
  "自定义上传",
  "报告导出",
  "FSRS",
  "音素级",
  "专属徽章",
  "听说读写",
  "出题练习",
  "场景对话",
  "写作批改",
  "AI 强化训练",
  "上千套",
  "1000+",
]

describe("FEATURE_GROUPS · 功能介绍", () => {
  it("分组与条目的字段齐全，id / anchor 唯一", () => {
    const ids = new Set<string>()
    const anchors = new Set<string>()
    expect(FEATURE_GROUPS.length).toBeGreaterThan(0)
    for (const g of FEATURE_GROUPS) {
      expect(g.id).toBeTruthy()
      expect(g.anchor).toBeTruthy()
      expect(g.title).toBeTruthy()
      expect(g.summary).toBeTruthy()
      expect(ids.has(g.id)).toBe(false)
      expect(anchors.has(g.anchor)).toBe(false)
      ids.add(g.id)
      anchors.add(g.anchor)

      expect(g.items.length).toBeGreaterThan(0)
      for (const item of g.items) {
        expect(item.title).toBeTruthy()
        expect(item.detail).toBeTruthy()
      }
    }
  })

  it("回归：不得出现代码里不存在的功能宣称", () => {
    const allText = FEATURE_GROUPS.map(
      (g) => `${g.title} ${g.summary} ${g.caveat ?? ""} ${g.items.map((i) => `${i.title} ${i.detail}`).join(" ")}`,
    ).join(" ")
    for (const word of BANNED_CLAIMS) {
      expect(allText).not.toContain(word)
    }
  })

  it("数量类宣称只写向下取整的安全值（700+ 而不是精确值或夸大值）", () => {
    const allText = FEATURE_GROUPS.map(
      (g) => `${g.summary} ${g.items.map((i) => `${i.title} ${i.detail}`).join(" ")}`,
    ).join(" ")
    expect(allText).toContain("700+")
  })

  it("涉及设备限制的取舍必须写明（练习需要键盘是刻意决策，不能藏起来）", () => {
    const typing = FEATURE_GROUPS.find((g) => g.id === "typing")
    expect(typing?.caveat).toContain("键盘")
  })

  it("AI 讲解的降级行为要如实写明，而不是承诺永不失败", () => {
    const explain = FEATURE_GROUPS.find((g) => g.id === "explain")
    expect(explain?.caveat).toContain("暂不可用")
  })
})

describe("RELEASES · 版本更新", () => {
  it("日期是合法的 YYYY-MM-DD，且按时间倒序（最新在前）", () => {
    expect(RELEASES.length).toBeGreaterThan(0)
    let previous = Number.POSITIVE_INFINITY
    for (const entry of RELEASES) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const t = new Date(`${entry.date}T00:00:00Z`).getTime()
      expect(Number.isNaN(t)).toBe(false)
      // 倒序：当前条目不得比上一条更新
      expect(t).toBeLessThanOrEqual(previous)
      previous = t
    }
  })

  it("标题与条目非空，(date, title) 不重复", () => {
    const keys = new Set<string>()
    for (const entry of RELEASES) {
      expect(entry.title).toBeTruthy()
      expect(entry.items.length).toBeGreaterThan(0)
      for (const item of entry.items) expect(item.trim()).toBeTruthy()
      const key = `${entry.date}|${entry.title}`
      expect(keys.has(key)).toBe(false)
      keys.add(key)
    }
  })

  it("回归：不得泄露漏洞细节（接口路径 / 利用条件 / 漏洞字样）", () => {
    const allText = RELEASES.map((e) => `${e.title} ${e.items.join(" ")}`).join(" ")
    // 白名单式地允许"已修复"这类表述，但不允许出现具体位置与手法
    for (const leak of ["/api/", "漏洞", "无限刷", "绕过", "校验缺失"]) {
      expect(allText).not.toContain(leak)
    }
    // 安全类修复必须有条目，否则等于隐瞒"这个版本修过安全问题"
    expect(allText).toContain("安全问题")
  })

  it("回归：更新日志里也不得点名从未做过的功能（skim 的用户会以为它们存在）", () => {
    const allText = RELEASES.map((e) => `${e.title} ${e.items.join(" ")}`).join(" ")
    for (const word of BANNED_CLAIMS) {
      expect(allText).not.toContain(word)
    }
  })

  it("承诺的免费能力与会员权益口径一致（都写 700+、都提免费试学）", () => {
    const allText = RELEASES.map((e) => e.items.join(" ")).join(" ")
    expect(allText).toContain("免费试学")
  })
})

describe("页面接线", () => {
  it("功能介绍页与更新日志页都消费事实源，且都有页面级 metadata", () => {
    const pages: Array<[string, string]> = [
      ["src/app/(public)/features/page.tsx", "@/lib/product-features"],
      ["src/app/(public)/releases/page.tsx", "@/lib/releases"],
    ]
    for (const [file, module] of pages) {
      const src = read(file)
      expect(src).toContain(module)
      expect(src).toContain("export const metadata")
    }
  })

  it("两个新页面都进了 sitemap（新站没有 sitemap 等于对搜索引擎不存在）", () => {
    const sitemap = read("src/app/sitemap.ts")
    expect(sitemap).toContain("${SITE_URL}/features")
    expect(sitemap).toContain("${SITE_URL}/releases")
  })

  it("页脚能走到这两页（否则用户找不到）", () => {
    const footer = read("src/components/layout/Footer.tsx")
    expect(footer).toContain('href: "/features"')
    expect(footer).toContain('href: "/releases"')
  })

  it("落地页与价格页补上了页面级 metadata", () => {
    expect(read("src/app/(public)/page.tsx")).toContain("export const metadata")
    expect(read("src/app/(public)/pricing/page.tsx")).toContain("export const metadata")
  })
})
