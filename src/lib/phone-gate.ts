/**
 * 手机号强制绑定的判定与撞号策略。
 *
 * 纯模块、无服务端依赖：路由与页面共用同一份判定，测试也直接打这里。
 *
 * ── 为什么要强制绑定 ────────────────────────────────────────────────────────
 *
 * 微信扫码/授权登录建号时拿不到手机号，而手机号是唯一能把「同一个人用微信注册的
 * 号」和「用手机号注册的号」认成同一个人的凭据。不强制的话，同一个人会拥有两个
 * 账号、各带一半学习记录 —— 而系统**没有自助合并能力**（22 张表按 user_id 挂载，
 * 其中 8 个唯一约束在合并时会冲突，见 lib/auth 的既有说明）。
 *
 * ── 撞号为什么能自动处理 ────────────────────────────────────────────────────
 *
 * 关键是**在进站之前**就要求绑定：此时微信侧那个账号刚由关注事件建出来，
 * 还没有任何练习数据。所以撞号时不需要"合并两个有数据的账号"，只需要：
 *
 *     把微信身份（openid）转到手机号账号上，再把壳账号清空。
 *
 * 一旦用户已经练过，自动转移就会丢记录 —— 那种情况必须拒绝并让人工介入，
 * 所以 currentHasPracticeData 是硬闸门，不能省。
 */

export function needsPhoneBinding(input: {
  phone: string | null | undefined
  /**
   * 开发态登录旁路（cookie 值为 dev:<userId>）。本地开发与 e2e 的账号没有手机号，
   * 不该被拦在门外 —— 这与仓库既有的其它 dev 旁路是同一种取舍。
   */
  devBypass?: boolean
}): boolean {
  if (input.devBypass) return false
  return !(input.phone ?? "").trim()
}

export type BindCollisionVerdict =
  /** 手机号没人用过 → 直接绑到当前账号 */
  | { action: "bind" }
  /** 已经绑在当前账号上 */
  | { action: "already_bound" }
  /** 撞号，且可以把微信身份转到手机号账号上（壳账号还没有学习数据） */
  | { action: "transfer" }
  /** 撞号但不能自动处理，需要人工 */
  | { action: "refuse"; reason: string }

export interface BindCollisionInput {
  currentUserId: string
  /** 当前账号（微信壳账号）的 openid */
  currentWechatOpenid: string | null
  /** 该手机号所属的账号 id；null 表示没人用过 */
  existingUserId: string | null
  /** 手机号账号已经绑定的 openid（若与当前不同，说明是另一个微信号） */
  existingWechatOpenid: string | null
  /** 当前（微信壳）账号是否已有练习记录 —— 有的话自动转移会丢数据 */
  currentHasPracticeData: boolean
}

export function decideBindCollision(input: BindCollisionInput): BindCollisionVerdict {
  const { currentUserId, existingUserId } = input

  if (!existingUserId) return { action: "bind" }
  if (existingUserId === currentUserId) return { action: "already_bound" }

  // 已经有练习数据 → 绝不能自动转移（那会把这些记录留在被清空的壳账号上）。
  // 这一条是硬闸门：进站前绑定意味着正常情况下走不到这里。
  if (input.currentHasPracticeData) {
    return {
      action: "refuse",
      reason:
        "这个微信号已经练过内容了，无法自动与手机号账号合并（系统暂不支持数据合并）。请用手机号直接登录，或联系客服帮你处理。",
    }
  }

  // 手机号账号已经绑了**另一个**微信号 → 不能悄悄把它换掉
  if (input.existingWechatOpenid && input.existingWechatOpenid !== input.currentWechatOpenid) {
    return {
      action: "refuse",
      reason: "该手机号已绑定另一个微信号，请联系客服处理。",
    }
  }

  return { action: "transfer" }
}
