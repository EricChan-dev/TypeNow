import { describe, it, expect } from "vitest"
import { parsePagination, toPositiveInt, MAX_PAGE_SIZE } from "@/lib/pagination"

/**
 * 这些用例对应的是真实会打崩列表接口的入参，机制已在 MySQL 8 上实测：
 *   - 非数字 → NaN → 服务端 NULL → `LIMIT NULL` 等于不加限制（返回全表）
 *   - 0 / 负数 → 负 OFFSET → SQL 语法错误 → 500
 *   - 小数 → 小数 LIMIT → SQL 语法错误 → 500
 */

describe("toPositiveInt", () => {
  it("合法值原样返回", () => {
    expect(toPositiveInt("5", 1, 100)).toBe(5)
    expect(toPositiveInt("100", 1, 100)).toBe(100)
  })

  it("空值 / null / undefined 回落到 fallback", () => {
    expect(toPositiveInt(null, 20, 100)).toBe(20)
    expect(toPositiveInt(undefined, 20, 100)).toBe(20)
    expect(toPositiveInt("", 20, 100)).toBe(20)
  })

  it("非数字回落到 fallback（此前 NaN 会变成 NULL，等于不加 LIMIT、返回全表）", () => {
    expect(toPositiveInt("abc", 20, 100)).toBe(20)
    expect(toPositiveInt("12px", 20, 100)).toBe(20)
    expect(toPositiveInt("NaN", 20, 100)).toBe(20)
  })

  it("0 与负数回落到 fallback（此前负 offset 会直接 SQL 语法错误）", () => {
    expect(toPositiveInt("0", 1, 100)).toBe(1)
    expect(toPositiveInt("-20", 1, 100)).toBe(1)
    expect(toPositiveInt("-0.5", 1, 100)).toBe(1)
  })

  it("小数向下取整（此前小数 LIMIT 会直接 SQL 语法错误）", () => {
    expect(toPositiveInt("2.9", 1, 100)).toBe(2)
  })

  it("超过上限时被夹住（此前 pageSize 无上限，能一次拉走全表）", () => {
    expect(toPositiveInt("999999", 20, 100)).toBe(100)
    expect(toPositiveInt("1e9", 20, 100)).toBe(100)
  })

  it("Infinity 回落到 fallback 而不是夹到上限", () => {
    expect(toPositiveInt("Infinity", 20, 100)).toBe(20)
  })
})

describe("parsePagination", () => {
  it("缺省值：第 1 页、20 条、offset 0", () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ page: 1, pageSize: 20, offset: 0 })
  })

  it("可以指定默认每页条数（lessons/analytics 用的是 50）", () => {
    expect(parsePagination(new URLSearchParams(), 50).pageSize).toBe(50)
  })

  it("offset 按页大小正确累加", () => {
    expect(parsePagination(new URLSearchParams("current=3&pageSize=50")).offset).toBe(100)
  })

  it("pageSize=0 时 offset 不会变成 NaN", () => {
    const { pageSize, offset } = parsePagination(new URLSearchParams("current=2&pageSize=0"))
    expect(pageSize).toBe(20)
    expect(offset).toBe(20)
  })

  it("pageSize 上限生效", () => {
    expect(parsePagination(new URLSearchParams("pageSize=100000")).pageSize).toBe(MAX_PAGE_SIZE)
  })

  it("非法 current 回落到第 1 页，offset 不为负", () => {
    const { page, offset } = parsePagination(new URLSearchParams("current=abc"))
    expect(page).toBe(1)
    expect(offset).toBe(0)
  })

  it("同时识别前台接口用的 page / size 参数名", () => {
    expect(parsePagination(new URLSearchParams("page=2&size=30"))).toEqual({
      page: 2,
      pageSize: 30,
      offset: 30,
    })
  })

  it("两种页码参数同时出现时 current 优先", () => {
    expect(parsePagination(new URLSearchParams("current=3&page=9")).page).toBe(3)
  })

  it("非法 page 也回落到第 1 页（此前 Math.max(1, parseInt(abc)) 仍是 NaN）", () => {
    const { page, pageSize, offset } = parsePagination(new URLSearchParams("page=abc&size=abc"), 50)
    expect(page).toBe(1)
    expect(pageSize).toBe(50)
    expect(offset).toBe(0)
  })
})
