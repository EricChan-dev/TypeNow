/**
 * 会员权益的唯一事实源。
 *
 * ── 为什么要单独一个模块 ──────────────────────────────────────────────────────
 *
 * 价格页曾经把同一批权益在 4 处各写一份（`PricingClient` 的 7 条卡片卖点、
 * `pricing/page` 的对比表、`page` 首页的 6 条、`terms` 的措辞），结果漂移成
 * 「7 条里 4 条是代码里不存在的功能」（听说读写全覆盖 / 自定义上传 / 报告导出 /
 * 会员徽章），另 3 条则是「功能真实存在，但不属于会员专属」（音素级纠音、
 * FSRS、AI 私教）—— 后者同样有害：用户会以为买到了差异化，实际人人都有。
 *
 * 这与仓库里已经踩过的两个坑同形，所以用同一套解法：
 *   - 管理端鉴权曾有三份判定，后来收敛到 `lib/admin-identity`；
 *   - `TRIAL_DAYS` 曾散落多处，后来收敛到 `lib/trial-days`。
 *
 * ── 两条设计约束 ────────────────────────────────────────────────────────────
 *
 * 1. **额度数字既被接口强制、也被文案展示，所以必须是同一份常量。**
 *    接口（evaluate / chat）从这里 import 上限值，文案也用同样的值渲染 ——
 *    改一个数就两边同时生效，不存在「文案写 30 次、代码只给 3 次」的可能。
 *
 * 2. **每条权益必须声明 `gate`（兑付方式）。** 这是防漂移的核心：
 *    `quota` 要求会员额度严格大于免费额度，`content` 对应唯一真实的内容门禁，
 *    而「免费用户也有」的能力**不允许**出现在 PRO_BENEFITS 里 ——
 *    它们统一进 INCLUDED_FOR_EVERYONE，由单测把关（见
 *    `src/__tests__/membership-benefits.test.ts`）。
 *
 * 本模块**不得引入 db / drizzle**：价格页是客户端组件，拖进服务端依赖会污染
 * 浏览器 bundle（与 `lib/trial-days` 同样的理由）。
 */

import { FREE_TRIAL_SENTENCES } from "@/lib/free-trial"

/** 一天的毫秒数。额度按「上海日历日」重置，与打卡、钻石统计同一口径。 */
export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 跟读评分（有道语音评测）的每日额度。
 *
 * 有道按调用计费，免费额度定在 3 次/天：足以判断这个功能有没有用，但不至于
 * 变成免费 API。会员 30 次/天对齐句乐部的公开额度；超出后不再放行（而不是
 * 自动转为计费调用），避免账单失控。
 */
export const FREE_PRONUNCIATION_PER_DAY = 3
export const PRO_PRONUNCIATION_PER_DAY = 30

/**
 * AI 私教助手（DeepSeek）的每日免费提问次数。
 *
 * 免费用户为 **0**：他们仍可用钻石提问（钻石靠练习就能免费赚到），只是不额外
 * 赠送额度。把「每天 N 次免费」留给会员，才是真正的差异化。
 */
export const FREE_AI_CHAT_PER_DAY = 0
export const PRO_AI_CHAT_PER_DAY = 2

/**
 * 权益的兑付方式。`kind` 决定了它能不能算作会员卖点：
 *   - `content`：内容解锁（本项目唯一真实门禁 = 每课试学句数）
 *   - `quota`  ：同一能力，会员每日次数更多（必须 pro > free）
 *   - `partner`：合伙人专属（现金佣金、提现等）
 */
export type BenefitGate =
  | { kind: "content" }
  | { kind: "quota"; freePerDay: number; proPerDay: number }
  | { kind: "partner" }

export interface Benefit {
  /** 稳定标识，供单测与埋点引用 */
  id: string
  label: string
  claim: string
  gate: BenefitGate
}

/**
 * **会员专属**（免费用户没有或明显更少）。
 * 这张表就是价格页上要展示的 Pro 权益清单。
 */
