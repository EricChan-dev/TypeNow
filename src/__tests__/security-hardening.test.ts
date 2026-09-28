/**
 * 低成本安全加固项的回归约束。
 *
 * 这三项单独看都不算"漏洞"，但都属于"修起来只要几行、不修就一直留在那里"：
 *
 *   1. 邀请码用 `Math.random()` —— 它是**归因凭据**，拿到某个码就拿到它带来的佣金。
 *   2. `oa-qrcode` 把内部 `err.message` 直接回给客户端 —— 微信接口的错误里可能
 *      带着 appid、token 片段或内部 URL。
 *   3. 日志把 openid 与 OAuth `code` 写进磁盘（那一项的接线断言在
 *      log-redact.test.ts 里，这里只补"函数存在且被用对"之外的部分）。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { generateInviteCode } from "@/lib/subscription"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("邀请码生成", () => {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 去掉了易混的 I/O/0/1

  it("格式固定：8 位，且只含约定的字符集", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode()
      expect(code).toHaveLength(8)
      for (const ch of code) expect(ALPHABET).toContain(ch)
    }
  })

  it("不重复（40 bit 空间下 2000 次不该撞）", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(generateInviteCode())
    expect(seen.size).toBe(2000)
  })

  it("字符集里每个字符都可能出现（没有写死某几位）", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) for (const ch of generateInviteCode()) seen.add(ch)
    expect(seen.size).toBe(ALPHABET.length)
  })

  it("源码里用 crypto.randomInt，不再用 Math.random", () => {
    const src = stripComments(read("src/lib/subscription.ts"))
    expect(src).toContain("randomInt(chars.length)")
    expect(src).not.toContain("Math.random()")
  })
})

describe("oa-qrcode 不回传内部错误信息", () => {
  const src = stripComments(read("src/app/api/auth/wechat/oa-qrcode/route.ts"))

  it("异常分支给通用文案，且把原始错误只写进日志", () => {
    expect(src).toContain("获取二维码失败，请稍后重试")
    expect(src).toContain("console.error")
    // 不能再把 err.message 直接塞进响应
    expect(src).not.toContain("error: message")
    expect(src).not.toContain("err.message")
  })
})
