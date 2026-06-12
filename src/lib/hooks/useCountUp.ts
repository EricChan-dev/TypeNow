"use client"

import { useState, useEffect, useRef } from "react"
import { animate } from "animejs"

export function useCountUp(target: number, enabled: boolean, duration = 1400) {
  const [value, setValue] = useState(0)
  const objRef = useRef({ val: 0 })
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

  useEffect(() => {
    // Stop previous animation to prevent conflicts on period switch
    if (animRef.current) animRef.current.pause()
    if (!enabled || target === 0) { setValue(target); return }
    objRef.current.val = 0
    animRef.current = animate(objRef.current, {
      val: target,
      duration,
      ease: "out(3)",
      onUpdate: () => setValue(Math.round(objRef.current.val)),
    })
    return () => { if (animRef.current) animRef.current.pause() }
  }, [target, enabled, duration])

  return value
}
