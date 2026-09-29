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
 * ── 三条设计约束 ────────────────────────────────────────────────────────────
 *
 * 1. **额度数字既被接口强制、也被文案展示，所以必须是同一份常量。**
 *    接口（evaluate / chat / analyze）从这里 import 上限值，文案也用同样的值渲染 ——
 *    改一个数就两边同时生效，不存在「文案写 30 次、代码只给 3 次」的可能。
 *
 * 2. **每条权益必须声明 `gate`（兑付方式）。** 这是防漂移的核心：
 *    `quota` 要求会员额度严格大于免费额度，`content` 对应唯一真实的内容门禁，
 *    而「免费用户也有」的能力**不允许**出现在 PRO_BENEFITS 里 ——
 *    它们统一进 INCLUDED_FOR_EVERYONE，由单测把关（见
 *    `src/__tests__/membership-benefits.test.ts`）。
 *
 * 3. **推广权益不得出现在任何付费档里（2026-09-29 合规改造）。**
 *    此前 `PARTNER_BENEFITS` 把「邀请链接 / 佣金 50% / 提现 / 数据看板」全部挂在
 *    ¥399 商品上，等于在商品说明里承诺「付费买到推广与赚钱资格」—— 那正是
 *    《禁止传销条例》第七条(二)「变相入门费」在**经营对象**层面的构成方式，
 *    光改代码准入判断不够，页面上还写着。
 *
 *    现在拆成两张表，语义完全分开：
 *      LIFETIME_BENEFITS —— 终身会员的**学习**权益（真商品）
 *      PROMOTER_BENEFITS —— 推广权益，**免费**，任何注册用户均可加入
 *    并由单测看住「推广权益不得回到付费档里」。见 docs/distribution-compliance.md。
 *
 * 本模块**不得引入 db / drizzle**：价格页是客户端组件，拖进服务端依赖会污染
 * 浏览器 bundle（与 `lib/trial-days` 同样的理由）。
 */

import { FREE_TRIAL_SENTENCES } from "@/lib/free-trial"
import { COINS_PER_MEMBER_DAY, MAX_MEMBER_DAYS_PER_MONTH } from "@/lib/coins"
import { findPlan, formatYuan, type PlanKey } from "@/lib/pricing"

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
 * **2026-09-29 修正：原值 free=0 / pro=2 是一次误抄。**
 * 句乐部的「每日 2 次免费提问」是给**所有人**的（含免费用户），
 * 我们把这个 2 抄到了 PRO 上、同时把免费设成 0 —— 结果是免费用户一次都用不了，
 * 而会员也才 2 次。数字抄对了，归属抄错了。
 *
 * 现在：免费 3 次/天（句乐部 2 次，我们稍宽松），会员 20 次/天。
 * 会员真正的 AI 优势还有第二层：每日赠送钻石（见 MEMBER_DAILY_DIAMONDS），
 * 对应句乐部的「会员每月自动获得 10,000 颗钻石」。
 *
 * 成本口径：会员每天 20 次免费 + 30 钻（÷5 钻/次 = 6 次）= 26 次，
 * 按单次约 ¥0.007 估算 ≈ **¥5.5/月**，占 ¥29 月卡约 19%。
 */
export const FREE_AI_CHAT_PER_DAY = 3
export const PRO_AI_CHAT_PER_DAY = 20

/**
 * 会员每日赠送的钻石。
 *
 * 对应句乐部的「会员每月自动获得 10,000 颗钻石，在会员周期开始日重置」。
 *
 * 我们**不**用「每月 1 号发一大笔」：那需要定时任务，而本仓库没有定时任务
 * （见 `lib/commission-safety.ts` 的说明，它也是靠懒补偿规避的）。
 * 改为**按需懒发放** —— 用户每次进站时补发当日份，靠 `diamond_logs` 上的
 * 唯一索引（`uk_diamond_grant_day`）保证一天只发一次，不需要任何调度器。
 *
 * 钻石只用于 AI 助手 / 口语评测**超出每日免费额度之后**的消耗，即真金白银的调用，
 * 所以这个数字直接决定成本上限：30 钻 ÷ 5 钻/次 = 6 次/天。
 */
