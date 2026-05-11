import { Suspense } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, BookOpen } from "lucide-react"
import { LoginForm } from "@/components/auth/LoginForm"

const decoTexts = [
  { text: "LEARN", size: "text-[72px]", opacity: "opacity-[0.08]", weight: "font-extrabold", x: "left-5", y: "top-10", rotate: "-15" },
  { text: "ABC", size: "text-[56px]", opacity: "opacity-[0.10]", weight: "font-extrabold", x: "right-20", y: "top-28", rotate: "10" },
  { text: "A", size: "text-[96px]", opacity: "opacity-[0.07]", weight: "font-black", x: "right-4", y: "top-4", rotate: "-8" },
  { text: "GROW", size: "text-[48px]", opacity: "opacity-[0.09]", weight: "font-bold", x: "left-10", y: "bottom-1/3", rotate: "12" },
  { text: "English", size: "text-[44px]", opacity: "opacity-[0.08]", weight: "font-semibold", x: "left-24", y: "bottom-24", rotate: "5" },
  { text: "C", size: "text-[64px]", opacity: "opacity-[0.06]", weight: "font-black", x: "right-8", y: "top-1/2", rotate: "15" },
  { text: "READ", size: "text-[52px]", opacity: "opacity-[0.09]", weight: "font-bold", x: "right-24", y: "bottom-28", rotate: "-10" },
  { text: "WRITE", size: "text-[40px]", opacity: "opacity-[0.07]", weight: "font-bold", x: "right-12", y: "bottom-16", rotate: "8" },
  { text: "Aa", size: "text-[88px]", opacity: "opacity-[0.05]", weight: "font-black", x: "left-20", y: "top-40", rotate: "-5" },
]

export default function LoginPage() {
  return (
    <div className="flex flex-col h-screen">
      {/* ── Content Area ── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left: Brand Panel ── */}
        <aside className="hidden md:flex w-[45%] bg-[#1E40AF] relative flex-col items-center justify-center overflow-hidden px-12">
          {/* Decorative rotated text */}
          {decoTexts.map((d) => (
            <span
              key={d.text}
              className={`absolute ${d.x} ${d.y} ${d.size} ${d.opacity} ${d.weight} text-white select-none pointer-events-none`}
              style={{ transform: `rotate(${d.rotate}deg)` }}
            >
              {d.text}
            </span>
          ))}

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center text-center">
            {/* Logo */}
            <div className="flex items-center gap-2.5 mb-14">
              <div className="relative w-[50px] h-10">
                <BookOpen className="absolute left-0 top-2 w-[30px] h-[30px] text-white" />
                <span className="absolute left-6 top-0 text-xl font-extrabold text-white">
                  Aa
                </span>
              </div>
              <span className="text-2xl font-bold text-white tracking-[1.5px]">
                码上英语 · TypeNow
              </span>
            </div>

            {/* Illustration */}
            <div className="relative w-full max-w-[360px] h-[300px] mb-7 rounded-2xl overflow-hidden">
              <Image
                src="/login-illustration.png"
                alt="English learning illustration"
                fill
                className="object-cover"
                priority
              />
            </div>

            {/* Slogan */}
            <p className="text-[26px] font-medium text-white tracking-[3px] mb-4">
              码上一小句3，人生一大步
            </p>

            {/* Divider */}
            <div className="w-12 h-[3px] rounded-sm bg-white/30" />
          </div>
        </aside>

        {/* ── Right: Login Panel ── */}
        <section className="flex flex-1 flex-col bg-white min-w-0">
          {/* Top Bar */}
          <div className="flex items-center justify-between px-8 py-5 shrink-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-[#1E40AF] hover:opacity-80 transition-opacity"
            >
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Link>
            <span className="text-sm text-[#64748B]">typenow.cn</span>
          </div>

          {/* Centered Login Form */}
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="w-full max-w-[380px]">
              {/* Subtitle */}
              <p className="text-[15px] text-[#64748B] text-center mb-8">
                登录以开始你的英语学习之旅
              </p>

              <Suspense fallback={<div className="text-sm text-muted-foreground text-center">加载中...</div>}>
                <LoginForm />
              </Suspense>
            </div>
          </div>
        </section>
      </div>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-center py-4 border-t border-[#E2E8F0] bg-white shrink-0">
        <span className="text-xs text-[#64748B]">
          &copy; 2026 TypeNow &middot; typenow.cn
        </span>
      </footer>
    </div>
  )
}
