"use client"

import { X } from "lucide-react"
import {
  COIN_CHECK_IN_BASE,
  COIN_CHECK_IN_CAP,
  COIN_CHECK_IN_STEP,
  COIN_COURSE_COMPLETE,
  COIN_LESSON_COMPLETE,
  COIN_PER_PERFECT,
  COIN_PER_SENTENCE,
  COIN_SHARE,
  COINS_PER_MEMBER_DAY,
  MAX_MEMBER_DAYS_PER_MONTH,
} from "@/lib/coins"

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 金币获取规则。
 *
 * 2026-09-29 由 `DiamondRulesModal` 改造而来。改动的原因不是换个名字：
 *
 *   · 练习奖励**不再发钻石**，而是发金币。钻石改为只由会员每日赠送（或未来充值），
 *     只用于 AI 助手与语音评测的超额消耗 —— 因为它对应真金白银的外部调用。
 *     继续把这张表标成"钻石获取规则"会让用户以为练句子能换 AI 次数，
 *     而实际上那条路已经被切断了。
 *   · 金币是准现金（COINS_PER_MEMBER_DAY 金币 = 1 天会员），所以额度必须
 *     从 lib/coins.ts 读取，不能在组件里写死 —— 调数值时只改一处。
 */
const RULES = [
  { action: "练习一句（有错误但敲对）", coins: `+${COIN_PER_SENTENCE}` },
  { action: "练习一句（全程无错）", coins: `+${COIN_PER_PERFECT}` },
  { action: "完成一个课时", coins: `+${COIN_LESSON_COMPLETE}` },
  { action: "完成一门课程", coins: `+${COIN_COURSE_COMPLETE}` },
  {
    action: `每日打卡（连续每天 +${COIN_CHECK_IN_STEP}，封顶 +${COIN_CHECK_IN_CAP}）`,
    coins: `+${COIN_CHECK_IN_BASE} 起`,
  },
  { action: "每日分享", coins: `+${COIN_SHARE}` },
]

export function CoinRulesModal({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[380px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-foreground/30 hover:text-foreground/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center px-6 pt-8 pb-5 gap-2">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-1"
            style={{ background: "rgba(234,179,8,0.15)" }}
          >
            🪙
          </div>
          <h2 className="text-[18px] font-bold text-foreground">金币获取规则</h2>
          <p className="text-sm text-muted-foreground text-center">
            金币靠学习获得，不用花钱买
          </p>
        </div>

        <div className="px-6 pb-2">
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div
              className="grid grid-cols-2 px-4 py-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider"
              style={{ background: "var(--muted)" }}
            >
              <span>行为</span>
              <span className="text-right">金币</span>
            </div>
            {RULES.map((r, i) => (
              <div
                key={r.action}
                className="grid grid-cols-2 px-4 py-3 text-sm"
                style={{ borderTop: i === 0 ? undefined : "1px solid var(--border)" }}
              >
                <span className="text-foreground/75">{r.action}</span>
                <span className="text-right font-semibold text-amber-400">{r.coins}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="mx-5 my-5 rounded-xl px-4 py-3"
          style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)" }}
        >
          <p className="text-amber-400 font-bold text-[13px]">🎯 金币能做什么</p>
          <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
            {COINS_PER_MEMBER_DAY} 金币 = 1 天会员，每人每月最多兑换 {MAX_MEMBER_DAYS_PER_MONTH} 天。
            更多道具与精美礼品正在开发中。
          </p>
          <p className="text-muted-foreground text-xs mt-2 leading-relaxed">
            金币**不能**用于 AI 对话 —— 那消耗的是钻石（会员每天赠送）。
          </p>
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onClose}
            className="w-full py-4 text-sm font-semibold text-foreground/70 hover:bg-muted/50 transition-colors"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}
