"use client"

import Link from "next/link"
import {
  BadgePercent,
  Bot,
  BookOpen,
  CheckCircle2,
  CreditCard,
  Crown,
  Diamond,
  FileText,
  GraduationCap,
  LifeBuoy,
  Link2,
  MessageSquare,
  Radio,
  Rocket,
  Send,
  Target,
  TrendingUp,
  UserRound,
  Users,
  Video,
  Zap,
} from "lucide-react"
import {
  ATTRIBUTION_WINDOW_DAYS,
  COMMISSION_COOLING_DAYS,
  COMMISSION_RATE,
  MIN_WITHDRAW_FEN,
  fmtFen,
} from "@/lib/partner-rules"
import { findPlan, formatYuan } from "@/lib/pricing"
import { BRAND } from "@/lib/brand"
import { PartnerCheckoutButton } from "../membership/PartnerCheckoutButton"

const partnerPlan = findPlan("partner")

/** 数字一律取自事实源，不在文案里写死 —— 改比例只改 lib/partner-rules。 */
const FIRST_PCT = `${COMMISSION_RATE.first * 100}%`
const RENEW_PCT = `${COMMISSION_RATE.renewal * 100}%`

const priceText = partnerPlan ? formatYuan(partnerPlan.firstAmount) : "¥699"
const standardText = partnerPlan ? formatYuan(partnerPlan.standardAmount) : "¥1999"

/** Hero 三枚胶囊。对应参考页的 hero-badge 行，但只写我们真实有的东西。 */
const heroBadges = [
  { icon: BadgePercent, text: `首次付款 ${FIRST_PCT} 分佣` },
  { icon: Link2, text: "专属链接 · 二维码 · 海报" },
  { icon: Rocket, text: "全站学习权益终身解锁" },
]

/**
 * 「为什么值得分享」两张卡 —— 对应参考页 .flow-cards。
 *
 * 参考页原话把受众需求写得很重（「永不枯竭的受众刚需」）。这一定性没问题，
 * 但「你只需把工具带给他们，需求自然会驱动他们订阅」这类表述接近效果承诺，
 * 所以保留了「需求真实存在」这个判断，去掉了对转化结果的断言。
 */
const whyCards = [
  {
    icon: BookOpen,
    title: "英语学习的困扰长期存在，需求不是被造出来的",
    desc: "「开不了口」是职场人与学生共有的困扰，缺的通常不是决心，而是一个能随时给出反馈的练习环境。你推荐的是一件自己用过的工具，不是一套话术。",
  },
  {
    icon: MessageSquare,
    title: "真实记录比硬广更有说服力",
    desc: "不必发惹人厌的广告。把练习记录、评分截图分享出去，当有人主动问「你最近在用什么」，分享就自然变成了对话。",
  },
]

/** 谁适合参与 —— 对应参考页 .audience-block。只描述场景，不承诺收益。 */
const personas = [
  {
    emoji: "🎓",
    title: "学生 / 备考党",
    desc: "在自习室与打卡群里记录学习日常，同伴之间的互相督促本身就是最自然的使用理由。",
  },
  {
    emoji: "🤱",
    title: "家长 / 知识分享者",
    desc: "在家长圈层里口碑扎实，分享自己真实用过的学习工具，比任何硬广都有说服力。",
  },
  {
    emoji: "👔",
    title: "职场人",
    desc: "外企或出海业务需要保持语感，把顺手的练习工具推荐给同事与客户，顺手也是互利。",
  },
  {
    emoji: "👨‍🏫",
    title: "独立教师 / 教培从业者",
    desc: "把产品布置成学员的课后练习入口，省下重复纠错的时间，同时获得渠道回报。",
  },
]

