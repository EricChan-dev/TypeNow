"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"

export function ScrollToSection() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const section = searchParams.get("scroll")
    if (section) {
      if (section === "hero") {
        setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 200)
      } else {
        const el = document.getElementById(section)
        if (el) {
          setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 200)
        }
      }
    }
  }, [searchParams])

  return null
}
