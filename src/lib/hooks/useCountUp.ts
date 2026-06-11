"use client"

import { useState, useEffect, useRef } from "react"
import { animate } from "animejs"

export function useCountUp(target: number, enabled: boolean, duration = 1400) {
  const [value, setValue] = useState(0)
  const objRef = useRef({ val: 0 })

  useEffect(() => {
    if (!enabled || target === 0) { setValue(target); return }
    objRef.current.val = 0
    animate(objRef.current, {
      val: target,
      duration,
      ease: "out(3)",
      onUpdate: () => setValue(Math.round(objRef.current.val)),
    })
  }, [target, enabled, duration])

  return value
}
