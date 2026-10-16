import { Suspense } from "react"
import Image from "next/image"
import { LoginForm } from "@/components/auth/LoginForm"
import { LoginBanner } from "@/components/auth/LoginBanner"
import { LoginSupportLinks } from "@/components/auth/LoginSupportLinks"
import { BRAND, brandLockupWithEn } from "@/lib/brand"

/**
 * 登录页。
 *
 * 版面 按验收要求改造（用户 m01483：「登录页也改造一下，
 * 尽量保持一致，主要是样式，业务逻辑保留我们的」）。样式全部在 ./login.css，
 * 作用域是 `.login-ref`，不污染站内其它页面。
 *
 * 品牌相关的位置换成我们的：h3 的锁定标、页脚的版权行与备案号。其余文案与
 * 版式按验收版式 1:1 保留 —— 这与落地页的处理一致，代码注释里记下这个约定，避免以后
 * 有人把「像玩游戏一样组装句子」这类句子当成笔误而"修正"掉。
 *
 * 左栏轮播在 LoginBanner 里（客户端组件，3s 自动切换）。
 */
export default function LoginPage() {
  return (
    <div className="login-ref">
      <div className="login">
        <div className="loginMain">
          <LoginBanner />

          <div className="main_box">
 {/* 品牌锁定标。验收版式放的是一张 338×80 的整块位图（图标+品牌名
                烘焙在同一张图里），我们的图标 public/brand/icon.png 是单图形，
                所以用「图标+真实文字」，与落地页顶栏同一种处理。 */}
            <h3>
              {/* m00858：源图紧裁为横版（1.494），高 40 → 宽 60，属性比=实际比。 */}
              <Image src="/brand/icon.png" alt="" aria-hidden width={60} height={40} />
 {/* 验收版式这一块是 338×80 的整块 logo 位图 —— 图标与品牌名烘焙在同一张
                  位图里，用的就是站酷快乐体（字形 IoU 0.907，见 globals.css 的
 @font-face 注释）。所以这里排同一款字体，真实文字部分即同一观感；
                  font-brand 自带 400 字重锁定（该字体只有 Regular）。 */}
              <span className="font-brand">{BRAND.lockup}</span>
            </h3>

            <Suspense
              fallback={
                <div className="loginContent">
                  <div className="content on">
                    <p className="support-tip">加载中…</p>
                  </div>
                </div>
              }
            >
              <LoginForm />
            </Suspense>

            <div className="logincopyright">
              <label>
                © 2026 <span className="font-brand">{BRAND.lockup}</span>
              </label>
              {/* 「帮助中心 / 关于我们」不再是跳转链接 —— 用户要求点击后就地
                  展示公众号/客服二维码（见 LoginSupportLinks 顶部注释）。 */}
              <LoginSupportLinks />
            </div>
          </div>
        </div>
      </div>

      <div className="loginBottom">
        © 2026 <span className="font-brand">{brandLockupWithEn()}</span> &nbsp;·&nbsp;
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
          晋ICP备2026006473号
        </a>
      </div>
    </div>
  )
}
