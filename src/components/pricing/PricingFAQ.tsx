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
    question: "和背单词 App 有什么不同？",
    answer:
      `背单词解决的是"认识"，TypeNow 解决的是"会用"。你可能认识 apple 这个词，但能脱口而出 "An apple a day keeps the doctor away" 吗？TypeNow 从中译英打字切入，把单词放回真实句子里练，学的不是孤立的词汇，而是真正能用出来的表达。打完一句、记住一句、学会一句。`,
  },
  {
    question: "适合什么英语水平？",
    answer:
      "小学到考研、雅思托福备考都在用。内容按生活日常、职场办公、旅行出行、校园学习等 6 大场景分级递进，每个场景内从简单句到复杂句逐步挑战。不管你现在什么水平，都能找到适合自己的节奏。",
  },
  {
    question: "内容够不够？",
    answer:
      "上千套课程资源，覆盖生活、职场、旅行等真实使用场景，内容持续更新中。AI 智能复习会根据你的错误自动安排巩固练习，同样的句子学透为止——数量不在多，在于真正掌握。",
  },
{
    question: "孩子用安全吗？能看到学习情况吗？",
    answer:
      "放心，TypeNow 是纯粹的学习工具，没有社交干扰和无关内容。Pro 会员支持按场景、按时间的深度学习统计和报告导出——学了什么、学了多久、掌握程度如何，随时查看。",
  },
  {
    question: "为什么没有 App？",
    answer:
      "TypeNow 的核心体验是用键盘打字造句——在电脑前专注练习，手感更爽，效率更高。这类需要沉浸的学习方式，PC 端体验远好于手机。当然，手机浏览器也能打开用，微信内直接访问同样支持，只是键盘打字始终是最佳打开方式。",
  },
  {
    question: "合伙人会员怎么赚钱？",
    answer:
      "¥399 终身买断，解锁全部 Pro 功能的同时获得推广权益。生成专属邀请链接、二维码和海报分享给朋友，首次付费你拿 50% 佣金，续费拿 30%。¥50 起随时提现至微信零钱，实时数据看板跟踪收益。",
  },
]

function FAQItem({
  question,
  answer,
  defaultOpen = false,
}: FAQItem & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

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
      {faqData.map((item, i) => (
        <FAQItem key={item.question} {...item} defaultOpen={i === 0} />
      ))}
    </div>
  )
}
