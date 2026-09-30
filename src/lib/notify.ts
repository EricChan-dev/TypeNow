import { db } from "@/lib/db"
import { notifications, users } from "@/lib/db/schema"
import { and, desc, eq, gte, isNull, notInArray, sql, type SQL } from "drizzle-orm"
import { affectedRows } from "@/lib/db/affected-rows"
import { sendNotificationSms } from "@/lib/aliyun-sms"
import { isWeChatOAConfigured, sendOACustomerMessage, sendOATemplateMessage } from "@/lib/wechat"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import {
  FREQUENCY,
  buildMessage,
  decideSend,
  isOptedOut,
  smsPracticeCount,
  type BuiltMessage,
  type LifecycleChannel,
  type LifecycleScenario,
} from "@/lib/lifecycle-scenarios"

/**
 * 主动触达的发送编排：**退订 → 频控 → 占用幂等位 → 按渠道优先序发送 → 落状态**。
 *
 * "什么时候该发 / 能不能发 / 发什么"的纯判断都在 lib/lifecycle-scenarios.ts
 * （那里可完整单测）；本文件只负责顺序与落库。
 *
 * ── 顺序为什么不能变 ────────────────────────────────────────────────────────
 *
 * 1. **先查退订**，且必须在最前面。退订一旦能被任何逻辑绕过，后果是用户投诉 +
 *    公众号接口权限风险 —— 那是这套体系里最贵的失败模式（§11.5 ⑤）。
 * 2. **再查频控**。被频控拦下的消息**不写库**：下一轮扫描还要重新评估，
 *    写库会白占掉幂等位，让这条消息永远发不出去。
 * 3. **再占用幂等位**（先写占位、再发送）。顺序反了会双发 ——
 *    与 lib/trial.ts 的 trial_claimed_at 同一个道理。
 * 4. **最后发送并按结果落状态**。
 *
 * ── 渠道降级 ────────────────────────────────────────────────────────────────
 *
 * 场景声明了渠道优先序（如年卡到期是 template → sms）。逐个尝试，任一成功即停。
 * 全部失败时区分两种情况：
 *   · 全是 `not_configured`（模板还没批下来、用户没手机号、没关注公众号）
 *     → 记 `skipped`。这是**预期内**状态（§11.6 的模板审核要等 1–3 天），
 *       记成 failed 会让重试扫描每天重试两遍，日志噪声淹没真正的故障。
 *   · 只要有一个是真正的失败 → 记 `failed`，可被重试扫描拾起（有 attempts 上限）。
 *
 * ── 幂等键为什么不含 channel（对 §11.5 ③ 的修正）──────────────────────────
 *
 * 键是 `(user_id, scenario, period_key)`。channel 是"送达方式"而非"消息的身份"：
 * 同一场景在同一周期只该发一条，用哪个渠道送达是降级的结果。把 channel 放进键
 * 会允许同一场景在一个周期内最多发三条，恰好制造出我们要避免的骚扰。
 * 因此占位行的 channel 会被**更新**为实际送达的渠道。
 */

/** 发送所需的目标信息。由扫描路由一次性查好传入，避免这里反复查库。 */
export interface NotifyTarget {
  userId: string
  /** 公众号 openid；没关注/没绑定的用户为 null */
  openid: string | null
  phone: string | null
  nickname: string | null
  /** 退订时间；非 null = 已退订 */
  optOutAt: Date | null
}

export interface NotifyInput {
  scenario: LifecycleScenario
  /** 幂等键的第三列，见 00032 与 lifecycle-scenarios 的 periodKey 说明 */
  periodKey: string
  target: NotifyTarget
  /** 到期类场景必填（用于文案里的到期日） */
  expiry?: Date
  tierLabel: string
  practicedSentences: number
  pendingReview: number
  /** 点击模板消息后的落地页。转化设计放那里，不放在消息里（§11.4） */
  landingUrl?: string
  /** 频控状态（由 getFrequencyState 查好后传入） */
  frequency: FrequencyState
  now?: Date
}

export type NotifyOutcome =
  | { status: "sent"; channel: LifecycleChannel }
  | { status: "skipped"; reason: "opted_out" | "cooldown" | "weekly_cap" | "no_usable_channel" | "not_configured" }
  | { status: "duplicate" }
  | { status: "failed"; channel: LifecycleChannel; error: string }
  | { status: "db_unavailable" }

