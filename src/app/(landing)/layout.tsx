import "./landing-fonts.css"
import "./landing.css"

/**
 * 落地页专用字体层。
 *
 * ── 为什么单独给 (landing) 加一层 layout ─────────────────────────────────────
 *
 * 基准实现的字体来自它外链的 style.css：
 *   body { font-family:'Plus Jakarta Sans','Noto Sans SC',-apple-system,…;
 *          letter-spacing:-0.01em; }
 * 这套字体是基准实现版式的组成部分 —— 拉丁字母走 Plus Jakarta Sans，汉字走
 * Noto Sans SC。换成别字体（原本的 Inter + 系统苹方）会让每个字形的宽高和字距
 * 都不一样，整页看起来就像「排版错乱」，哪怕盒模型尺寸是对齐的。
 *
 * 但站内其它页面（/home、/practice…）有自己的设计语言，不该被这次还原波及，
 * 所以字体只挂在 (landing) 这一层，通过 .landing-ref 作用到首页子树。
 *
 * ── 为什么用 @import 而不是 next/font ───────────────────────────────────────
 *
 * 试过 next/font/google 自托管，Turbopack 在本机拉不到字体文件：
 *   Module not found: Can't resolve
 *   '@vercel/turbopack-next/internal/font/google/font'
 * 于是退回基准实现原方案（外链 @import），见 ./landing-fonts.css。
 */

export default function LandingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <div className="landing-ref">{children}</div>
}
