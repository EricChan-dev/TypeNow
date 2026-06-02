import Link from "next/link"
import Image from "next/image"
import { Globe, MessageCircle, Mail } from "lucide-react"

const productLinks = [
  { href: "/", label: "打字练习" },
  { href: "/", label: "智能复习" },
  { href: "/", label: "AI 强化训练" },
  { href: "/", label: "定价" },
]

const learnLinks = [
  { href: "/", label: "学习路径" },
  { href: "/", label: "句子库" },
  { href: "/", label: "使用技巧" },
  { href: "/", label: "学习博客" },
]

const companyLinks = [
  { href: "/", label: "关于我们" },
  { href: "/", label: "联系方式" },
  { href: "/terms", label: "用户协议" },
  { href: "/privacy", label: "隐私政策" },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="px-5 xl:px-20 py-12 xl:py-16">
        {/* Main columns */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-20">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-1 flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo_w.svg" alt="TypeNow" width={24} height={24} className="hidden [.dark_&]:block" />
              <Image src="/logo.svg" alt="TypeNow" width={24} height={24} className="block [.dark_&]:hidden" />
              <span className="text-lg font-bold text-foreground">
                码上英语 · TypeNow
              </span>
            </Link>
            <p className="text-[13px] text-muted-foreground leading-relaxed max-w-xs">
              从打一句英语开始，到真正流利表达——每一步都让你看见自己的进步
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-9 w-9 rounded-lg bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors"
                aria-label="GitHub"
              >
                <Globe className="h-4 w-4" />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-9 w-9 rounded-lg bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors"
                aria-label="Twitter"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
              <a
                href="mailto:hello@typenow.cn"
                className="flex items-center justify-center h-9 w-9 rounded-lg bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors"
                aria-label="Email"
              >
                <Mail className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* 产品 */}
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-bold text-foreground mb-1">产品</h4>
            {productLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* 学习 */}
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-bold text-foreground mb-1">学习</h4>
            {learnLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* 公司 */}
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-bold text-foreground mb-1">公司</h4>
            {companyLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-8 pt-6 border-t border-border">
          <span className="text-xs text-muted-foreground">
            &copy; 2026 TypeNow &middot; typenow.cn
            &nbsp;&middot;&nbsp; 沪ICP备XXXXXXXX号
          </span>
          <span className="text-xs text-muted-foreground">
            Made with &#10084; for Chinese English learners
          </span>
        </div>
      </div>
    </footer>
  )
}