export const MEMBER_DAILY_DIAMONDS = 30

/**
 * AI 句子讲解（内部实现是 /api/knowledge/analyze）的每日额度。
 *
 * 与上两项不同，这一项**免费用户也有**（它有全局缓存兜底：同一个句子只要有
 * 任何人解析过，后续所有人命中缓存都不计费也不限流）。所以这里不是"免费没有"，
 * 而是"免费够用、会员更宽"：
 *
 *   免费 30 次/天 —— 一个学习者一天认真读 30 句新句子的解析，已经远超正常使用；
 *   会员 200 次/天 —— 给批量精读/刷题的人留出空间。
 *
 * 为什么要设每日上限：单次解析的 prompt 与响应都很长，是真金白银的调用。
 * 此前只有「20 次/小时」的窗口 —— 折算下来一天最多 480 次，且**没有任何每日封顶**。
 */
export const FREE_AI_ANALYZE_PER_DAY = 30
export const PRO_AI_ANALYZE_PER_DAY = 200

/**
 * 权益的兑付方式。`kind` 决定了它能不能算作会员卖点：
 *   - `content` ：内容解锁（本项目唯一真实门禁 = 每课试学句数）
 *   - `quota`   ：同一能力，会员每日次数更多（必须 pro > free）
 *   - `grant`   ：会员每日固定发放的资源（钻石）。免费用户拿不到，但不是"次数更多"
 *   - `lifetime`：终身会员专属（一次买断，永久有效）
 *   - `promoter`：推广权益。**免费**，任何注册用户均可加入，与付费档无关
 */
export type BenefitGate =
  | { kind: "content" }
  | { kind: "quota"; freePerDay: number; proPerDay: number }
  | { kind: "grant"; diamondsPerDay: number }
  | { kind: "lifetime" }
  | { kind: "promoter" }

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
    claim: `每天 ${PRO_AI_CHAT_PER_DAY} 次免费提问（免费用户每天 ${FREE_AI_CHAT_PER_DAY} 次），超出后消耗钻石`,
    gate: { kind: "quota", freePerDay: FREE_AI_CHAT_PER_DAY, proPerDay: PRO_AI_CHAT_PER_DAY },
  },
  {
    id: "ai-analyze",
    // 用户面统一叫「讲解」：内部代码里叫 analyze/解析，但那是对实现的描述。
    // 曾经价格页写「解析」、功能介绍页写「讲解」，同一个能力两个名字。
    label: "AI 句子讲解",
    claim: `每天 ${PRO_AI_ANALYZE_PER_DAY} 次讲解（免费用户每天 ${FREE_AI_ANALYZE_PER_DAY} 次）`,
    gate: {
      kind: "quota",
      freePerDay: FREE_AI_ANALYZE_PER_DAY,
      proPerDay: PRO_AI_ANALYZE_PER_DAY,
    },
  },
  {
    id: "member-diamonds",
    label: "每日赠送钻石",
    claim: `会员每天获得 ${MEMBER_DAILY_DIAMONDS} 颗钻石，用于 AI 助手与语音评测的超额消耗`,
    gate: { kind: "grant", diamondsPerDay: MEMBER_DAILY_DIAMONDS },
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
  "练习即得金币",
  `金币兑换会员天数（${COINS_PER_MEMBER_DAY} 金币 = 1 天，每月最多 ${MAX_MEMBER_DAYS_PER_MONTH} 天）与道具`,
]

/**
 * 终身会员专属权益。
 *
 * 这里**只有**学习权益。推广/佣金权益一律不在付费档里 —— 见文件头约束 3。
 */