/** 分享渠道 —— 对应参考页 .channel-grid。平台规则由 promotion-materials 单独维护。 */
const channels = [
  {
    variant: "video" as const,
    badge: "动态展示 · 转化最猛",
    icon: Video,
    title: "抖音 / 快手 / 视频号 / 直播带练",
    desc: "打字练习的过程本身就有画面：从看着中文想半天，到能整句连打下来。录一段屏幕，或者开一场连续打卡的直播，进度是看得见的。",
    tags: ["#沉浸式自律打卡", "#社恐学英语", "#中译英实操"],
  },
  {
    variant: "social" as const,
    badge: "深度种草 · 长尾效应好",
    icon: FileText,
    title: "小红书 / 公众号 / 朋友圈",
    desc: "图文天然具备留存属性。整理你练过的地道表达、发一张正确率对比图，或写一篇自己怎么把英语「用出来」的心得。这类内容能持续被搜到。",
    tags: ["#英语逆袭日记", "#宝藏APP分享", "#雅思口语备考方案"],
  },
]

/**
 * 分享场景卡 —— 对应参考页 .social-proof-grid。
 *
 * ⚠️ 这里**刻意不放任何收益数字与具体人名**。参考页写的是
 * 「林雅 (Lisa) 上月佣金已提现 ¥12,450」「Mark 教练 历史累计总分红 ¥186,200+」——
 * 那是编造的人物与金额，属于虚假宣传，也是《广告法》与平台规则都禁止的
 * 效果证明。本页只描述「谁在什么场景下分享」，金额一律不出现。
 */
const shareScenes = [
  {
    icon: UserRound,
    name: "备考分享",
    role: "留学 / 考研人群",
    desc: "在备考群里同步自己的打卡进度，把练习记录当作陪伴式的内容来发，而不是广告。",
    scene: "分享形式",
    sceneVal: "打卡记录",
  },
  {
    icon: Users,
    name: "家长圈层",
    role: "亲子教育分享者",
    desc: "给粉丝讲清楚「为什么是打字而不是背单词」，用自己的使用体验回答疑问。",
    scene: "分享形式",
    sceneVal: "使用心得",
  },
  {
    icon: GraduationCap,
    name: "教学场景",
    role: "独立讲师 / 教培从业者",
    desc: "把产品作为学员的课后指定练习入口，让练习可追踪，省下反复纠正的精力。",
    scene: "分享形式",
    sceneVal: "课后布置",
  },
]

/**
 * 产品实力 —— 对应参考页 .product-trust。
 *
 * ⚠️ 参考页这一段讲的是**他方公司的团队与历史**（「苏州德微软件研发核心团队」
 * 「公司成立于 2015 年」「研发中心位于苏州工业园区独墅湖畔」）。搬到本页等于
 * 让「句学社」冒认别家公司的历史与团队，是虚假宣传，因此整段不搬。
 * 这里改讲**本产品真实具备的能力**，落点与 lib/product-features.ts 对齐。
 */
const trustItems = [
  {
    icon: Bot,
    title: "逐词判分，错在哪当场可见",
    desc: "每敲完一个词立刻判定，不必等整句提交；打错的词标红重敲，不会静默吞掉按键。",
  },
  {
    icon: Target,
    title: "以「能用出来」为目标",
    desc: "看中文、敲英文，练的是实际输出能力。练完的词可查看释义、音标与词性，句子讲解按需唤出。",
  },
  {
    icon: Users,
    title: "课程按场景与难度分级",
    desc: "覆盖生活日常、职场办公、旅行出行、校园学习等场景，按难度递进；非会员也能试学每门课的开头几句。",
  },
]

/** 三步流程 —— 对应参考页「只需 3 步极简开启」。 */
const steps = [
  {
    icon: Link2,
    title: "1. 获取专属身份",
    desc: "在推广中心一键生成带结算标记的专属邀请链接、二维码或分享海报。",
  },
  {
    icon: Send,
    title: "2. 真实分享体验",
    desc: "参考我们提供的基础素材，结合自己的真实学习感受分享出去 —— 不必发硬广。",
  },
  {
    icon: CreditCard,
    title: "3. 佣金按成交结算",
    desc: `好友通过你的链接注册并付费后，佣金按实际成交金额计算，冷静期 ${COMMISSION_COOLING_DAYS} 天后可提现。`,
  },
]

