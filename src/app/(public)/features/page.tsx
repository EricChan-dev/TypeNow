import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, Info } from "lucide-react"
import { FEATURE_GROUPS } from "@/lib/product-features"
import { AuthLink } from "@/components/layout/AuthLink"

export const metadata: Metadata = {
  title: "功能介绍 - TypeNow",
  description:
    "TypeNow 能做什么：中译英打字练习、间隔重复复习、点词详情与 AI 句子讲解、学习统计、合伙人推广。每条能力都注明已知边界。",
}

/**
 * 功能介绍页。
 *
 * 内容全部来自 lib/product-features（唯一事实源），本页只负责排版 ——
 * 文案写在页面里就会变成又一个副本，而"同一个功能各处说法不同"正是
 * 这次要修的根因。
 *
 * 每组的 `caveat`（已知边界）刻意做成醒目的提示块而不是藏进小字：
 * 提前说明「练习需要键盘」「部分句子语法树还是空的」，比用户自己撞上更好。
 */
export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-6 py-12 sm:py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">功能介绍</h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          TypeNow 是一款中译英打字练习工具：看中文、敲英文，把「认识」变成「能用出来」。
          下面是我们**实际提供**的能力清单。
        </p>
        <p className="flex items-start gap-2 rounded-xl bg-card border border-border px-4 py-3 text-sm text-muted-foreground leading-relaxed">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <span>
            这里只写代码里真的做了的功能，并把已知的边界一并说明 ——
            写上去却做不到的承诺，对使用者没有任何价值。
          </span>
        </p>
      </header>

      {/* 目录：功能页较长，给个就地跳转 */}
      <nav className="mt-8 flex flex-wrap gap-2">
        {FEATURE_GROUPS.map((group) => (
          <a
            key={group.id}
            href={`#${group.anchor}`}
            className="rounded-full bg-muted px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {group.title}
          </a>
        ))}
      </nav>

      <div className="mt-12 flex flex-col gap-10">
        {FEATURE_GROUPS.map((group) => (
          <section key={group.id} id={group.anchor} className="scroll-mt-24 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-bold text-foreground">{group.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{group.summary}</p>
            </div>

            <div className="rounded-2xl bg-card border border-border p-6 flex flex-col gap-4">
              {group.items.map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <Check className="h-4 w-4 shrink-0 mt-1 text-success" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-card-foreground">{item.title}</span>
                    <span className="text-sm text-muted-foreground leading-relaxed">
                      {item.detail}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {group.caveat && (
              <p className="flex items-start gap-2 rounded-xl bg-muted px-4 py-3 text-[13px] text-muted-foreground leading-relaxed">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/70" />
                <span>{group.caveat}</span>
              </p>
            )}
          </section>
        ))}
      </div>

      {/* 收尾：说清楚免费能拿到什么，再把选择权交给用户 */}
      <section className="mt-14 flex flex-col items-center gap-5 rounded-2xl bg-muted px-6 py-10 text-center">
        <h2 className="text-xl font-bold text-foreground">先免费试，觉得有用再升级</h2>
        <p className="max-w-lg text-sm text-muted-foreground leading-relaxed">
          注册即可免费试学每门课的开头几句，打字练习、间隔重复复习与学习统计对免费用户开放。
          会员解锁全部课程内容，并获得更高的跟读评分与 AI 助手额度。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <AuthLink className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-primary px-7 py-3.5 text-[15px] font-bold text-primary-foreground hover:bg-primary/90 transition-colors">
            立即开始练习
          </AuthLink>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-border px-7 py-3.5 text-[15px] font-semibold text-foreground hover:bg-card transition-colors"
          >
            查看会员方案
            <ArrowRight className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </section>
    </div>
  )
}
