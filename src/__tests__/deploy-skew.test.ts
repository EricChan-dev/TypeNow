import { describe, it, expect } from "vitest"
import {
  describeError,
  isChunkLoadFailure,
  isStaleServerAction,
} from "@/lib/deploy-skew"

/**
 * 这些字符串全部取自生产 typenow-error.log 的真实报错，不是编造的样例：
 *   - "Failed to load chunk server/chunks/ssr/..."  /  "ChunkLoadError"
 *   - "Failed to find Server Action \"6yw\". This request might be from an
 *      older or newer deployment."
 * 识别逻辑一旦漏判，用户看到的就是「点了没反应」且没有任何提示。
 */

describe("isChunkLoadFailure", () => {
  it("识别生产日志里的原始形态", () => {
    expect(
      isChunkLoadFailure(
        "Error [ChunkLoadError]: Failed to load chunk server/chunks/ssr/[root-of-the-server]__11_l6cc._.js from module 183277",
      ),
    ).toBe(true)
  })

  it("识别 Promise 包装后的形态（unhandledRejection 里 name 与 message 是分开的）", () => {
    expect(
      isChunkLoadFailure(describeError(Object.assign(new Error("boom"), { name: "ChunkLoadError" }))),
    ).toBe(true)
  })

  it("识别 webpack 的 Loading chunk 文案", () => {
    expect(isChunkLoadFailure("Loading chunk 7823 failed.")).toBe(true)
  })

  it("不误伤普通错误", () => {
    expect(isChunkLoadFailure("TypeError: Cannot read properties of undefined")).toBe(false)
    expect(isChunkLoadFailure("")).toBe(false)
  })
})

describe("isStaleServerAction", () => {
  it("识别生产日志里的原始形态", () => {
    expect(
      isStaleServerAction(
        'Error: Failed to find Server Action "6yw". This request might be from an older or newer deployment.',
      ),
    ).toBe(true)
  })

  it("只凭 Next.js 的提示文案也能识别", () => {
    expect(isStaleServerAction("This request might be from an older or newer deployment")).toBe(true)
  })

  it("不误伤普通错误", () => {
    expect(isStaleServerAction("Error: Failed to fetch")).toBe(false)
    expect(isStaleServerAction("")).toBe(false)
  })
})

describe("describeError", () => {
  it("拼接 name 与 message，使两种错误都能被后续匹配到", () => {
    expect(describeError({ name: "ChunkLoadError", message: "Failed to load chunk x" })).toBe(
      "ChunkLoadError Failed to load chunk x",
    )
  })

  it("字符串、Error、null 都能安全处理", () => {
    expect(describeError("plain string")).toBe("plain string")
    expect(describeError(new Error("real error"))).toBe("Error real error")
    expect(describeError(null)).toBe("")
    expect(describeError(undefined)).toBe("")
  })

  it("getter 抛异常时返回空串，绝不能把事件监听器带崩", () => {
    const hostile = {
      get name() {
        throw new Error("nope")
      },
      get message() {
        throw new Error("nope")
      },
    }
    expect(describeError(hostile)).toBe("")
  })
})
