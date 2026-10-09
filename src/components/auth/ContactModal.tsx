"use client"

import { useEffect } from "react"
import Image from "next/image"
import { X, MessageCircle } from "lucide-react"
import { BRAND } from "@/lib/brand"

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 联系我们（客服入口）。
 *
 * 背景：全站此前**没有任何可用的客服入口** —— 登录页那句「请联系客服」指向
 * `/privacy#contact`，而隐私政策页第 9 节「联系我们」并没有 `id="contact"`，
 * 所以点下去只是把用户丢到政策页顶部，等于死链（页脚也刻意没放客服二维码，
 * 见 components/layout/Footer.tsx 的注释）。
 *
 * 本次按用户要求补上真实的联系路径：弹窗里放公众号二维码。
 *
 * 关于「为什么放的是公众号码而不是客服个人码」：手上**只有**这一张
 * `/wechat-oa.jpeg`（430×430，即页脚「关注我们」用的那张）。用户这次明确说
 * 「提供一个公众号或客服二维码」，所以放公众号码是被许可的；关键是**标签要诚实**
 * —— 这里写清楚它是公众号，并说明关注后如何在公众号里留言，不把它伪装成
 * 「客服专线」。等拿到真正的客服二维码，再加一格即可（本组件已按可扩展写）。
 */
export function ContactModal({ open, onClose }: Props) {
  // Esc 关闭。站内其它弹窗（CoinRulesModal 等）只支持点关闭按钮，
  // 这个弹窗会从登录页这个高频路径打开，顺手补上键盘退出。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[360px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-4 right-4 text-foreground/30 hover:text-foreground/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center px-6 pt-8 pb-4 gap-2">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-1"
            style={{ background: "rgba(37,99,235,0.12)" }}
          >
            <MessageCircle className="h-6 w-6 text-[#2563eb]" aria-hidden />
          </div>
          <h2
            id="contact-modal-title"
            className="text-[18px] font-bold text-foreground"
          >
            联系我们
          </h2>
          <p className="text-sm text-muted-foreground text-center">
            遇到登录、支付或学习问题，都可以找我们
          </p>
        </div>

        <div className="flex flex-col items-center px-6 pb-6 gap-3">
          <div className="rounded-xl border border-border overflow-hidden bg-white p-2">
            <Image
              src="/wechat-oa.jpeg"
              alt={`${BRAND.lockup}公众号二维码`}
              width={200}
              height={200}
              className="block h-[200px] w-[200px] object-contain"
            />
          </div>
          <p className="text-[13px] font-medium text-foreground/80 text-center">
            微信扫码关注「{BRAND.lockup}」公众号
          </p>
          <p className="text-[12px] text-muted-foreground text-center leading-relaxed">
            关注后直接在公众号里发消息描述你的问题，我们会尽快回复。
            <br />
            账号注销、金币与会员异常也从这里处理。
          </p>
        </div>
      </div>
    </div>
  )
}
