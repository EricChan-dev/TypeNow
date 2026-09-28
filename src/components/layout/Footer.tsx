import Link from "next/link"
import Image from "next/image"
// 页脚「产品」列：改版前是 4 个落地页锚点（首页/功能/评价/问题），
// 现在指向独立的功能介绍页与更新日志页。"首页"去掉（logo 已承担该入口），
// "功能"换成真正的内容页 —— 锚点只能看落地页那段概述，独立页才讲得清每条能力的边界。
const productLinks = [
  { href: "/features", label: "功能介绍" },
  { href: "/pricing", label: "会员方案" },
  { href: "/releases", label: "版本更新" },
  { href: "/#testimonials", label: "用户评价" },
  { href: "/#faq", label: "常见问题" },
]

const companyLinks = [
  { href: "/terms", label: "用户协议" },
  { href: "/privacy", label: "隐私政策" },
]

/**
 * 页脚二维码。
 *
 * 改版前「公众号」与「客服」两个格子指向**同一张图**（/wechat-oa.jpeg）——
 * 扫「客服」实际得到的是公众号，是一个会误导用户的假入口。
 *
 * 现在改成数据驱动：**只渲染确实有独立图片的入口**。缺图片的入口宁可不放，
 * 也不拿另一张图顶上 —— 拿到客服二维码后在这里加一行即可。
 */
const QR_CODES = [{ src: "/wechat-oa.jpeg", label: "公众号" }]

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
              {QR_CODES.map((qr) => (
                <div key={qr.label} className="flex flex-col items-center gap-2">
                  <div className="w-[100px] h-[100px] rounded-xl bg-card border border-border overflow-hidden">
                    <Image
                      src={qr.src}
                      alt={`${qr.label}二维码`}
                      width={100}
                      height={100}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-[12px] text-muted-foreground">{qr.label}</span>
                </div>
              ))}
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
