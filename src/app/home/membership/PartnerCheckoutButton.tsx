"use client"

import { useState } from "react"
import { CheckoutModal } from "@/components/payment/CheckoutModal"

/**
 * 会员中心里「合伙人版」的下单按钮。
 *
 * 为什么需要这个客户端组件：
 * `src/app/home/membership/page.tsx` 是 **server component**，不能直接持有
 * CheckoutModal 的开关状态；而合伙人版又必须走扫码下单（`CheckoutModal`
 * → `POST /api/payment/create-order`，后者用 `lib/pricing` 的 `isPlanKey`
 * 白名单校验，partner 档本来就在白名单里，后端一直是能卖的）。
 *
 * ⚠️ 补这个按钮是在**修补 2026-10-10 反向改动漏掉的一环**：
 * `src/components/pricing/PricingClient.tsx` 的 `handleCheckout()` 对
 * `plan === "partner"` 直接 `router.push("/home/membership")`，注释写的是
 * 「购买入口在会员中心」—— 但会员中心当时并没有任何下单入口，
 * 于是「会员中心 → 价格页 → 会员中心」构成闭环，合伙人版无法下单。
 * 这个按钮就是那个缺失的入口。
 *
 * 定价与档位名一律由 CheckoutModal / create-order 从 lib/pricing 推导，
 * 这里不写死任何金额。
 */
export function PartnerCheckoutButton({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && (
        <CheckoutModal
          plan="partner"
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false)
            // 支付成功后回到会员中心，让服务端重新渲染最新身份
            window.location.assign("/home/membership?payment_success=partner")
          }}
        />
      )}
    </>
  )
}
