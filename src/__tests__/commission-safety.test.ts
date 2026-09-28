/**
 * 佣金写入失败的处置（src/lib/commission-safety.ts）。
 *
 * 这一处守的是**合作方的钱**：佣金原来是 fire-and-forget，进程在写入前抖动
 * （重启、DB 短暂不可用）这一笔就永久消失 —— 没有重试，也没有定时任务补偿。
 *
 * 改法是把决定权交回调用方：只有"已经发过"（撞唯一键）才静默返回，
 * 其余一律抛出去，让微信的支付回调重试，并由 activateSubscription 的幂等分支
 * 补写。所以这里的核心不变量是：**默认必须倾向于抛出（fatal），而不是静默。**
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { CommissionWriteError, classifyCommissionWriteError } from "@/lib/commission-safety"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("classifyCommissionWriteError", () => {
  it("撞唯一键 = 已发过（正常的幂等结果，静默返回）", () => {
    expect(classifyCommissionWriteError({ code: "ER_DUP_ENTRY" })).toBe("already_awarded")
    expect(classifyCommissionWriteError({ errno: 1062 })).toBe("already_awarded")
    // drizzle 会把驱动错误包一层，原始错误挂在 cause 上
    expect(classifyCommissionWriteError({ cause: { code: "ER_DUP_ENTRY" } })).toBe(
      "already_awarded",
    )
  })

  it("其余一切都是故障（必须抛出，让上游重试）", () => {
    // 这是整份测试里最重要的一条：宁可多抛一次让微信重试，
    // 也不能因为"没认出这个错误"就把合作方的钱静默吞掉。
    for (const err of [
      { code: "ECONNREFUSED" },
      { code: "ETIMEDOUT" },
      { errno: 1213 }, // deadlock
      new Error("boom"),
      new TypeError("fetch failed"),
      "字符串异常",
      null,
      undefined,
    ]) {
      expect(classifyCommissionWriteError(err)).toBe("fatal")
    }
  })
})

describe("CommissionWriteError", () => {
  it("带上 orderId 便于人工追溯，且是 Error 的子类（不会被 instanceof 判断漏掉）", () => {
    const err = new CommissionWriteError("order-123", new Error("cause"))
    expect(err).toBeInstanceOf(Error)
    expect(err.orderId).toBe("order-123")
    expect(err.message).toContain("order-123")
  })
})

describe("订阅激活路径的接线（只写判定不接线等于没做）", () => {
  const src = stripComments(read("src/lib/subscription.ts"))

  it("佣金写入不再是 fire-and-forget", () => {
    // 旧的写法：void triggerCommission(...).catch(console.error)
    expect(src).not.toMatch(/void\s+triggerCommission/)
    // 主路径必须 await
    expect(src).toContain("await triggerCommission(userId, paymentOrderId, orderAmount)")
  })

  it("幂等分支（重复回调）也会补一次佣金 —— 这是自愈的关键", () => {
    const dupIdx = src.indexOf("Duplicate activation skipped")
    expect(dupIdx).toBeGreaterThan(-1)
    // 补写必须发生在"跳过"日志之前的那段幂等逻辑里
    const before = src.slice(Math.max(0, dupIdx - 700), dupIdx)
    expect(before).toContain("await triggerCommission(userId, paymentOrderId, orderAmount)")
  })

  it("写入失败时抛 CommissionWriteError，且先判唯一键", () => {
    const insertIdx = src.indexOf("classifyCommissionWriteError(err)")
    const throwIdx = src.indexOf("throw new CommissionWriteError")
    expect(insertIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(insertIdx)
  })

  it("追溯扫描保留「失败不阻断」，但会打出可检索的 CRITICAL 痕迹", () => {
    expect(src).toContain("追溯佣金写入失败，需人工补记")
  })
})
