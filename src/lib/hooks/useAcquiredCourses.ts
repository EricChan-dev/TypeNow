"use client"

import { useState, useEffect, useCallback } from "react"

const STORAGE_KEY = "typenow_acquired_courses"

function loadAcquired(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore corrupt data */ }
  return new Set()
}

function saveAcquired(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch { /* ignore quota errors */ }
}

export function useAcquiredCourses() {
  const [acquiredIds, setAcquiredIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setAcquiredIds(loadAcquired())
  }, [])

  const acquire = useCallback((courseId: string) => {
    setAcquiredIds((prev) => {
      const next = new Set(prev)
      next.add(courseId)
      saveAcquired(next)
      return next
    })
  }, [])

  const isAcquired = useCallback(
    (courseId: string) => acquiredIds.has(courseId),
    [acquiredIds]
  )

  return { acquiredIds, acquire, isAcquired }
}