/** 失败重试上限。超过就放弃，避免一条坏数据被永远重试。 */
export const MAX_ATTEMPTS = 3

/** 落库时截断，避免异常堆栈把 TEXT 列撑大。 */
function truncate(s: string, n = 500): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/**
 * 判断某场景对该用户有哪些**当前可用**的渠道（不查库，只看配置与身份）。
 *
 * 顺序即场景声明的优先级：模板（免费、无窗口）→ 客服（免费、48h 窗口）
 * → 短信（每条 ¥0.045，只在年卡这类高价值触点用）。见 §11.2 的能力表。
 */
export function usableChannels(
  scenario: LifecycleScenario,
  target: NotifyTarget
): LifecycleChannel[] {
  return scenario.channels.filter((ch) => {
    switch (ch) {
      case "template": {
        // ⚠️ 除了 openid，还**必须**要求该场景的模板 ID 已配置。
        //
        // 只判 openid 会踩一个很隐蔽的坑：模板还没批下来（§11.6 要等 1–3 天）时
        // 扫描照样会占掉幂等位并记 skipped，于是等模板可用时，
        // 这批用户**已经"用过"这次到期提醒了** —— 而到期提醒一个会员周期
        // 只有一次机会，丢了就永远丢了。所谓"最高价值的触点"就这么没了，
        // 而且日志里只有一片 skipped，看不出任何异常。
        const templateId = scenario.templateIdEnv
          ? process.env[scenario.templateIdEnv] ?? ""
          : ""
        return !!target.openid && !!templateId
      }
      case "customer_service":
        // 客服消息要求公众号凭据本身可用（48h 窗口由微信侧判定，我们判不了）
        return !!target.openid && isWeChatOAConfigured()
      case "sms":
        // 短信要手机号，且模板必须已配置（未配置等于渠道不存在）
        return !!target.phone && !!process.env.ALIYUN_SMS_NOTIFY_TEMPLATE_CODE
      default:
        return false
    }
  })
}

/** 真正发出一个渠道的消息。 */
async function deliver(
  channel: LifecycleChannel,
  target: NotifyTarget,
  scenario: LifecycleScenario,
  message: BuiltMessage,
  input: NotifyInput
): Promise<{ ok: true } | { ok: false; error: string; notConfigured: boolean }> {
  switch (channel) {
    case "template": {
      const templateId = scenario.templateIdEnv
        ? process.env[scenario.templateIdEnv] ?? ""
        : ""
      const r = await sendOATemplateMessage(
        target.openid!,
        templateId,
        message.templateData,
        input.landingUrl
      )
      return r.ok
        ? { ok: true }
        : { ok: false, error: r.error, notConfigured: r.reason === "not_configured" }
    }

    case "customer_service": {
      // ⚠️ 先自己判一次"公众号是否配置"，不能只靠 sendOACustomerMessage 的布尔返回。
      //
      // 那个函数吞掉所有异常只回 false，所以"凭据没配"和"网络抖了一下"在它眼里
      // 长得一样。而对主动触达来说这两者的处理**必须相反**：
      //   · 没配  → skipped，不重试（否则每天两轮扫描都在重试一个永远不会成功的请求）
      //   · 网络失败 → failed，可以重试
      // 实测踩过：模板未配 + 客服未配时，整条记录被判成 failed 而不是 skipped。
      if (!isWeChatOAConfigured()) {
        return { ok: false, error: "公众号未配置", notConfigured: true }
      }
      const ok = await sendOACustomerMessage(target.openid!, message.body)
      return ok ? { ok: true } : { ok: false, error: "客服消息发送失败", notConfigured: false }
    }

    case "sms": {
      const templateCode = process.env.ALIYUN_SMS_NOTIFY_TEMPLATE_CODE ?? ""
      // 参数名（tier / date / stats）必须与阿里云短信模板里的 ${变量} 完全一致，
      // 一个字母都不能差 —— 不一致会在**用户该收到提醒的那一刻**发送失败。
      //
      // ⚠️ 不传退订字样。两个原因：
      //   ① 短信模板的参数是固定的，退订提示若要有，必须烧在模板正文里；
      //   ② 我们**没有短信入站回复的处理能力**（阿里云不提供回复回调），
      //      承诺"回T退订"却做不到，比不写更糟。退订入口只有设置页与公众号指令。
      // 一次都没练过就不发这条短信：模板正文是「你已练习${count}句」，
      // count 只能是纯数字，渲染出来就是「你已练习0句」—— 一句负价值的话。
      // 返回 notConfigured 语义（→ skipped、不重试），不是 failed。
      const count = smsPracticeCount(input.practicedSentences)
      if (count === null) {
        return { ok: false, error: "用户尚无练习记录，不发标注句数的短信", notConfigured: true }
      }
      const r = await sendNotificationSms(target.phone!, templateCode, {
        tier: input.tierLabel,
        // ⚠️ 必须用上海日历日，不能用 toISOString().slice(0,10)（那是 UTC）：
        //    到期时刻若落在上海时间 00:00~08:00，UTC 会退到前一天，于是
        //    **同一次到期，微信说 10-01、短信说 09-30**，用户看到两个日期。
        date: input.expiry ? toShanghaiDateStr(input.expiry) : "",
        // 纯数字，"句"在模板正文里（阿里云「数量」属性不允许带单位）
        count: String(count),
      })
      return r.ok
        ? { ok: true }
        : { ok: false, error: r.error, notConfigured: r.reason === "not_configured" }
    }
  }
}