export const PRO_BENEFITS: readonly Benefit[] = [
  {
    id: "all-courses",
    label: "解锁全部课程内容",
    claim: `全部课程的完整句子，不再受每课 ${FREE_TRIAL_SENTENCES} 句试学限制`,
    gate: { kind: "content" },
  },
  {
    id: "pronunciation",
    label: "跟读评分",
    claim: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次语音评测（免费用户每天 ${FREE_PRONUNCIATION_PER_DAY} 次）`,
    gate: {
      kind: "quota",
      freePerDay: FREE_PRONUNCIATION_PER_DAY,
      proPerDay: PRO_PRONUNCIATION_PER_DAY,
    },
  },
  {
    id: "ai-chat",
    label: "AI 私教助手",
    claim: `每天 ${PRO_AI_CHAT_PER_DAY} 次免费提问，超出后可用钻石`,
    gate: { kind: "quota", freePerDay: FREE_AI_CHAT_PER_DAY, proPerDay: PRO_AI_CHAT_PER_DAY },
  },
]

/**
 * **所有用户都有**（含免费）。
 *
 * 它们**不是**会员卖点：写进 Pro 清单会让人以为"买了才有"，实际免费就能用 ——
 * 这正是价格页改版前犯的错。单独列出来的用途是「如实展示免费能拿到什么」，
 * 让用户明白付费买的是**更多内容与额度**，而不是解锁基本功能。
 */
export const INCLUDED_FOR_EVERYONE: readonly string[] = [
  "中译英打字练习（整句与分块）",
  "间隔重复复习，全部历史无上限",
  "深度学习统计与进步曲线",
  "生词本与句子笔记",
  "每日打卡与任务奖励",
  "练习即得钻石",
]

/** 合伙人专属权益（这些是真实实现的，见 PartnerDashboard）。 */
export const PARTNER_BENEFITS: readonly Benefit[] = [
  {
    id: "partner-lifetime",
    label: "永久免费解锁全部会员功能",
    claim: "一次买断，终身有效",
    gate: { kind: "partner" },
  },
  {
    id: "partner-invite",
    label: "专属邀请链接 / 二维码 / 海报",
    claim: "一键生成推广素材",
    gate: { kind: "partner" },
  },
  {
    id: "partner-commission-first",
    label: "首次付款佣金 50%",
    claim: "90 天归因窗口内的首购",
    gate: { kind: "partner" },
  },
  {
    id: "partner-commission-renew",
    label: "续费佣金 30%",
    claim: "90 天归因窗口内的续费",
    gate: { kind: "partner" },
  },
  {
    id: "partner-withdraw",
    label: "随时提现",
    // 口径按代码事实：partner/withdraw 只支持**全额提现**，没有"¥50 起"这个门槛。
    claim: "全额提现至微信零钱",
    gate: { kind: "partner" },
  },
  {
    id: "partner-dashboard",
    label: "实时数据看板",
    claim: "邀请数、转化率、待结算收益",
    gate: { kind: "partner" },
  },
]

export interface ComparisonRow {
  feature: string
  free: string
  monthly: string
  yearly: string
  partner: string
}

/** 价格页对比表的「无此项」标记：渲染层据此显示为横杠。 */
export const NOT_APPLICABLE = "-"

/**
 * 价格页的功能对比表。
 *
 * 与改版前的关键差别是**多了「免费」这一列**：没有它，这张表只能回答
 * 「买哪个付费档」，永远回答不了「为什么要付费」。免费列的内容与
 * INCLUDED_FOR_EVERYONE / PRO_BENEFITS 保持一致。
 *
 * 提现口径按代码事实写：`partner/withdraw` 只支持**全额提现**，不存在
 * "¥50 起"这个门槛（改版前文案写错了）。
 */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    feature: "课程内容",
    free: `每课试学 ${FREE_TRIAL_SENTENCES} 句`,
    monthly: "全部课程",
    yearly: "全部课程",
    partner: "全部课程",
  },
  {
    feature: "打字练习",
    free: "无限",
    monthly: "无限",
    yearly: "无限",
    partner: "无限",
  },
  {
    feature: "跟读评分",
    free: `每天 ${FREE_PRONUNCIATION_PER_DAY} 次`,
    monthly: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
    yearly: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
    partner: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
  },
  {
    feature: "AI 私教助手",
    free: "消耗钻石",
    monthly: `每天 ${PRO_AI_CHAT_PER_DAY} 次免费`,
    yearly: `每天 ${PRO_AI_CHAT_PER_DAY} 次免费`,
    partner: `每天 ${PRO_AI_CHAT_PER_DAY} 次免费`,
  },
  {
    feature: "间隔重复复习",
    free: "全部历史",
    monthly: "全部历史",
    yearly: "全部历史",
    partner: "全部历史",
  },
  {
    feature: "学习统计",
    free: "深度统计",
    monthly: "深度统计",
    yearly: "深度统计",
    partner: "深度统计",
  },
  {
    feature: "会员有效期",
    free: NOT_APPLICABLE,
    monthly: "按月",
    yearly: "按年",
    partner: "永久终身",
  },
  {
    feature: "专属邀请链接 / 海报",
    free: NOT_APPLICABLE,
    monthly: NOT_APPLICABLE,
    yearly: NOT_APPLICABLE,
    partner: "✓",
  },
  {
    feature: "首次付款佣金（90 天内）",
    free: NOT_APPLICABLE,
    monthly: NOT_APPLICABLE,
    yearly: NOT_APPLICABLE,
    partner: "50%",
  },
  {
    feature: "续费佣金（90 天内）",
    free: NOT_APPLICABLE,
    monthly: NOT_APPLICABLE,
    yearly: NOT_APPLICABLE,
    partner: "30%",
  },
  {
    feature: "提现",
    free: NOT_APPLICABLE,
    monthly: NOT_APPLICABLE,
    yearly: NOT_APPLICABLE,
    partner: "全额提现至微信零钱",
  },
  {
    feature: "价格",
    free: "¥0",
    monthly: "¥29/月",
    yearly: "¥199/年",
    partner: "¥399 终身",
  },
]
