import type { Metadata } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Toaster } from "sonner"
import { AiChatWidget } from "@/components/layout/AiChatWidget"
import { DeploySkewGuard } from "@/components/layout/DeploySkewGuard"
import { PageViewTracker } from "@/components/analytics/PageViewTracker"
import { BRAND } from "@/lib/brand"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

// 选项卡标题走 lib/brand 的唯一事实源。格式对齐竞品「品牌名 - 定位语」，
// 但两根字符串都是我们自己的话（不含任何竞品文案）。
export const metadata: Metadata = {
  title: BRAND.tabTitle,
  description:
    "AI 驱动的中译英打字练习平台。打一句、记一句、学会一句。",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* 品牌字体预热。
         *
         * 品牌名出现在每个页面的顶栏，属首屏关键路径，但字体是在解析到 globals.css
         * 里的 @font-face 之后才会被发现并开始下载 —— 那之前浏览器已经用回退字体
         * 排好版了。实测（用 CDP Fetch 拦掉 woff2 与放开各量一次，落地页顶栏字标）：
         * 「句学社」在回退字体下宽 74.11px、换成品牌字体后 67.13px，
         * **swap 瞬间水平位移约 9.4%**，并把右侧元素一起顶走。
         *
         * 这里提前发起下载能把这段「先用回退字体、再换回来」的窗口压到几乎看不见：
         * 文件只有 1424 B，预热的代价近乎为零。子集是 12 个字符
         * 「句学社TypeNow ·」—— 字标本身只用前 3 个字，另外 9 个字符是给
         * `brandLockupWithEn()` 的「句学社 · TypeNow」（页脚版权行、协议正文）
         * 留的。**不要因为字标只有三个字就把它们裁掉**，否则页脚版权行里
         * 的中英文会一半品牌字体、一半回退字体，字距看着对不齐。
         *
         * 注意 `crossOrigin` 不能省：字体在规范里按 CORS 模式请求，preload 少了它
         * 会因模式不匹配而**再下第二次**，反而更慢。type 也要写全，
         * 否则浏览器无法据此跳过不支持的格式。 */}
        <link
          rel="preload"
          href="/fonts/typenow-brand.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {children}
        <PageViewTracker />
        <DeploySkewGuard />
        <AiChatWidget />
        <Toaster
          position="top-center"
          richColors
          toastOptions={{
            style: {
              background: "var(--card)",
              color: "var(--card-foreground)",
              border: "1px solid var(--border)",
            },
          }}
        />
      </body>
    </html>
  )
}
