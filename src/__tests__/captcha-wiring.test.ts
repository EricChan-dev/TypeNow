import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * 人机校验（自建滑块拼图）的**接线约束**。
 *
 * 单元测试覆盖不到 UI 入口：Vitest 是 node 环境、没有 jsdom，React 组件跑不起来，
 * 浏览器验证又要真起服务。所以这里退一步，用源码文本断言锁住**最容易在后续改动中
 * 被悄悄破坏的接线点** —— 这些点一旦断了，类型检查仍然通过，但人机会静默失效：
 *
 *   · 两个入口（登录页、设置页）都必须渲染 SmsSlider（滑块即发送触发器）；
 *   · SmsSlider 必须把 { id, x, duration, trail } 发给 /api/auth/send-sms；
 *   · 服务端必须先原子认领（used 0→1）再判分，且全部失败分支 fail-closed；
 *   · 阿里云旧链路（hook / lib / 旧按钮 id）必须清零，防止半新半旧的双发短信。
 *
 * 这类"文本断言"在本仓库有先例（见 security-hardening.test.ts）。
 */

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const LOGIN = "src/components/auth/LoginForm.tsx"
const SETTINGS = "src/components/home/SettingsClient.tsx"
const SLIDER = "src/components/auth/SmsSlider.tsx"
const SEND_ROUTE = "src/app/api/auth/send-sms/route.ts"
const ISSUE_ROUTE = "src/app/api/auth/captcha/route.ts"

describe("两个发短信入口都接了滑块校验", () => {
  for (const [name, file, sliderId] of [
    ["登录页", LOGIN, "login-sms-slider"],
    ["设置页", SETTINGS, "settings-sms-slider"],
  ] as const) {
    it(`${name}：渲染 SmsSlider 并声明 id 锚点`, () => {
      const src = stripComments(read(file))
      expect(src).toContain("<SmsSlider")
      expect(src).toContain(`id="${sliderId}"`)
    })

    it(`${name}：手机号传给滑块（发信目标由组件内部校验）`, () => {
      const src = stripComments(read(file))
      // 登录页用 phone state，设置页用 phoneValue —— 只要 SmsSlider 的 phone prop 有实参
      expect(src).toMatch(/<SmsSlider\s+phone=\{/)
    })

    it(`${name}：阿里云旧链路清零（hook / 库 / 旧按钮与挂载点 id）`, () => {
      const src = stripComments(read(file))
      expect(src).not.toContain("useAliyunCaptcha")
      expect(src).not.toContain("aliyun-captcha")
      expect(src).not.toContain("captchaVerifyParam")
      for (const legacyId of [
        "login-send-code",
        "login-captcha-element",
        "settings-send-code",
        "settings-captcha-element",
      ]) {
        expect(src).not.toContain(legacyId)
      }
    })
  }
})

describe("SmsSlider 组件的关键接线", () => {
  const src = stripComments(read(SLIDER))

  it("从 /api/auth/captcha 取题，challengeId 随题走", () => {
    expect(src).toContain('"/api/auth/captcha"')
    expect(src).toContain("challengeIdRef")
  })

  it("onVerify 把 {id, x, duration, trail} 发给 /api/auth/send-sms", () => {
    expect(src).toContain("/api/auth/send-sms")
    expect(src).toContain("id: challengeIdRef.current")
    expect(src).toContain("x: data.x")
    expect(src).toContain("duration: data.duration")
    expect(src).toContain("trail:")
  })

  it("服务端 captchaFailed（人机没过）→ 抛错让控件换题重拖", () => {
    expect(src).toMatch(/captchaFailed === true/)
    expect(src).toMatch(/throw new Error\(result\.error/)
  })

  it("60 秒冷却在组件内部管理（冷却期卸载滑块，结束后重挂载自动取新题）", () => {
    expect(src).toMatch(/60/)
  })

  it("深浅两套主题变量（登录页亮底 / 设置页暗底）", () => {
    expect(src).toContain("--rcsc-")
  })
})

describe("服务端闸门（send-sms）", () => {
  const src = stripComments(read(SEND_ROUTE))

  it("先原子认领（UPDATE used 0→1）再读答案判分 —— 顺序不能反", () => {
    const claimAt = src.indexOf(".update(captchaChallenges)")
    const verifyAt = src.indexOf("verifySliderAnswer(")
    expect(claimAt).toBeGreaterThan(-1)
    expect(verifyAt).toBeGreaterThan(claimAt)
  })

  it("认领以 affectedRows 为准（affectedRows===0 → 拒），一题一用防枚举", () => {
    expect(src).toMatch(/affectedRows/)
  })

  it("缺参 / 认领失败 / 判分不过全部 fail-closed，且都带 captchaFailed: true", () => {
    // 缺参分支
    expect(src).toMatch(/人机验证无效[\s\S]{0,80}captchaFailed: true/)
    // 认领失败分支
    expect(src).toMatch(/人机验证已失效[\s\S]{0,80}captchaFailed: true/)
    // 判分不过分支
    expect(src).toMatch(/人机验证未通过[\s\S]{0,80}captchaFailed: true/)
  })

  it("自建方案没有『不可用放行』分支（阿里云 fail-open 已移除）", () => {
    expect(src).not.toContain("unavailable")
  })

  it("阿里云残留清零", () => {
    expect(src).not.toContain("captchaVerifyParam")
    expect(src).not.toContain("isCaptchaConfigured")
    expect(src).not.toContain("@alicloud")
    expect(src).not.toContain("aliyun-captcha")
  })
})

describe("取题路由（issue）", () => {
  const src = stripComments(read(ISSUE_ROUTE))

  it("取题也有限流（IP 维度），且成功响应不含答案 answerX", () => {
    expect(src).toContain("checkRateLimit")
    expect(src).toContain("captchaChallenges")
    // 锁死成功响应的字段清单：答案 answerX 只进库，不出服务端
    expect(src).toMatch(
      /NextResponse\.json\(\{\s*id,\s*background,\s*puzzle,\s*expiresAt/,
    )
  })
})

describe("阿里云实现文件已删除", () => {
  for (const gone of [
    "src/lib/aliyun-captcha.ts",
    "src/lib/hooks/useAliyunCaptcha.ts",
    "src/__tests__/captcha.test.ts",
  ]) {
    it(`${gone} 不应再存在`, () => {
      expect(fs.existsSync(path.join(ROOT, gone))).toBe(false)
    })
  }
})