export const LIFETIME_BENEFITS: readonly Benefit[] = [
  {
    id: "lifetime-access",
    label: "永久免费解锁全部会员功能",
    claim: "一次买断，终身有效，不再续费",
    gate: { kind: "lifetime" },
  },
]

/**
 * 推广权益：**免费**，任何注册用户均可加入。
 *
 * 与 LIFETIME_BENEFITS 严格分开，正是 2026-09-29 合规改造的核心 ——
 * 「取得推广资格」不能收任何费用（《禁止传销条例》第七条(二)）。
 * 这张表只能出现在独立的推广中心里，**不得**出现在价格页任何付费档的权益清单中，
 * 由单测把关。
 */
export const PROMOTER_BENEFITS: readonly Benefit[] = [
  {
    id: "promoter-invite",
    label: "专属邀请链接 / 二维码 / 海报",
    claim: "一键生成推广素材",
    gate: { kind: "promoter" },
  },
  {
    id: "promoter-commission-first",
    label: "首次付款佣金 50%",
    claim: "90 天归因窗口内的首购，按实际成交金额计算",
    gate: { kind: "promoter" },
  },
  {
    id: "promoter-commission-renew",
    label: "续费佣金 30%",
    claim: "90 天归因窗口内的续费，按实际成交金额计算",
    gate: { kind: "promoter" },
  },
  {
    id: "promoter-withdraw",
    label: "提现",
    // 口径按代码事实：partner/withdraw 只支持**全额提现**，没有"¥50 起"这个门槛。
    claim: "全额提现至微信零钱",
    gate: { kind: "promoter" },
  },
  {
    id: "promoter-dashboard",
    label: "实时数据看板",
    claim: "邀请数、转化率、待结算收益",
    gate: { kind: "promoter" },
  },
]

/**
 * 价格页对比表的列。
 *
 * `lifetime` 与 `quarterly` 是 2026-09-29 新增；此前只有 free/monthly/yearly/partner。
 * 列名从 `partner` 改为 `lifetime`：key 可以保留历史名（数据库 enum 不动），
 * 但**展示层的字段名应当表达语义**，否则下一个人会以为这一列卖的是推广资格。
 */
export interface ComparisonRow {
  feature: string
  free: string
  monthly: string
  quarterly: string
  yearly: string
  lifetime: string
}

/** 价格页对比表的「无此项」标记：渲染层据此显示为横杠。 */
export const NOT_APPLICABLE = "-"

/**
 * 价格单元格：**首期优惠价**（新用户首次购买）+ 标准价。
 *
 * 单价一律取自 `lib/pricing`，不在这里另写一份数字。
 *
 * 标签**分档措辞**，因为两类的「第二个价格」性质不同：
 *   - 月/季/年卡：老用户按期**续费**时付的就是它 → 标「续费」
 *   - 终身卡：没有续费这回事，老用户（已有付费记录的人）再买才付它 → 标「老用户」
 *
 * 无论哪种，这个价格都是**真实会被收取**的 —— 这正是「非虚构原价」的免责依据
 * （见 lib/pricing 的文件头）。把终身档也写「续费」会是一句假话。
 */
function priceCell(key: PlanKey, unit: string): string {
  const plan = findPlan(key)
  if (!plan) return NOT_APPLICABLE
  if (plan.lifetime) {
    return `${formatYuan(plan.firstAmount)} 终身（老用户 ${formatYuan(plan.standardAmount)}）`
  }
  return `${formatYuan(plan.firstAmount)}${unit}（续费 ${formatYuan(plan.standardAmount)}）`
}