/** 服务与支持 —— 对应参考页 CTA 面板左下的四张小卡。 */
const supportItems = [
  { title: "推广中心说明", desc: "后台入口、邀请链接与物料生成的常用功能说明。" },
  { title: "推广素材与规则", desc: "可参考的产品介绍、分平台分享素材与合作规则。" },
  { title: "结算与提现说明", desc: "佣金口径、冷静期与提现流程的基础说明。" },
  { title: "基础技术支持", desc: "账号、链接、结算等基础问题提供必要的客服协助。" },
]

const faqs = [
  {
    q: "费用是一次性的还是每年交？",
    a: "一次性的。支付后永久获得合伙人版的推广资格与全站终身学习权益，没有后续隐藏费用，也不需要每年续费。",
  },
  {
    q: "我没有做博主的经验能做吗？",
    a: "不一定需要有博主经验，但建议你对英语学习有一定热情，愿意持续体验产品、理解学习中的痛点，并具备基本的表达能力。",
  },
  {
    q: "佣金按什么计算？",
    a: `首次付款 ${FIRST_PCT}、续费 ${RENEW_PCT}，依据是被推荐人的实际成交金额，而不是发展人员的数量。仅单级推广：你推荐的朋友再推荐他人，你不从后者获得任何收益。佣金收入需依法申报纳税，平台按规定履行扣缴与报送义务。`,
  },
  {
    q: "什么时候能提现？有门槛吗？",
    a: `被推荐人在注册后 ${ATTRIBUTION_WINDOW_DAYS} 天归因窗口内付款才产生佣金。佣金入账后有 ${COMMISSION_COOLING_DAYS} 天冷静期，之后转为可提现；最低提现额为 ${fmtFen(MIN_WITHDRAW_FEN)}，全额可提现至微信零钱。`,
  },
  {
    q: "成为合伙人后能直接用产品吗？",
    a: "可以。合伙人版包含畅学版的全部学习权益，永久有效、无需续费 —— 自己先用明白，分享才站得住脚。",
  },
  {
    q: "推广时有需要注意的规则吗？",
    a: "有。仅单级推广，不存在多层级分销或团队计酬；佣金按被推荐人的实际成交金额计算，退款或撤单会同步冲正；推广时须遵守各平台的发布规则，不得使用夸大或承诺收益的表述。",
  },
]

/**
 * 推广中心 · 未开通页（合伙人版招募页）。
 *
 * ── 2026-10-10 变更（⚠️ 未经律师复核，改这个文件之前先读）────────────────────
 *
 * ⚠️ **这一页从「免费加入」改回了「付费开通合伙人版」。**
 *
 * 2026-09-29 的合规改造曾把它改成纯免费页：没有任何价格、没有付款入口，
 * 唯一动作是同意《推广合作协议》（写入 `partner_agreed_at` 留档）。
 * 理由是「付钱买到发展他人加入的资格」正是《禁止传销条例》第七条(二)
 * 「变相入门费」在**经营对象**层面的呈现。
 *
 * 2026-10-10 为对齐句游英语的合伙人版，把推广权益重新绑回 ¥699 商品，
 * 因此这一页重新出现价格与购买入口 —— 上述法律风险随之恢复。
 * 这对应 docs/distribution-compliance.md:27-28 的复核触发条件，复核尚未进行；
 * 决策方已书面确认承担风险。见 docs/membership-alignment-risk-2026-10.md。
 *
 * ── 版式对齐与文案边界（2026-10-10）─────────────────────────────────────────
 *
 * 版式按句游英语「句游知识合伙人计划」页重建（样式见 ./partner-recruit.css）：
 * hero 主视觉 → 为什么（flow-cards）→ 谁适合参与（audience-block）→
 * 时代红利（trend-wrapper）→ 渠道矩阵（channel-grid）→
 * 分享场景（social-proof-grid）→ 产品实力（product-trust）→ 品牌故事 →
 * 三步流程（steps-row）→ 核心权益面板（cta-panel）→ FAQ（faq-grid）→ 底部 CTA。
 *
 * 但有三类内容**没有**照搬，原因不是风格偏好：
 *
 * 1. **他人企业身份。** 参考页写「苏州德微软件研发核心团队」「公司成立于
 *    2015 年」「研发中心位于苏州工业园区独墅湖畔」「品牌图腾：蓝胖鱼」——
 *    那是句游英语开发方的事实。搬到本页等于让「句学社」冒认别家公司的
 *    历史与团队，属于虚假宣传，与合规无关，故整段不搬，改为讲本产品
 *    真实具备的能力（与 lib/product-features.ts 对齐）。
 *
 * 2. **虚构收入见证。** 参考页的「林雅 (Lisa) 上月佣金已提现 ¥12,450」
 *    「Mark 教练 历史累计总分红 ¥186,200+」是编造的具体人物与确切金额。
 *    用编造的收益示例促成交易同样是虚假宣传。本页因此**不设**任何收入
 *    数字见证；shareScenes 只描述分享场景，不承诺收益、不出现金额。
 *
 * 3. **上限承诺与倒计时。** 参考页的「首单至高 60%」「续费至高 40%」与
 *    「首批优惠席位仅剩 47 例 / 500 限额」与本仓库真实佣金比例（50%/30%）
 *    和真实库存不符，且限时/限量话术本身即《禁止传销条例》与广告法关注的
 *    表述。本页比例一律从 lib/partner-rules 取真实值，不做人工稀缺性暗示。
 *
 * 措辞仍严格限定为「按被推荐人的**实际付费金额**获得佣金」，
 * 不出现「零风险」「躺赚」「月入过万」「团队」「下线」等词
 * （禁用词清单见 docs/distribution-compliance.md 第七节）。
 * 护栏单测：src/__tests__/membership-benefits.test.ts 与 promotion-materials.test.ts。
 */
