export interface SM2Result {
  intervalDays: number
  easeFactor: number
  consecutiveOk: number
}

/**
 * Simplified SM-2 spaced repetition algorithm.
 * Grade 0-2: failed → reset interval to 1 day
 * Grade 3: ok but hard → +20%, consecutive decremented
 * Grade 4: good → multiply by easeFactor
 * Grade 5: perfect → multiply by easeFactor * 1.15, ease increases
 */
export function sm2(
  intervalDays: number,
  easeFactor: number,
  consecutiveOk: number,
  grade: number
): SM2Result {
  let newInterval = intervalDays
  let newEase = easeFactor
  let newConsec = consecutiveOk

  if (grade <= 2) {
    newInterval = 1
    newConsec = 0
  } else if (grade === 3) {
    newInterval = Math.ceil(intervalDays * 1.2)
    newConsec = Math.max(0, consecutiveOk - 1)
  } else if (grade === 4) {
    newInterval = Math.ceil(intervalDays * easeFactor)
    newConsec = consecutiveOk + 1
  } else {
    newInterval = Math.min(30, Math.ceil(intervalDays * easeFactor * 1.15))
    newEase = Math.min(3.0, easeFactor + 0.1)
    newConsec = consecutiveOk + 1
  }

  return { intervalDays: newInterval, easeFactor: newEase, consecutiveOk: newConsec }
}
