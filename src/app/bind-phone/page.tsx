import { redirect } from "next/navigation"

/**
 * 旧的绑定落地页，现在只做兼容跳转。
 *
 * 绑定手机号已改成**登录校验**：微信登录后若账号没手机号，服务端直接把人送去
 * /login?bind=1，由登录页的「验证码登录」tab 承担绑定（见 lib/phone-gate 的
 * loginBindPath 与 components/auth/LoginForm 的 bindMode）。
 *
 * 期间短暂用过「全局弹窗」（挂在 home/layout 上），已废弃：弹窗拦不住任何东西，
 * /home 的内容照样会被渲染进响应里，未绑定用户能读到学习数据。改成 redirect 之后
 * 服务端就不会往下渲染了 —— 这也正是现在 home/layout 里那句注释警告的原因，
 * **不要再改回渲染弹窗**。
 *
 * 保留这条路由只是为了让已经发出去的链接不 404。
 */
export default function BindPhonePage() {
  redirect("/home")
}
