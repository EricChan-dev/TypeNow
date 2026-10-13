import { describe, expect, it } from "vitest"
import {
  escapeLikeLike,
  likeMatch,
  parseMistakeSource,
} from "@/lib/mistake-book"

describe("parseMistakeSource", () => {
  it("认得三个合法来源", () => {
    expect(parseMistakeSource("mistake")).toBe("mistake")
    expect(parseMistakeSource("sentence")).toBe("sentence")
    expect(parseMistakeSource("word")).toBe("word")
  })

  it("非法值一律回落 all（与参考站 sourceType 缺省行为一致）", () => {
    expect(parseMistakeSource(null)).toBe("all")
    expect(parseMistakeSource(undefined)).toBe("all")
    expect(parseMistakeSource("")).toBe("all")
    expect(parseMistakeSource("MISTAKE")).toBe("all")
    expect(parseMistakeSource("favorite")).toBe("all")
  })
})

describe("escapeLikeLike", () => {
  it("转义 LIKE 的三个特殊字符", () => {
    expect(escapeLikeLike("100%")).toBe("100\\%")
    expect(escapeLikeLike("a_b")).toBe("a\\_b")
    expect(escapeLikeLike("a\\b")).toBe("a\\\\b")
  })

  it("普通字符原样保留", () => {
    expect(escapeLikeLike("don't stop")).toBe("don't stop")
    expect(escapeLikeLike("中文*?( )")).toBe("中文*?( )")
  })
})

describe("likeMatch", () => {
  it("包成 %词% 模式并转义内部通配符", () => {
    expect(likeMatch("abc")).toBe("%abc%")
    expect(likeMatch("a%")).toBe("%a\\%%")
  })

  it("空串返回纯通配模式（调用方应在上游把空串归一为 null）", () => {
    expect(likeMatch("")).toBe("%%")
  })
})
