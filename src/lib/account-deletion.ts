/**
 * 账号注销（自助）的规则与字段清空清单。
 *
 * ── 口径：清空「账户信息」，保留去标识化的历史与资金记录 ────────────────────
 *
 * 用户要的是"这个账号不再属于我"。因此：
 *
 *   · **清空**一切能指向某个自然人的信息：手机号、邮箱、微信 openid/unionid、
 *     微信 access/refresh token、昵称、头像、邀请码、首触归因明细（含 IP/UA）。
 *     手机号与 openid 是 UNIQUE，清掉之后同一个人才能重新注册（否则注册走
 *     find-or-create 会复用这条已注销的记录）。
 *   · **删除**用户自己产生的内容：生词本、句子笔记。它们只对本人有意义，
 *     注销后留着既没人能用、也没有留存理由。
 *   · **保留但去标识化**：练习记录、复习队列、打卡、钻石流水、订单、订阅、
 *     佣金。原因是它们要么是**法定要留**的财务凭证（支付订单、佣金），
 *     要么是**统计口径**的组成（练习量/新增/留存）。清除身份字段后这些行
 *     只剩一个内部 id，不再指向任何可识别的人。
 *   · **同时删除**：全部会话（全端登出）、该手机号下的验证码记录
 *     （验证码表按手机号存，本身就含 PII 与 IP，必须一起清）。
 *
 * ── 两处必须拦住的情况 ──────────────────────────────────────────────────────
 *
 *   1. **有未结清佣金的合伙人**：注销会把 partner_id 变成一个再也没人能登录的
 *      内部 id，钱就永久卡在那里。必须先提现/结清。
 *   2. **有在途提现**：转账正在路上，注销会让对账无从进行。
 *
 * 另外**管理员不能自助注销**：清空手机号会同时失去后台入口（管理员判定依赖
 * role 或手机号白名单），一旦误操作就得手工修库。这种情况走人工处理。
 *
 * 本模块是纯函数/常量，不引入 db —— 便于单测，也让"注销到底清了什么"
 * 有一份可直接阅读的清单（隐私政策里的表述必须与它一致）。
 */

/** 注销确认词：要求手动输入，避免误触，也避免"顺手调一下接口"就把账号删了。 */
export const DELETION_CONFIRM_PHRASE = "注销账号"

/**
 * 清空后写回 users.name 的占位名。
 *
 * 不写成 NULL 是因为后台列表需要一个可读标记 —— 否则一条没有昵称、没有手机号、
 * 没有 openid 的记录，看起来更像一条坏数据而不是"已注销"。
 */
export const DELETED_USER_NAME = "已注销用户"

/** 注销时从 users 行上**清空**的字段。 */
export function anonymizedProfile(): {
  phone: null
  email: null
  name: string
  avatar: null
  wechatOpenid: null
  wechatUnionid: null
  wechatAccessToken: null
  wechatRefreshToken: null
  wechatTokenExpiresAt: null
  inviteCode: null
  referredBy: null
  referralLockedUntil: null
  signupSource: null
  isPro: number
  proExpires: null
  isPartner: number
  partnerAgreedAt: null
  diamonds: number
  role: "user"
} {
  return {
    // ── 直接标识 ──
    phone: null,
    email: null,
    name: DELETED_USER_NAME,
    avatar: null,
    wechatOpenid: null,
    wechatUnionid: null,
    // ── 凭据（不清掉等于留了一把能代表该用户调微信接口的钥匙）──
    wechatAccessToken: null,
    wechatRefreshToken: null,
    wechatTokenExpiresAt: null,
    // ── 关系与归因 ──
    inviteCode: null,
    referredBy: null,
    referralLockedUntil: null,
    // signup_source 含 IP / UA / referrer，属于个人信息；渠道标签（signupChannel）
    // 只是"从哪个入口来"的分类，不含任何可识别信息，保留用于渠道统计。
    signupSource: null,
    // ── 权益类：账号已关闭，留着会被误当成"还有人在用" ──
    //（剩余会员时长与钻石在注销前会明确告知用户会失去）
    isPro: 0,
    proExpires: null,
    isPartner: 0,
    partnerAgreedAt: null,
    diamonds: 0,
    // 管理员身份必须一并摘掉：清空手机号后后台入口已不可用，
    // 留一个 role='admin' 的孤儿记录只会造成困惑
    role: "user",
  }
}

/**
 * 注销时必须删除的**用户自有内容**表。
 *
 * 这里写字符串而不是 drizzle 表对象，是为了让本模块保持零依赖（可单测）；
 * route.ts 里把名字映射回表对象并逐个 delete。
 */
export const USER_CONTENT_TABLES = ["user_notes", "wordbook_items"] as const

export interface DeletionBlockInput {
  /** 当前用户角色 */
  role: string | null | undefined
  isPartner: boolean
  /** 未结清佣金笔数（cooling + available，即"钱还没打出去"） */
  unsettledCommissionCount: number
  /** 在途提现笔数（pending + processing） */
  inFlightWithdrawalCount: number
}

export interface DeletionDecision {
  blocked: boolean
  /** 被拦时的中文原因（直接返回给客户端） */
  reason?: string
}

/** 是否允许这个账号自助注销。 */
export function decideAccountDeletion(input: DeletionBlockInput): DeletionDecision {
  // 管理员优先判：这是最容易造成"需要手工修库"的一种误操作
  if (input.role === "admin") {
    return {
      blocked: true,
      reason: "管理员账号不支持自助注销，请联系技术支持处理",
    }
  }

  if (input.inFlightWithdrawalCount > 0) {
    return {
      blocked: true,
      reason: "有一笔提现正在处理中，请等它完成后再注销",
    }
  }

  if (input.unsettledCommissionCount > 0) {
    return {
      blocked: true,
      reason: "你还有未结清的推广佣金，请先提现后再注销",
    }
  }

  return { blocked: false }
}

/** 校验注销确认词（调用方传的是请求体里的原始值）。 */
export function isConfirmPhraseValid(input: unknown): boolean {
  return typeof input === "string" && input.trim() === DELETION_CONFIRM_PHRASE
}
