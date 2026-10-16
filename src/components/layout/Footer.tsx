import Link from "next/link"
import Image from "next/image"
import { BRAND, brandLockupWithEn } from "@/lib/brand"

// 页脚「产品」列指向独立内容页。
//
// 改版注意：原先这里还有 /#testimonials 与 /#faq 两个锚点。新版落地页
// 收缩成了「玩法 / 演示 / 特色」三段，已经**没有**这两个 section —— 留着就是
// 点了没反应的死链。它们对应的独立页是 /pricing（含 FAQ 与会员方案），
// 所以这里直接指过去，而不是保留两个空锚点。
const productLinks = [
  { href: "/features", label: "功能介绍" },
  { href: "/pricing", label: "会员方案" },
  { href: "/releases", label: "版本更新" },
]

const companyLinks = [
  { href: "/terms", label: "用户协议" },
  { href: "/privacy", label: "隐私政策" },
  // 儿童隐私此前只有《隐私政策》第 7 节的一句话，登录页与落地页却都摆着
  // 「《儿童隐私保护政策》」的链接 —— 现在补上了独立页，页脚也一并放出来。
  { href: "/children-privacy", label: "儿童隐私" },
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
            <Link href="/" className="flex items-center gap-2.5">
              {/* 尺寸与落地页页脚同层级（m00559 比例 + m00630 整体放大）——
                  高 48px（宽 72 = 48×1.494 跟随源图比，m00858 紧裁横版）
                  vs 26px 文字，公开页页脚保持同一套品牌比例。 */}
              <Image src="/brand/icon.png" alt={BRAND.nameZh} width={72} height={48} />
              <span className="font-brand text-[26px] text-foreground">
                {BRAND.lockup}
              </span>
            </Link>
            <p className="text-[13px] text-muted-foreground leading-relaxed max-w-xs">
              {BRAND.tagline}。打一句、记一句、学会一句。
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
            &copy; 2026 <span className="font-brand">{brandLockupWithEn()}</span> &middot; typenow.cn
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
