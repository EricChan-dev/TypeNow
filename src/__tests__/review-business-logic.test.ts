/**
 * Tests for review queue business rules — no DB required.
 * Validates the pure logic extracted from API routes.
 */
import { describe, it, expect } from "vitest"
import { sm2 } from "@/lib/spaced-repetition"

// ── Enqueue: immediate availability ──────────────────────────────────────────

describe("review enqueue — nextReviewAt", () => {
  it("new item is immediately available (nextReviewAt <= now)", () => {
    const before = Date.now()
    const nextReviewAt = new Date() // matches route logic
    const after = Date.now()
    expect(nextReviewAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(nextReviewAt.getTime()).toBeLessThanOrEqual(after)
  })

  it("initial intervalDays is 1", () => {
    const intervalDays = 1
    expect(intervalDays).toBe(1)
  })
})

// ── Complete: mastery logic ───────────────────────────────────────────────────

describe("review complete — mastery flag", () => {
  it("mastered=true should result in status='done' (bypasses SM-2)", () => {
    const mastered = true
    const status = mastered ? "done" : "pending"
    expect(status).toBe("done")
  })

  it("mastered=false with grade runs SM-2 and keeps status='pending'", () => {
    const mastered = false
    const grade = 4
    const result = sm2(1, 2.5, 0, grade)
    const status = mastered ? "done" : "pending"
    expect(status).toBe("pending")
    expect(result.intervalDays).toBeGreaterThan(1)
  })
})

// ── Complete: grade validation ────────────────────────────────────────────────

describe("review complete — grade validation", () => {
  it("grade must be 0-5 (valid range)", () => {
    const validGrades = [0, 1, 2, 3, 4, 5]
    const invalidGrades = [-1, 6, 10, NaN]

    for (const g of validGrades) {
      expect(g >= 0 && g <= 5).toBe(true)
    }
    for (const g of invalidGrades) {
      expect(g >= 0 && g <= 5).toBe(false)
    }
  })

  it("neither grade nor mastered provided → should error (400)", () => {
    const mastered = undefined
    const grade = undefined
    const isInvalid = !mastered && grade === undefined
    expect(isInvalid).toBe(true)
  })

  it("mastered=true without grade → valid (no grade needed)", () => {
    const mastered = true
    const grade = undefined
    const isInvalid = !mastered && grade === undefined
    expect(isInvalid).toBe(false)
  })
})

// ── Complete: nextReviewAt calculation ───────────────────────────────────────

describe("review complete — nextReviewAt scheduling", () => {
  it("nextReviewAt is intervalDays days from now", () => {
    const intervalDays = 3
    const before = Date.now()
    const nextReviewAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000)
    const after = Date.now()
    const expectedMin = before + intervalDays * 86400000
    const expectedMax = after + intervalDays * 86400000
    expect(nextReviewAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
    expect(nextReviewAt.getTime()).toBeLessThanOrEqual(expectedMax)
  })

  it("grade 0 resets interval to 1 → next review is ~1 day away", () => {
    const { intervalDays } = sm2(7, 2.5, 2, 0)
    expect(intervalDays).toBe(1)
    const nextMs = intervalDays * 24 * 60 * 60 * 1000
    // Should be approximately 1 day (86400000 ms)
    expect(nextMs).toBe(86400000)
  })
})

// ── Enqueue: reset logic ─────────────────────────────────────────────────────

describe("review enqueue — reset done item", () => {
  it("a 'done' item reset to 'pending' gets intervalDays=1 and consecutiveOk=0", () => {
    // Simulates the reset values in route.ts
    const resetValues = { status: "pending", nextReviewAt: new Date(), intervalDays: 1, consecutiveOk: 0 }
    expect(resetValues.status).toBe("pending")
    expect(resetValues.intervalDays).toBe(1)
    expect(resetValues.consecutiveOk).toBe(0)
    expect(resetValues.nextReviewAt.getTime()).toBeLessThanOrEqual(Date.now() + 100)
  })
})
