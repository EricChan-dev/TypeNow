/**
 * sitemap / robots 的一致性单测。
 *
 * 这两个文件是一对：sitemap 声明「哪些页值得收录」，robots 声明「哪些页禁止抓取」。
 * 两边一旦不一致，后果是**静默的** —— 没有任何报错，只是搜索结果里冒出重复的登录页，
 * 或者公开页提交了却被 robots 拦掉。
 *
 * 实测本站百度与必应的权重、关键词数、收录量长期为 0，这两个文件是当前唯一的收录抓手，
 * 所以把范围与一致性钉住。
 */
import { describe, it, expect } from "vitest"
import sitemap from "@/app/sitemap"
import robots from "@/app/robots"

const ORIGIN = "https://typenow.cn"

/**
 * robots 规则里的 allow / disallow 既允许写成单个字符串，也允许写成数组
 * （Next 的 MetadataRoute.Robots 类型就是 `string | string[]`），这里统一成数组。
 *
 * 这不是"为了让 tsc 闭嘴"而做的转换：`longestPrefix` 用的是 `filter` / `reduce`，
 * 而字符串恰好也有 `startsWith`，很容易让人以为直接喂进去没事 —— 实际上
 * `.filter` 在字符串上不存在，真有人把 disallow 写成 `"/api"` 就会抛 TypeError，
 * 而且只在跑测试时炸。所以这层归一化是必须的，不是多余的。
 */
export function asRuleList(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** robots().rules 允许是单个对象或数组，统一成数组后取通配规则的 allow / disallow。 */
function wildcardLists(): { allow: string[]; disallow: string[] } {
  const { rules } = robots()
  const list = Array.isArray(rules) ? rules : [rules]
  const rule = list.find((r) => r.userAgent === "*")
  if (!rule) throw new Error('robots 里缺少 userAgent: "*" 的通配规则')
  return { allow: asRuleList(rule.allow), disallow: asRuleList(rule.disallow) }
}

/**
 * 按 robots 规范判断某个路径是否被允许：最长匹配优先，同长度时 Allow 胜出。
 * 这里不能用「只要命中任一条 allow 就算通过」——`Allow: /` 会命中一切，
 * 那样写出来的断言永远为真，等于没测。
 */
function isAllowed(path: string, allow: string[], disallow: string[]): boolean {
  const longestPrefix = (rules: string[]) =>
    rules.filter((r) => path.startsWith(r)).reduce((max, r) => Math.max(max, r.length), -1)
  const a = longestPrefix(allow)
  const d = longestPrefix(disallow)
  return d < 0 || a >= d
}

/** 把 sitemap 的绝对 URL 还原成站点内路径，便于与 robots 的规则逐条对比。 */
function sitemapPaths(): string[] {
  return sitemap().map((entry) => entry.url.slice(ORIGIN.length) || "/")
}

/**
 * 规则归一化本身的用例。
 *
 * 单字符串写法是类型允许的（`string | string[]`），所以代码必须支持 ——
 * 这里钉住的就是"哪天有人把 robots 里的 disallow 写成单个字符串"这种情形，
 * 否则会在 `longestPrefix` 的 `.filter` 上抛 TypeError。
 */
describe("asRuleList（robots 规则的字符串/数组归一化）", () => {
  it("单个字符串包成单元素数组", () => {
    expect(asRuleList("/api")).toEqual(["/api"])
    expect(asRuleList("")).toEqual([""])
  })

  it("数组原样返回", () => {
    const arr = ["/admin", "/api"]
    expect(asRuleList(arr)).toBe(arr)
  })

  it("undefined 变成空数组（而不是含 undefined 的数组）", () => {
    expect(asRuleList(undefined)).toEqual([])
  })

  it("归一化后的结果能直接喂给前缀匹配（这正是修掉的那个崩溃点）", () => {
    // 用单字符串规则构造，走一遍真实的判定路径
    expect(isAllowed("/api/analytics/track", ["/"], asRuleList("/api"))).toBe(false)
    expect(isAllowed("/pricing", ["/"], asRuleList("/api"))).toBe(true)
  })
})

describe("sitemap", () => {
  it("只输出生产域名的绝对 URL，不泄漏 localhost 或相对路径", () => {
    for (const entry of sitemap()) {
      expect(entry.url).toMatch(/^https:\/\/typenow\.cn(\/|$)/)
    }
  })

  it("没有重复条目", () => {
    const urls = sitemap().map((e) => e.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it("落地页存在且为最高优先级", () => {
    const home = sitemap().find((e) => e.url === `${ORIGIN}/`)
    expect(home).toBeDefined()
    expect(home!.priority).toBe(1)
  })

  it("不收录需要登录的私有区、后台与接口", () => {
    const paths = sitemapPaths()
    for (const forbidden of [
      "/home",
      "/practice",
      "/profile",
      "/strengthen",
      "/share",
      "/admin",
      "/admin-app",
      "/api",
      "/login",
    ]) {
      expect(paths, `${forbidden} 不应出现在 sitemap 中`).not.toContain(forbidden)
    }
  })

  it("不收录每个用户各自的推广链接 /ref/<code>", () => {
    for (const path of sitemapPaths()) {
      expect(path.startsWith("/ref")).toBe(false)
    }
  })
})

describe("sitemap 与 robots 的一致性", () => {
  it("sitemap 里的每条路径都不会被 robots 的 disallow 命中", () => {
    const { allow, disallow } = wildcardLists()
    for (const path of sitemapPaths()) {
      expect(isAllowed(path, allow, disallow), `${path} 被 robots 拦住了`).toBe(true)
    }
  })

  it("robots 声明的 sitemap 地址与实际输出的路径一致", () => {
    expect(robots().sitemap).toBe(`${ORIGIN}/sitemap.xml`)
  })

  it("为了对比有效，disallow 规则本身应能真正拦住私有路径", () => {
    // 这是上一条断言的反向校验：如果 isAllowed 的实现被写坏（永远返回 true），
    // 上面那条会假通过。这里用已知被禁的路径确认判定逻辑是活的。
    const { allow, disallow } = wildcardLists()
    expect(isAllowed("/home/courses", allow, disallow)).toBe(false)
    expect(isAllowed("/api/analytics/track", allow, disallow)).toBe(false)
    expect(isAllowed("/ref/ABC123", allow, disallow)).toBe(false)
  })
})
