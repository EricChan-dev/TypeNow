import { describe, it, expect } from "vitest"
import { sm2 } from "@/lib/spaced-repetition"

describe("sm2 — grade 0-2 (failed)", () => {
  it("grade 0 resets interval to 1 and consecutiveOk to 0", () => {
    const r = sm2(10, 2.5, 3, 0)
    expect(r.intervalDays).toBe(1)
    expect(r.consecutiveOk).toBe(0)
    expect(r.easeFactor).toBe(2.5)
  })

  it("grade 1 resets interval to 1 and consecutiveOk to 0", () => {
    const r = sm2(7, 2.5, 2, 1)
    expect(r.intervalDays).toBe(1)
    expect(r.consecutiveOk).toBe(0)
  })

  it("grade 2 resets interval to 1 and consecutiveOk to 0", () => {
    const r = sm2(5, 2.5, 1, 2)
    expect(r.intervalDays).toBe(1)
    expect(r.consecutiveOk).toBe(0)
  })

  it("grade 0 does not change easeFactor", () => {
    const r = sm2(10, 2.8, 5, 0)
    expect(r.easeFactor).toBe(2.8)
  })
})

describe("sm2 — grade 3 (hard)", () => {
  it("increases interval by 20% (ceiling)", () => {
    const r = sm2(5, 2.5, 2, 3)
    expect(r.intervalDays).toBe(Math.ceil(5 * 1.2)) // 6
  })

  it("decrements consecutiveOk by 1 (minimum 0)", () => {
    const r = sm2(5, 2.5, 2, 3)
    expect(r.consecutiveOk).toBe(1)
  })

  it("never drives consecutiveOk below 0", () => {
    const r = sm2(5, 2.5, 0, 3)
    expect(r.consecutiveOk).toBe(0)
  })

  it("does not change easeFactor", () => {
    const r = sm2(5, 2.5, 2, 3)
    expect(r.easeFactor).toBe(2.5)
  })

  it("grade 3 with intervalDays=1 → interval becomes 2", () => {
    const r = sm2(1, 2.5, 0, 3)
    expect(r.intervalDays).toBe(2)
  })
})

describe("sm2 — grade 4 (good)", () => {
  it("multiplies interval by easeFactor (ceiling)", () => {
    const r = sm2(4, 2.5, 1, 4)
    expect(r.intervalDays).toBe(Math.ceil(4 * 2.5)) // 10
  })

  it("increments consecutiveOk", () => {
    const r = sm2(4, 2.5, 1, 4)
    expect(r.consecutiveOk).toBe(2)
  })

  it("does not change easeFactor", () => {
    const r = sm2(4, 2.5, 1, 4)
    expect(r.easeFactor).toBe(2.5)
  })
})

describe("sm2 — grade 5 (perfect)", () => {
  it("multiplies interval by easeFactor * 1.15 (ceiling, capped at 30)", () => {
    const r = sm2(4, 2.5, 1, 5)
    expect(r.intervalDays).toBe(Math.ceil(4 * 2.5 * 1.15)) // 12
  })

  it("increments easeFactor by 0.1", () => {
    const r = sm2(4, 2.5, 1, 5)
    expect(r.easeFactor).toBeCloseTo(2.6)
  })

  it("caps easeFactor at 3.0", () => {
    const r = sm2(4, 3.0, 1, 5)
    expect(r.easeFactor).toBe(3.0)
  })

  it("caps interval at 30 days", () => {
    const r = sm2(20, 2.5, 5, 5)
    // 20 * 2.5 * 1.15 = 57.5 → capped at 30
    expect(r.intervalDays).toBe(30)
  })

  it("increments consecutiveOk", () => {
    const r = sm2(4, 2.5, 3, 5)
    expect(r.consecutiveOk).toBe(4)
  })
})

describe("sm2 — state does not mutate original values", () => {
  it("returns a new object each time", () => {
    const r1 = sm2(1, 2.5, 0, 4)
    const r2 = sm2(1, 2.5, 0, 4)
    expect(r1).not.toBe(r2)
    expect(r1).toEqual(r2)
  })
})
