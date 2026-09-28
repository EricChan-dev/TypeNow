/**
 * visitor id 的纯逻辑单测。
 *
 * 这个模块的作用只有一个：把匿名事件串成"人"。判定一旦放松，报表上的
 * 独立访客数就会被人为灌大 —— 而且**不会有任何报错**，只是数字变得不可信。
 */
import { describe, it, expect } from "vitest"
import {
  VISITOR_COOKIE,
  VISITOR_MAX_AGE_DAYS,
  VISITOR_ID_MAX_LENGTH,
  newVisitorId,
  isVisitorId,
  parseVisitorId,
} from "@/lib/visitor"

describe("visitor id 常量", () => {
  it("cookie 名带 typ_ 前缀", () => {
    expect(VISITOR_COOKIE).toBe("typ_vid")
  })

  it("有效期比归因窗口长（visitor 是长期身份，不是归因窗口）", () => {
    expect(VISITOR_MAX_AGE_DAYS).toBe(365)
    expect(VISITOR_MAX_AGE_DAYS).toBeGreaterThan(90)
  })

  it("UUID 长度不超过列宽，否则 INSERT 会被 MySQL 截断/报错", () => {
    expect(36).toBeLessThanOrEqual(VISITOR_ID_MAX_LENGTH)
  })
})

describe("newVisitorId", () => {
  it("生成的就是合规的 visitor id", () => {
    expect(isVisitorId(newVisitorId())).toBe(true)
  })

  it("每次生成都不同", () => {
    expect(newVisitorId()).not.toBe(newVisitorId())
  })
})

describe("isVisitorId", () => {
  it("接受 crypto.randomUUID 的输出", () => {
    expect(isVisitorId("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true)
    expect(isVisitorId("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true)
  })

  it("拒绝非字符串", () => {
    for (const v of [null, undefined, 42, {}, [], true]) {
      expect(isVisitorId(v)).toBe(false)
    }
  })

  it("拒绝长度不对的字符串", () => {
    expect(isVisitorId("3f2504e0-4f89-41d3-9a0c-0305e82c330")).toBe(false)
    expect(isVisitorId("3f2504e0-4f89-41d3-9a0c-0305e82c33011")).toBe(false)
    expect(isVisitorId("")).toBe(false)
  })

  it("拒绝非 UUID 形状的输入（防止随手往 visitor_id 里灌垃圾）", () => {
    expect(isVisitorId("hello")).toBe(false)
    expect(isVisitorId("1")).toBe(false)
    // 少一位、位置不对的分隔符、非 hex 字符
    expect(isVisitorId("3f2504e04f8941d39a0c0305e82c3301")).toBe(false)
    expect(isVisitorId("3f2504e0_4f89_41d3_9a0c_0305e82c3301")).toBe(false)
    expect(isVisitorId("zzzzzzzz-4f89-41d3-9a0c-0305e82c3301")).toBe(false)
  })

  it("拒绝超长字符串（不靠 slice 兜底，直接判不合格）", () => {
    expect(isVisitorId("a".repeat(500))).toBe(false)
  })
})

describe("parseVisitorId", () => {
  it("合规值原样返回", () => {
    const id = newVisitorId()
    expect(parseVisitorId(id)).toBe(id)
  })

  it("缺失或非法一律返回 null，让调用方决定重新生成还是不带", () => {
    expect(parseVisitorId(undefined)).toBeNull()
    expect(parseVisitorId(null)).toBeNull()
    expect(parseVisitorId("")).toBeNull()
    expect(parseVisitorId("garbage")).toBeNull()
  })

  it("带 % 转义痕迹的值不被接受（handler 不做 decode，避免多一条抛错路径）", () => {
    expect(parseVisitorId("%zz")).toBeNull()
    expect(parseVisitorId("3f2504e0-4f89-41d3-9a0c-0305e82c3301%20")).toBeNull()
  })
})
