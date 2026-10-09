import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * 人机校验（阿里云验证码 2.0）的**接线约束**。
 *
 * 单元测试覆盖不到两个 UI 入口：Vitest 是 node 环境、没有 jsdom，React 组件跑不起来，
 * 浏览器验证又要真起服务。所以这里退一步，用源码文本断言锁住**最容易在后续改动中
 * 被悄悄破坏的接线点** —— 这些点一旦断了，类型检查仍然通过，但人机会静默失效：
 *
 *   · 两个入口都必须把 `captchaVerifyParam` 传给 `/api/auth/send-sms`；
 *   · 校验就绪后按钮 onClick 必须直接返回（否则 SDK 接管点击的同时我们也发请求，
 *     会发出没有验证参数的短信，被服务端拒成"人机验证无效"）；
 *   · 服务端缺参必须拦（fail-closed），异常必须放行（fail-open）——两者写反都致命。
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
const ROUTE = "src/app/api/auth/send-sms/route.ts"
const HOOK = "src/lib/hooks/useAliyunCaptcha.ts"

describe("两个发短信入口都接了人机校验", () => {
  for (const [name, file, buttonId, elementId] of [
    ["登录页", LOGIN, "login-send-code", "login-captcha-element"],
    ["设置页", SETTINGS, "settings-send-code", "settings-captcha-element"],
  ] as const) {
    it(`${name}：调用 useAliyunCaptcha 并声明按钮/挂载点 id`, () => {
      const src = stripComments(read(file))
      expect(src).toContain("useAliyunCaptcha(")
      // id 必须同时出现在 hook 配置与 JSX 元素上，否则 SDK 找不到目标
      expect(src).toContain(`buttonId: "${buttonId}"`)
      expect(src).toContain(`elementId: "${elementId}"`)
      expect(src).toContain(`id="${buttonId}"`)
      expect(src).toContain(`id="${elementId}"`)
    })

    it(`${name}：把 captchaVerifyParam 传给 /api/auth/send-sms`, () => {
      const src = stripComments(read(file))
      expect(src).toContain("captchaVerifyParam")
      // 必须带上请求体字段名，不能只是本地变量
      expect(src).toContain("captchaVerifyParam }")
    })

    it(`${name}：校验就绪时 onClick 直接返回（不重复发送）`, () => {
      const src = stripComments(read(file))
      // 只在 ready 时 return —— SDK 已接管点击。failed 时给提示、disabled 兜底。
      expect(src).toMatch(/captcha\.status === "ready"\)\s*return/)
      expect(src).toMatch(/captcha\.status === "failed"/)
    })

    it(`${name}：加载中 / 失败时按钮禁用（避免点了个没反应的死按钮）`, () => {
      const src = stripComments(read(file))
      expect(src).toContain('captcha.status === "loading"')
      expect(src).toContain('captcha.status === "failed"')
    })
  }
})

describe("服务端闸门", () => {
  const src = stripComments(read(ROUTE))

  it("接收 captchaVerifyParam 并调用 verifyCaptcha", () => {
    expect(src).toContain("captchaVerifyParam")
    expect(src).toContain("verifyCaptcha(")
  })

  it("缺参是 fail-closed：拦，且不调用校验实现", () => {
    // 与官方 FAQ Q17 相关：脚本初始化失败时回调参数为空，
    // 若这里放行，屏蔽 o.alicdn.com 即可完全绕过人机校验。
    expect(src).toMatch(/if \(!captchaVerifyParam\.trim\(\)\)\s*\{[\s\S]*?status: 400/)
    expect(src).toContain("captchaFailed: true")
  })

  it("校验 fail → 400，且带 captchaFailed 标记", () => {
    expect(src).toMatch(/verdict\.result === "fail"[\s\S]*?status: 400/)
  })

  it("unavailable 不拦截（fail-open，官方口径：不应成为可用性单点）", () => {
    // 代码里不能出现把 unavailable 也拦掉的分支
    expect(src).not.toMatch(/verdict\.result === "unavailable"[\s\S]{0,200}?status: 400/)
  })

  it("未配置时整段跳过（本地开发不受影响）", () => {
    expect(src).toContain("isCaptchaConfigured()")
  })
})

describe("客户端 hook 的关键约束", () => {
  const src = stripComments(read(HOOK))

  it("从官方 CDN 动态加载（禁止本地自托管）", () => {
    expect(src).toContain(
      "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
    )
    expect(src).toContain("createElement(\"script\")")
  })

  it("全局配置在主 JS 之前设好，且区域为 cn", () => {
    expect(src).toContain("window.AliyunCaptchaConfig = { region: CAPTCHA_REGION, prefix: PREFIX }")
    expect(src).toMatch(/CAPTCHA_REGION = "cn"/)
  })

  it("按 buttonId 去重，避免 initAliyunCaptcha 被重复调用", () => {
    expect(src).toContain("initializedButtons")
  })

  it("卸载时清理 SDK 插入的遮罩与浮层", () => {
    expect(src).toContain('"aliyunCaptcha-mask"')
    expect(src).toContain('"aliyunCaptcha-window-popup"')
  })

  it("回调必须返回 Promise，且空参数返回 captchaResult:false（不放过）", () => {
    // 官方 FAQ Q8：只在 .then 里返回会让流程卡住
    expect(src).toContain("return Promise.resolve({ captchaResult: false })")
    expect(src).toContain("return verifyRef.current(captchaVerifyParam)")
  })

  it("popup 模式 + 官方语言取值 cn", () => {
    expect(src).toContain('mode: "popup"')
    expect(src).toMatch(/language: "cn"/)
  })

  it("不 import 服务端校验库（否则 Node SDK 会被打进浏览器产物）", () => {
    expect(src).not.toContain("@/lib/aliyun-captcha")
    expect(src).not.toContain("@alicloud/")
  })
})

describe("环境变量是 NEXT_PUBLIC_（构建期字面替换，客户端才拿得到）", () => {
  const src = stripComments(read(HOOK))
  it("场景 ID 与身份标都用 NEXT_PUBLIC_ 前缀", () => {
    expect(src).toContain("process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID")
    expect(src).toContain("process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX")
  })
})