/**
 * 发送一条主动触达消息。
 *
 * 返回 `duplicate` 表示这个 (用户, 场景, 周期) 组合已经发过 ——
 * 这是**正常路径**（扫描一天跑两次，第二次必然重复），不是错误，调用方不该记 warning。
 */
export async function sendLifecycleMessage(input: NotifyInput): Promise<NotifyOutcome> {
  if (!db) return { status: "db_unavailable" }
  const database = db
  const now = input.now ?? new Date()
  const { scenario, target, periodKey } = input

  // ① 退订 —— 必须在任何其他判断之前
  if (isOptedOut(target.optOutAt)) {
    return { status: "skipped", reason: "opted_out" }
  }

  // ② 频控 —— 被拦下时**不写库**（下一轮还要重新评估）
  const decision = decideSend({
    isExpiryKind: scenario.expiryKind,
    nonExpirySentInWindow: input.frequency.nonExpirySentInWindow,
    lastSentAt: input.frequency.lastSentAt,
    now,
  })
  if (!decision.allowed) {
    return { status: "skipped", reason: decision.reason }
  }

  // ③ 先定候选渠道。一个都没有就跳过且**不占位** ——
  //    模板审核通过后（1–3 天）这条消息应当还能补发。
  const candidates = usableChannels(scenario, target)
  if (candidates.length === 0) {
    return { status: "skipped", reason: "no_usable_channel" }
  }

  const message = buildMessage({
    scenario,
    nickname: target.nickname,
    expiry: input.expiry,
    practicedSentences: input.practicedSentences,
    pendingReview: input.pendingReview,
    tierLabel: input.tierLabel,
  })

  // ④ 占位（先占位再发送，防并发重复）。
  //    channel 先填第一个候选，成功后再更新为实际送达的那个。
  const inserted = await database
    .insert(notifications)
    .ignore()
    .values({
      userId: target.userId,
      scenario: scenario.key,
      channel: candidates[0],
      periodKey,
      status: "pending",
      title: message.title,
      body: truncate(message.body),
    })

  const where = and(
    eq(notifications.userId, target.userId),
    eq(notifications.scenario, scenario.key),
    eq(notifications.periodKey, periodKey)
  )

  // affectedRows === 0 → 唯一键挡住了：这个周期已经发过（或正在发）
  if (affectedRows(inserted) === 0) {
    return { status: "duplicate" }
  }

  // ⑤ 逐个渠道尝试，任一成功即停
  const failures: { channel: LifecycleChannel; error: string; notConfigured: boolean }[] = []

  for (const ch of candidates) {
    const outcome = await deliver(ch, target, scenario, message, input)
    if (outcome.ok) {
      await database
        .update(notifications)
        .set({
          status: "sent",
          sentAt: now,
          channel: ch,
          error: null,
          attempts: sql`${notifications.attempts} + 1`,
        })
        .where(where)
      return { status: "sent", channel: ch }
    }
    failures.push({ channel: ch, error: outcome.error, notConfigured: outcome.notConfigured })
  }

  // ⑥ 全部渠道失败。全是"预期内不可用"就记 skipped，否则记 failed（可重试）。
  const allNotConfigured = failures.every((f) => f.notConfigured)
  const realFailure = failures.find((f) => !f.notConfigured)

  await database
    .update(notifications)
    .set({
      status: allNotConfigured ? "skipped" : "failed",
      // 记录每个渠道的失败原因，便于一次看清"为什么一条都没发出去"
      error: truncate(failures.map((f) => `${f.channel}: ${f.error}`).join(" | ")),
      attempts: sql`${notifications.attempts} + 1`,
    })
    .where(where)

  if (allNotConfigured) {
    return { status: "skipped", reason: "not_configured" }
  }
  return {
    status: "failed",
    channel: realFailure!.channel,
    error: realFailure!.error,
  }
}

