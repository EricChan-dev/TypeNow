"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

interface Props {
  inviteCode: string
  partnerName: string | null
  partnerAvatar: string | null
}

const COOKIE_KEY = "ref_code"
const STORAGE_KEY = "typenow_ref_code"
const COOKIE_DAYS = 30

export default function RefLandingClient({ inviteCode, partnerName, partnerAvatar }: Props) {
  const router = useRouter()

  useEffect(() => {
    // Persist invite code in cookie + localStorage
    const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString()
    document.cookie = `${COOKIE_KEY}=${inviteCode}; expires=${expires}; path=/; SameSite=Lax`
    localStorage.setItem(STORAGE_KEY, inviteCode)
  }, [inviteCode])

  function handleRegister() {
    const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString()
    document.cookie = `${COOKIE_KEY}=${inviteCode}; expires=${expires}; path=/; SameSite=Lax`
    localStorage.setItem(STORAGE_KEY, inviteCode)
    router.push("/login")
  }

  const displayName = partnerName || "一位朋友"

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        {/* App brand */}
        <div className="text-center">
          <div className="text-3xl font-bold text-white tracking-tight">码上英语</div>
          <div className="text-sm text-white/50 mt-1">AI 全程陪练，打字练就地道英语</div>
        </div>

        {/* Partner info */}
        <div className="flex flex-col items-center gap-3">
          {partnerAvatar ? (
            <img
              src={partnerAvatar}
              alt={displayName}
              className="w-16 h-16 rounded-full object-cover border-2 border-white/20"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-2xl text-white/60">
              {displayName.slice(0, 1)}
            </div>
          )}
          <p className="text-white/70 text-sm">
            <span className="text-white font-medium">{displayName}</span> 邀请你加入
          </p>
        </div>

        {/* Features */}
        <div className="w-full bg-white/[0.05] border border-white/10 rounded-2xl p-5 flex flex-col gap-3">
          {[
            "AI 智能拆句，渐进式打字练习",
            "音标 + 词性实时反馈，记词更高效",
            "间隔复习队列，科学巩固记忆",
            "真实场景句型，学了就能用",
          ].map((f) => (
            <div key={f} className="flex items-center gap-3 text-sm text-white/70">
              <span className="text-emerald-400">✓</span>
              {f}
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={handleRegister}
          className="w-full py-4 rounded-2xl bg-white text-black font-semibold text-base hover:bg-white/90 transition-colors"
        >
          立即注册，免费体验
        </button>

        <p className="text-white/30 text-xs text-center">
          使用邀请码 <span className="text-white/60 font-mono font-medium">{inviteCode}</span> 注册
        </p>
      </div>
    </div>
  )
}
