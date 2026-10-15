import { describe, expect, it } from "vitest"
import { fnv1a, mulberry32, practiceOrderSeed, shuffledBySeed } from "@/lib/shuffle"

describe("fnv1a / mulberry32", () => {
  it("fnv1a 是确定性的，且对输入敏感", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"))
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"))
    // 32 位无符号范围
    expect(fnv1a("typenow")).toBeGreaterThanOrEqual(0)
    expect(fnv1a("typenow")).toBeLessThan(2 ** 32)
  })

  it("mulberry32 同种子序列一致，且落在 [0,1)", () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe("practiceOrderSeed", () => {
  it("同一 (user, lesson) 种子稳定；user/lesson 任一不同则不同", () => {
    const s = practiceOrderSeed("u1", "l1")
    expect(s).toBe(practiceOrderSeed("u1", "l1"))
    expect(s).not.toBe(practiceOrderSeed("u2", "l1"))
    expect(s).not.toBe(practiceOrderSeed("u1", "l2"))
  })

  it("NUL 分隔：(ab,c) 与 (a,bc) 不撞种子", () => {
    expect(practiceOrderSeed("ab", "c")).not.toBe(practiceOrderSeed("a", "bc"))
  })
})

describe("shuffledBySeed", () => {
  const seq = (n: number) => Array.from({ length: n }, (_, i) => i)

  it("确定性：同种子同顺序，不同种子（几乎必然）不同顺序", () => {
    const items = seq(64)
    const a = shuffledBySeed(items, 7)
    const b = shuffledBySeed(items, 7)
    expect(a).toEqual(b)
    // 64 个元素两种洗牌全同序的概率约 1/64!，实践中 0；固定种子对撞了再换常数即可
    expect(shuffledBySeed(items, 8)).not.toEqual(a)
  })

  it("是重排不是映射：元素多重集合不变，且一般不再是原顺序", () => {
    const items = seq(128)
    const out = shuffledBySeed(items, 12345)
    expect([...out].sort((x, y) => x - y)).toEqual(items)
    expect(out).not.toEqual(items)
  })

  it("不修改入参（纯函数）", () => {
    const items = seq(32)
    const copy = items.slice()
    shuffledBySeed(items, 99)
    expect(items).toEqual(copy)
  })

  it("边界：空数组与单元素数组安全返回", () => {
    expect(shuffledBySeed([], 1)).toEqual([])
    expect(shuffledBySeed([42], 1)).toEqual([42])
  })

  it("恢复下标场景：种子不变时，第 k 位永远是同一句", () => {
    const items = seq(50).map((i) => `sentence-${i}`)
    const first = shuffledBySeed(items, practiceOrderSeed("u1", "l1"))
    const second = shuffledBySeed(items, practiceOrderSeed("u1", "l1"))
    expect(second[7]).toBe(first[7])
    expect(second[7]).toBe(`sentence-${items.indexOf(first[7])}`)
  })
})
