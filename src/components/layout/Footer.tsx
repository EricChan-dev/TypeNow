import Link from "next/link"
import Image from "next/image"
const productLinks = [
  { href: "/#hero", label: "首页" },
  { href: "/#features", label: "功能" },
  { href: "/#testimonials", label: "评价" },
  { href: "/#faq", label: "问题" },
]

const companyLinks = [
  { href: "/terms", label: "用户协议" },
  { href: "/privacy", label: "隐私政策" },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="px-5 xl:px-20 py-12 xl:py-16">
        {/* Main columns */}
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-3 flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo_w.svg" alt="TypeNow" width={24} height={24} className="hidden [.dark_&]:block" />
              <Image src="/logo.svg" alt="TypeNow" width={24} height={24} className="block [.dark_&]:hidden" />
              <span className="text-lg font-bold text-foreground">
                码上英语 · TypeNow
              </span>
            </Link>
            <p className="text-[13px] text-muted-foreground leading-relaxed max-w-xs">
              AI 驱动的中译英打字练习平台。打一句、记一句、学会一句。
            </p>
          </div>

          {/* 产品 */}
          <div className="col-span-1 lg:col-span-2 flex flex-col gap-3">
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

          {/* 公司 */}
          <div className="col-span-1 lg:col-span-2 flex flex-col gap-3">
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

          {/* 关注我们 */}
          <div className="col-span-2 lg:col-span-5 flex flex-col gap-3">
            <h4 className="text-sm font-bold text-foreground mb-1">关注我们</h4>
            <div className="flex gap-6">
              <div className="flex flex-col items-center gap-2">
                <div className="w-[100px] h-[100px] rounded-xl bg-card border border-border overflow-hidden">
                  <Image
                    src="/wechat-oa.jpeg"
                    alt="公众号二维码"
                    width={100}
                    height={100}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-[12px] text-muted-foreground">公众号</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-[100px] h-[100px] rounded-xl bg-card border border-border overflow-hidden">
                  <Image
                    src="/wechat-oa.jpeg"
                    alt="客服二维码"
                    width={100}
                    height={100}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-[12px] text-muted-foreground">客服</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-8 pt-6 border-t border-border">
          <span className="text-xs text-muted-foreground">
            &copy; 2026 TypeNow &middot; typenow.cn
            &nbsp;&middot;&nbsp; 晋ICP备2026006473号
          </span>
          <span className="text-xs text-muted-foreground">
            Made with &#10084; for Chinese English learners
          </span>
        </div>
      </div>
    </footer>
  )
}
