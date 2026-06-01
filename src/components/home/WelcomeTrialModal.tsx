"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"

const STORAGE_KEY = "welcome_shown"

export function WelcomeTrialModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      sessionStorage.setItem(STORAGE_KEY, "1")
      setOpen(true)
    }
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div className="relative max-w-sm w-full rounded-2xl bg-card border border-border p-6 shadow-2xl">
        <button
          onClick={() => setOpen(false)}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl" style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)" }}>
            <Image src="/VIP.png" alt="VIP" width={36} height={36} />
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">🎉 恭喜获得 3 天体验会员</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              赶快去学习吧，开启你的英语之旅！
            </p>
          </div>

          <div className="flex flex-col gap-2.5 w-full mt-1">
            <button
              onClick={() => { setOpen(false); router.push("/pricing") }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
            >
              立即升级会员
            </button>
            <button
              onClick={() => setOpen(false)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-muted-foreground border border-border hover:bg-muted transition-colors"
            >
              先去体验
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
