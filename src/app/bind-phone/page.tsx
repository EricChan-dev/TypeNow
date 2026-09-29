import { redirect } from "next/navigation"
import { getUser, isDbConfigured } from "@/app/actions/auth"
import { isDevBypassSession } from "@/lib/auth/session"
import { needsPhoneBinding } from "@/lib/phone-gate"
import { BindPhoneGate } from "@/components/auth/BindPhoneGate"

/**
 * 强制绑定手机号的落地页。
 *
 * 刻意放在 /home 之外：闸门在 home/layout 里，若这个页面也在 /home 下，
 * 未绑定的用户会被无限重定向到自己。
 *
 * 三种进入情况：
 *   · 未登录 → 回 /login
 *   · 已绑定手机号 → 直接进 /home（避免收藏了旧链接的人卡在这里）
 *   · 未绑定 → 渲染表单
 */
export const metadata = { title: "绑定手机号 · TypeNow" }

export default async function BindPhonePage() {
  const dbReady = await isDbConfigured()
  const user = await getUser()

  if (dbReady && !user) redirect("/login")

  if (user && !needsPhoneBinding({ phone: user.phone, devBypass: await isDevBypassSession() })) {
    redirect("/home")
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <BindPhoneGate />
    </main>
  )
}