/**
 * 价格页的功能对比表。
 *
 * 与改版前的关键差别是**多了「免费」这一列**：没有它，这张表只能回答
 * 「买哪个付费档」，永远回答不了「为什么要付费」。免费列的内容与
 * INCLUDED_FOR_EVERYONE / PRO_BENEFITS 保持一致。
 *
 * **2026-09-29 合规改造：删掉了「专属邀请链接 / 海报」「首次付款佣金 50%」
 * 「续费佣金 30%」「提现」这 4 行。** 它们此前挂在合伙人列，等于在价格页上
 * 把推广与赚钱当成付费商品的一部分卖。推广权益现在统一由 PROMOTER_BENEFITS
 * 表达，且对全部注册用户免费开放。
 */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    feature: "课程内容",
    free: `每课试学 ${FREE_TRIAL_SENTENCES} 句`,
    monthly: "全部课程",
    quarterly: "全部课程",
    yearly: "全部课程",
    lifetime: "全部课程",
  },
  {
    feature: "打字练习",
    free: "无限",
    monthly: "无限",
    quarterly: "无限",
    yearly: "无限",
    lifetime: "无限",
  },
  {
    feature: "跟读评分",
    free: `每天 ${FREE_PRONUNCIATION_PER_DAY} 次`,
    monthly: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
    quarterly: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
    yearly: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
    lifetime: `每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
  },
  {
    feature: "AI 私教助手",
    free: `每天 ${FREE_AI_CHAT_PER_DAY} 次`,
    monthly: `每天 ${PRO_AI_CHAT_PER_DAY} 次`,
    quarterly: `每天 ${PRO_AI_CHAT_PER_DAY} 次`,
    yearly: `每天 ${PRO_AI_CHAT_PER_DAY} 次`,
    lifetime: `每天 ${PRO_AI_CHAT_PER_DAY} 次`,
  },
  {
    feature: "AI 句子讲解",
    free: `每天 ${FREE_AI_ANALYZE_PER_DAY} 次`,
    monthly: `每天 ${PRO_AI_ANALYZE_PER_DAY} 次`,
    quarterly: `每天 ${PRO_AI_ANALYZE_PER_DAY} 次`,
    yearly: `每天 ${PRO_AI_ANALYZE_PER_DAY} 次`,
    lifetime: `每天 ${PRO_AI_ANALYZE_PER_DAY} 次`,
  },
  {
    feature: "会员每日钻石",
    free: NOT_APPLICABLE,
    monthly: `${MEMBER_DAILY_DIAMONDS} 颗/天`,
    quarterly: `${MEMBER_DAILY_DIAMONDS} 颗/天`,
    yearly: `${MEMBER_DAILY_DIAMONDS} 颗/天`,
    lifetime: `${MEMBER_DAILY_DIAMONDS} 颗/天`,
  },
  {
    feature: "间隔重复复习",
    free: "全部历史",
    monthly: "全部历史",
    quarterly: "全部历史",
    yearly: "全部历史",
    lifetime: "全部历史",
  },
  {
    feature: "学习统计",
    free: "深度统计",
    monthly: "深度统计",
    quarterly: "深度统计",
    yearly: "深度统计",
    lifetime: "深度统计",
  },
  {
    feature: "会员有效期",
    free: NOT_APPLICABLE,
    monthly: "按月",
    quarterly: "按季",
    yearly: "按年",
    lifetime: "永久终身",
  },
  {
    feature: "价格",
    free: "¥0",
    monthly: priceCell("monthly", "/月"),
    quarterly: priceCell("quarterly", "/季"),
    yearly: priceCell("yearly", "/年"),
    lifetime: priceCell("partner", ""),
  },
]

/**
 * 价格页对比表下方的一句说明。
 *
 * 这句话替换掉了原来的「合伙人会员额外获得推广权益」—— 那句是把推广当商品卖。
 * 现在的口径是「付费档之间只差时长与价格，推广对所有人免费」，
 * 与 LIFETIME_BENEFITS / PROMOTER_BENEFITS 的拆分保持一致。
 */
export const COMPARISON_NOTE =
  "四档付费会员的课程与功能完全相同，只差时长与价格。推广权益与任何付费档无关：所有注册用户都可以免费加入推广计划，按被推荐人的实际付费金额获得佣金。"
