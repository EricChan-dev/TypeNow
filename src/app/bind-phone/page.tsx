import { redirect } from "next/navigation"

/**
 * 旧的绑定落地页，现在只做兼容跳转。
 *
 * 绑定手机号已改成全局弹窗（挂在 home/layout 上，见 components/auth/BindPhoneModal）：
 * 它是"做某件事之前的一道手续"，不是目的地 —— 独立页会把用户从当前上下文里拽走。
 * 保留这条路由只是为了让已经发出去的链接不 404。
 */
export default function BindPhonePage() {
  redirect("/home")
}
