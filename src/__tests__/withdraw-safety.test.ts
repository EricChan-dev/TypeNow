/**
 * 提现失败处置的判定（src/lib/withdraw-safety.ts）。
 *
 * 这一处守的是**不可逆的资金损失**：转账超时（结果未知）时如果回滚佣金，
 * 佣金会重新变成"可提现"，用户一次重试就是重复打款 —— 而钱已经打出去了。
 *
 * 所以测试的重点不是"分类准不准"，而是**默认值必须是安全的那一侧**：
 * 任何未识别的异常都要落到 uncertain，绝不能落到 safe_to_rollback。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { WechatPayError } from "@/lib/wechat-pay"
import { classifyTransferFailure } from "@/lib/withdraw-safety"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("classifyTransferFailure", () => {
  it("请求没发出去（配置/签名头构建失败）→ 可以安全回滚", () => {
    expect(classifyTransferFailure(new WechatPayError("未配置", "not_sent"))).toBe(
      "safe_to_rollback",
    )
  })

  it("微信明确拒绝（4xx）→ 可以安全回滚", () => {
    const err = new WechatPayError("WeChat Pay error 400: PARAM_ERROR", "rejected", 400)
    expect(classifyTransferFailure(err)).toBe("safe_to_rollback")
  })

  it("结果未知（超时 / 5xx / 429 / 验签失败 / 响应读不出）→ 绝不回滚", () => {
    for (const message of [
      "微信支付请求未获得响应：fetch failed",
      "WeChat Pay error 500: internal",
      "WeChat Pay error 429: rate limited",
      "微信支付应答验签失败：serial 不匹配",
      "读取微信支付应答失败：terminated",
      "微信支付应答不是合法 JSON：Unexpected token",
    ]) {
      expect(classifyTransferFailure(new WechatPayError(message, "uncertain"))).toBe("uncertain")
    }
  })

  it("默认值是安全的那一侧：任何未识别的异常都算结果未知", () => {
    // 这一条是整份测试里最重要的：宁可让一笔钱停在"待人工核对"，
    // 也不能因为"我们没认出这个错误"就把它变回可提现。
    for (const err of [
      new Error("普通错误"),
      new TypeError("fetch failed"),
      "字符串异常",
      null,
      undefined,
      { code: "ECONNRESET" },
    ]) {
      expect(classifyTransferFailure(err)).toBe("uncertain")
    }
  })
})

describe("提现路由的接线（只写判定不接线等于没做）", () => {
  const src = stripComments(read("src/app/api/partner/withdraw/route.ts"))

  it("用了 classifyTransferFailure", () => {
    expect(src).toContain("classifyTransferFailure(e)")
  })

  it("「结果未知」分支排在回滚之前，且直接 return（不会走到回滚）", () => {
    const uncertainIdx = src.indexOf('=== "uncertain"')
    // 注意：不能拿 `set({ status: "available" })` 定位回滚 —— Step 0（把到期冷却
    // 的佣金解冻）里也有一处同样的写法，indexOf 会命中更早的那一个。
    // 用回滚独有的 inArray(..., claimedIds) 才是唯一标识。
    const rollbackIdx = src.indexOf("inArray(partnerCommissions.id, claimedIds)")
    expect(uncertainIdx).toBeGreaterThan(-1)
    expect(rollbackIdx).toBeGreaterThan(-1)
    // 判定分支必须在前
    expect(uncertainIdx).toBeLessThan(rollbackIdx)

    // 且该分支内先 return，回滚代码在它之后
    const uncertainBlock = src.slice(uncertainIdx, rollbackIdx)
    expect(uncertainBlock).toContain("return NextResponse.json")
    expect(uncertainBlock).toContain("UNCERTAIN_WITHDRAW_MESSAGE")
    // 记成 processing 而不是 failed —— 我们确实还不知道结果
    expect(uncertainBlock).toContain('status: "processing"')
    expect(uncertainBlock).not.toContain('status: "failed"')
  })

  it("前置守卫用 not_sent 标记（而不是裸 Error，否则会被当成结果未知）", () => {
    expect(src).toContain('new WechatPayError("微信支付未配置，请联系管理员", "not_sent")')
  })
})
