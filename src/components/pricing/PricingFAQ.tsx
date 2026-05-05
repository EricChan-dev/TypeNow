"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface FAQItem {
  question: string
  answer: string
}

const faqData: FAQItem[] = [
  {
    question: "普通会员有使用期限吗？",
    answer:
      "没有，普通会员永久免费使用。随时可以升级到月度或年度会员解锁更多功能。",
  },
  {
    question: "月度会员和年度会员功能有区别吗？",
    answer:
      "功能完全相同，只是付费周期不同。年度会员相当于 5.7 折，比月度会员省 ¥149。",
  },
  {
    question: "可以随时取消会员订阅吗？",
    answer:
      "可以，随时在设置中取消订阅，到期后不会自动续费，已付费期间仍可正常使用。",
  },
  {
    question: "会员支持退款吗？",
    answer: "支持。购买会员后 7 天内，如不满意可无条件全额退款。",
  },
]

function FAQItem({
  question,
  answer,
}: FAQItem) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-8 py-6 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="text-base font-semibold text-card-foreground">
          {question}
        </span>
        <ChevronDown
          className={cn(
            "h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="px-8 pb-6">
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            {answer}
          </p>
        </div>
      )}
    </div>
  )
}

export function PricingFAQ() {
  return (
    <div className="flex flex-col gap-4">
      {faqData.map((item) => (
        <FAQItem key={item.question} {...item} />
      ))}
    </div>
  )
}