// ─── 频控与退订所需的查询 ────────────────────────────────────────────────────

export interface FrequencyState {
  /** 过去 FREQUENCY.windowDays 天内发给该用户的**非到期类**条数 */
  nonExpirySentInWindow: number
  /** 上一次任意主动消息的发送时刻；从未发过为 null */
  lastSentAt: Date | null
}

/**
 * 查该用户的频控状态。
 *
 * ⚠️ 只统计 `status='sent'`：占位后发送失败的行**不该占用频次额度** ——
 * 否则一次模板配置错误会把用户这周的额度白吃掉，而用户其实什么都没收到。
 *
 * 排除到期类需要知道"哪些场景算到期类"。这份名单的唯一事实源在
 * lib/lifecycle-scenarios.ts，所以由调用方传入（不在 SQL 里硬编码一份）。
 */
export async function getFrequencyState(
  userId: string,
  expiryScenarioKeys: readonly string[],
  now: Date = new Date()
): Promise<FrequencyState> {
  if (!db) return { nonExpirySentInWindow: 0, lastSentAt: null }
  const database = db

  const windowStart = new Date(now.getTime() - FREQUENCY.windowDays * 24 * 60 * 60 * 1000)

  const [lastRow] = await database
    .select({ sentAt: notifications.sentAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.status, "sent"),
        sql`${notifications.sentAt} IS NOT NULL`
      )
    )
    .orderBy(desc(notifications.sentAt))
    .limit(1)

  const conditions: SQL[] = [
    eq(notifications.userId, userId),
    eq(notifications.status, "sent"),
    gte(notifications.createdAt, windowStart),
  ]
  if (expiryScenarioKeys.length > 0) {
    conditions.push(notInArray(notifications.scenario, [...expiryScenarioKeys]))
  }

  const [countRow] = await database
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(...conditions))

  return {
    nonExpirySentInWindow: Number(countRow?.n ?? 0),
    lastSentAt: lastRow?.sentAt ? new Date(lastRow.sentAt) : null,
  }
}

// ─── 退订 ────────────────────────────────────────────────────────────────────

/**
 * 置位退订。
 *
 * 幂等且**保留最早的时间**：已经退订过就不覆盖。举证时（用户投诉"我退订了还发"）
 * 要的是第一次退订的时刻，被后来的操作刷新反而说不清。
 */
export async function optOutNotifications(userId: string, at: Date = new Date()): Promise<boolean> {
  if (!db) return false
  const result = await db
    .update(users)
    .set({ notifyOptOutAt: at })
    .where(and(eq(users.id, userId), isNull(users.notifyOptOutAt)))
  return affectedRows(result) > 0
}

/**
 * 重新开启服务通知。
 *
 * 用户必须能撤销退订 —— 隐私政策里承诺了「可以随时在设置中关闭」，
 * 那就同样要能打开（只关不开等于把选择权收走一半）。清空时间戳即可。
 */
export async function optInNotifications(userId: string): Promise<boolean> {
  if (!db) return false
  const result = await db
    .update(users)
    .set({ notifyOptOutAt: null })
    .where(and(eq(users.id, userId), sql`${users.notifyOptOutAt} IS NOT NULL`))
  return affectedRows(result) > 0
}

/** 读当前退订状态（设置页展示用）。 */
export async function getNotifyPreference(
  userId: string
): Promise<{ optedOut: boolean; optedOutAt: Date | null }> {
  if (!db) return { optedOut: false, optedOutAt: null }
  const [row] = await db
    .select({ at: users.notifyOptOutAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const at = row?.at ? new Date(row.at) : null
  return { optedOut: at != null, optedOutAt: at }
}
