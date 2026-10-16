"use client"

import { useState } from "react"
import { ContactModal } from "@/components/auth/ContactModal"

/**
 * 登录页右下角的「帮助中心 / 关于我们」。
 *
 * 用户要求（本次）：这两个入口点击后**展示公众号或客服二维码**，而不是跳走。
 *
 * 为什么不是跳转：原先是 `<Link href="/pricing">` 与 `<Link href="/features">`，
 * 点了会把正在登录的人**带离登录页** —— 而他本来就是卡住了才来找帮助的，一离开
 * 又要重走一遍登录。就地弹二维码，问题在此闭环。
 *
 * 这两个位置不用外链：跨站跳转对「正在登录」的人没有帮助，且会丢失当前表单状态。
 *
 * 复用 `ContactModal` 而不是新写一个弹窗：站内已有这个组件（登录页「请联系客服」
 * 在用），里面放的是 `/wechat-oa.jpeg` 那张公众号二维码，并已按「标签要诚实」
 * 的原则写清它是公众号、关注后如何在公众号里留言。手上仍然**只有**这一张码
 * （见 ContactModal 顶部注释），所以三个入口共用同一个弹窗，不做假的「客服专线」。
 * 拿到真正的客服二维码后，在 ContactModal 里加一格即可，这里无需改动。
 *
 * 版面：外层仍是 `logincopyright` 里的那个 `<p>`，两个 `<button>` 由 login.css
 * 与原来的 `<a>` 并列渲染成同样的外观（否则会退化成浏览器默认的灰底按钮）。
 */
export function LoginSupportLinks() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <p>
        {/* button 而不是 a：这里不再导航，只会就地打开弹窗。
            login.css 里 `.logincopyright p a` 已与 button 并列，
 所以视觉上与原来的 `<a>` 完全一致。 */}
        <button type="button" onClick={() => setOpen(true)}>
          帮助中心
        </button>
        <button type="button" onClick={() => setOpen(true)}>
          关于我们
        </button>
      </p>

      <ContactModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
