import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Info } from "lucide-react"
import { RELEASES } from "@/lib/releases"

export const metadata: Metadata = {
  title: "版本更新 - TypeNow",
  description: "TypeNow 的用户可见变化：功能上线、体验修复与会员权益调整。",
}

/**
 * 版本更新页。
 *
 * 条目来自 lib/releases（唯一事实源），按日期倒序渲染成时间线。
 *
 * 页面顶部刻意写明两条收录规则：只记用户可感知的变化、安全类修复不公开细节。
 * 不写清楚的话，"上次那个 bug 修没修"会被反复问，而写了细节又等于发布漏洞说明。
 */
export default function ReleasesPage() {
  return (
    <div className="mx-auto max-w-[800px] px-6 py-12 sm:py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">版本更新</h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          这里记录每一次你**能感知到**的变化：新功能、体验修复、会员与价格调整。
        </p>
        <p className="flex items-start gap-2 rounded-xl bg-card border border-border px-4 py-3 text-sm text-muted-foreground leading-relaxed">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <span>
            收录规则：只记用户可感知的变化，不记内部的目录调整与测试补齐；
            安全类修复会说明「已修复」但不公开细节 —— 写明是哪个接口、
            什么条件，等于给尚未升级的环境留了一份漏洞说明。
          </span>
        </p>
      </header>

      <ol className="mt-12 flex flex-col gap-10">
        {RELEASES.map((entry) => (
          <li
            key={`${entry.date}-${entry.title}`}
            className="flex flex-col gap-3 border-l-2 border-border pl-6 relative"
          >
            {/* 时间线节点 */}
            <span
              aria-hidden
              className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-primary"
            />
            <div className="flex flex-wrap items-center gap-3">
              <time className="text-[13px] font-semibold text-primary tabular-nums">
                {entry.date}
              </time>
              <h2 className="text-lg font-bold text-foreground">{entry.title}</h2>
            </div>
            <ul className="flex flex-col gap-2">
              {entry.items.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed"
                >
                  <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <section className="mt-14 flex flex-col items-center gap-4 rounded-2xl bg-muted px-6 py-9 text-center">
        <p className="text-sm text-muted-foreground leading-relaxed">
          想知道具体能做什么？功能介绍页把每条能力与已知边界都写清楚了。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/features"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            查看功能介绍
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center rounded-[10px] border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-card transition-colors"
          >
            查看会员方案
          </Link>
        </div>
      </section>
    </div>
  )
}