export default function PartnerJoin() {
  return (
    <div className="partner-wrap">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="hero-banner">
          <div className="content">
            <span className="hero-label">
              <Diamond />
              知识变现 · 合伙人计划
            </span>
            <h1>
              成为 <span>{BRAND.nameZh}</span> 合作伙伴
            </h1>
            <p>
              {BRAND.tagline}。在这里，你的每一次练习记录、每一次真实分享，
              都能按实际成交转化为看得见的回报。
            </p>
            <div className="hero-badges">
              {heroBadges.map((b) => (
                <div key={b.text} className="hero-badge">
                  <b.icon />
                  {b.text}
                </div>
              ))}
            </div>
            <div className="hero-actions">
              <PartnerCheckoutButton className="btn-hero">
                <Zap />
                立即开通合伙人版
              </PartnerCheckoutButton>
            </div>
          </div>
        </div>

        {/* ── 为什么值得分享 ───────────────────────────────────────────────── */}
        <div className="story-section">
          <h2 className="story-title">为什么分享学习工具是件顺理成章的事？</h2>
          <div className="flow-cards">
            {whyCards.map((c) => (
              <div key={c.title} className="flow-card">
                <div className="flow-icon">
                  <c.icon />
                </div>
                <div className="flow-text">
                  <h3>{c.title}</h3>
                  <p>{c.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 谁适合参与 ───────────────────────────────────────────────────── */}
        <div className="story-section">
          <div className="audience-block">
            <div className="aud-left">
              <h3>谁适合参与？</h3>
              <p>其实就是像你一样，愿意把学习这件事持续下去的人。</p>
            </div>
            <div className="aud-right">
              {personas.map((p) => (
                <div key={p.title} className="aud-item">
                  <h4>
                    <span aria-hidden="true">{p.emoji}</span>
                    {p.title}
                  </h4>
                  <p>{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 时代红利 ─────────────────────────────────────────────────────── */}
        <div className="story-section">
          <div className="trend-wrapper">
            <div className="trend-glow-1" />
            <div className="trend-glow-2" />
            <div className="trend-block">
              <div className="trend-text">
                <div className="trend-tag">
                  <Radio />
                  洞察内容趋势
                </div>
                <h3>
                  内容平台让 <span>分享</span> 与 <span>被看见</span> 的门槛前所未有地低
                </h3>
                <p>
                  过去做推广要有渠道、有预算；现在一条真实的记录就可能被推到对的人面前。
                  变化的是分发方式，不变的仍然是<strong>产品本身要好用</strong> ——
                  工具不行，流量来了也留不住。
                </p>
                <p>
                  「打字练习」这件事天然适合被展示：从盯着中文想不出词，到能整句敲下来，
                  这个过程有画面、有对比、也有说服力。你不需要出镜，只需分享
                  <span className="trend-hl">自己真实的进步过程</span>。
                </p>
              </div>
              <div className="trend-visual">
                <div className="trend-tag">
                  <TrendingUp />
                  为什么它适合被分享
                </div>
                <p className="trend-visual-line">看得见的进度 · 可复制的练习方式</p>
                <p className="trend-visual-line is-strong">
                  分享的是<span>真实使用</span>，而不是话术
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── 渠道矩阵 ─────────────────────────────────────────────────────── */}
        <div className="story-section">
          <h2 className="story-title">不同平台，不同的分享方式</h2>
          <div className="channel-grid">
            {channels.map((c) => (
              <div key={c.title} className={`channel-box ${c.variant}`}>
                <div className="badge">{c.badge}</div>
                <div className="channel-body">
                  <h4>
                    <c.icon />
                    {c.title}
                  </h4>
                  <p>{c.desc}</p>
                  <div className="tag-list">
                    {c.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 分享场景（不含收益数字）───────────────────────────────────────── */}
        <div className="story-section">
          <h2 className="story-title">大家通常在什么场景下分享？</h2>
          <div className="social-proof-grid">
            {shareScenes.map((s) => (
              <div key={s.name} className="testm-card hover-up">
                <div className="tm-head">
                  <div className="tm-avatar">
                    <s.icon />
                  </div>
                  <div>
                    <strong className="tm-name">{s.name}</strong>
                    <span className="tm-role">{s.role}</span>
                  </div>
                </div>
                <p className="tm-desc">{s.desc}</p>
                <div className="tm-scene">
                  <span>{s.scene}</span>
                  <strong>{s.sceneVal}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 产品实力 ─────────────────────────────────────────────────────── */}
        <div className="story-section product-trust-section">
          <h2 className="story-title">产品本身站得住，推荐才有底气</h2>
          <div className="product-trust">
            <div className="trust-content">
              <h3>给别人推荐产品，也是在质押自己的信用</h3>
              <p>
                所以我们更愿意把产品能力说清楚，而不是把结论喊得很大声。
                以下是它真正在做的事：
              </p>
              <div className="cta-feat-list">
                {trustItems.map((t) => (
                  <div key={t.title} className="cta-feat">
                    <div className="cta-feat-check">
                      <t.icon />
                    </div>
                    <div>
                      <strong className="cta-feat-title">{t.title}</strong>
                      <span className="cta-feat-desc">{t.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p>
                这是一次你能够自己先验证的推荐 —— 自己练明白了，再决定要不要分享。
              </p>
            </div>
            <div className="trust-visual">
              <Bot />
            </div>
          </div>
        </div>

        {/* ── 品牌故事 ─────────────────────────────────────────────────────── */}
        <div className="story-section">
          <div className="brand-card">
            <div>
              <span className="brand-kicker">BRAND</span>
              <h3>为什么是「打字」这件事</h3>
              <p>
                看懂一个句子，和能自己写出这个句子，中间隔着一道很难跨过的坎。
                我们选择用「看中文、敲英文」这个最朴素的方式去补上它 ——
                因为只有能写出来的表达，才算真的属于你。
                <br />
                <br />
                这也是这套系统希望帮到每一位使用者的地方：不是把英语讲得多么玄妙，
                而是让你在需要开口、需要动笔的时候，手上有东西可用。
              </p>
            </div>
            <div className="brand-visual">
              <Zap />
            </div>
          </div>
        </div>

        {/* ── 三步流程 ─────────────────────────────────────────────────────── */}
        <div className="story-section">
          <h2 className="story-title">只需 3 步，开启推广之旅</h2>
          <div className="steps-row">
            <div className="step-line" />
            {steps.map((s) => (
              <div key={s.title} className="step-col hover-up">
                <div className="step-badge">
                  <s.icon />
                </div>
                <h4>{s.title}</h4>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 核心权益面板 ─────────────────────────────────────────────────── */}
        <div className="story-section">
          <h2 className="story-title">开通合伙人版，你会得到什么</h2>
          <div className="cta-panel">
            <div className="cta-inner">
              <div className="cta-col-left">
                <h4 className="cta-h4 is-gold">
                  <Crown />
                  双项核心权益
                </h4>
                <div className="cta-feat-list">
                  <div className="cta-feat">
                    <div className="cta-feat-check">
                      <CheckCircle2 />
                    </div>
                    <div>
                      <strong className="cta-feat-title">全站学习权益，终身有效</strong>
                      <span className="cta-feat-desc">
                        包含畅学版全部学习权益 —— 全部课程、跟读评分、AI 私教助手与句子讲解额度。
                        一次买断，不再续费。
                      </span>
                    </div>
                  </div>
                  <div className="cta-feat">
                    <div className="cta-feat-check">
                      <CheckCircle2 />
                    </div>
                    <div>
                      <strong className="cta-feat-title">
                        首次 {FIRST_PCT} · 续费 {RENEW_PCT} 推广分佣
                      </strong>
                      <span className="cta-feat-desc">
                        被推荐人注册后 {ATTRIBUTION_WINDOW_DAYS} 天内付款即产生佣金，按实际成交金额计算；
                        后续续费同样计佣。仅单级推广。
                      </span>
                    </div>
                  </div>
                </div>

                <h4 className="cta-h4 is-blue">
                  <LifeBuoy />
                  服务与支持
                </h4>
                <div className="cta-sub-grid">
                  {supportItems.map((s) => (
                    <div key={s.title} className="cta-sub-card hover-up">
                      <strong className="cta-sub-title">{s.title}</strong>
                      <span className="cta-sub-desc">{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="cta-price-box">
                <div className="cta-kicker">合伙人版</div>
                <div className="cta-price">
                  <span>¥</span>
                  {priceText.replace("¥", "")}
                </div>
                <p className="cta-price-sub">/ 终身权益 + 推广资格</p>
                <div className="cta-divider" />
                <PartnerCheckoutButton className="cta-join-btn">
                  马上加入
                </PartnerCheckoutButton>
                <p className="cta-note">
                  <Zap />
                  标准价 {standardText}，首期优惠价以实际成交为准
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── 推广规则（合规红线，不可删）───────────────────────────────────── */}
        <div className="story-section">
          <h2 className="story-title">推广规则</h2>
          <ul className="rule-list">
            <li>仅单级推广，不存在多层级分销或团队计酬</li>
            <li>佣金按被推荐人的实际成交金额计算，退款或撤单会同步冲正</li>
            <li>佣金收入需依法申报纳税，平台按规定履行扣缴与报送义务</li>
            <li>推广时须遵守各平台规则，不得使用夸大或承诺收益的表述</li>
          </ul>
        </div>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <div className="story-section">
          <h2 className="story-title">加入前你可能关心的问题</h2>
          <div className="faq-grid">
            {faqs.map((f) => (
              <div key={f.q} className="faq-card hover-up">
                <strong className="faq-q">
                  <MessageSquare />
                  {f.q}
                </strong>
                <p className="faq-a">{f.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 底部 CTA ─────────────────────────────────────────────────────── */}
        <div className="bottom-cta">
          <PartnerCheckoutButton className="btn-massive">
            <Rocket />
            前往获取我的合伙人资格
          </PartnerCheckoutButton>
          <p>
            {priceText} 开通合伙人版，在分享真实学习体验的同时获得相应权益与合作支持。
            开通即视为已阅读并同意{" "}
            <Link href="/partner-agreement" target="_blank">
              《合伙人推广合作协议》
            </Link>
            。
          </p>
        </div>
      </div>
  )
}
