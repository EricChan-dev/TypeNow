/**
 * 回填注册来源（一次性，2026-09-28）
 *
 * 背景：`users.signup_channel` / `signup_source`（迁移 00023）上线前建的号，
 * 来源全是 NULL。而老板问「新增用户从哪来」时，答案只能靠临时脚本去微信接口捞。
 * 这个脚本把**能确定的**那部分回填进去，省得以后每次都要重新捞。
 *
 * ⚠️ 只回填有证据的部分，**不做任何推测**：
 *
 *   1. `wechat_openid` 以 `dev` 开头 —— 开发旁路建的号（本地连生产库调试留下的）
 *      → channel = dev。这类号必须能被摘出去，否则会污染来源报表。
 *   2. 没有 openid 但有手机号 → channel = phone。
 *   3. openid 是公众号维度（`oSZ4m3*`）且**没有** access_token
 *      → channel = wechat_oa_qr。依据：能无 token 建号的微信链路只有
 *        「关注/扫码事件建号 + oa-check 兜底」这一条（OAuth 回调建号必定写
 *        wechat_access_token，见 callback 的 upsertWeChatUser）。
 *   4. 其余（有 token 的那两个：老板本人与他的表哥）**channel 留 NULL**：
 *        有 token 说明他们至少用过一次 OAuth 回调登录，但那可能是**后来**的登录，
 *        而建号究竟是 oa 授权还是开放平台扫码，库里没有记录 —— 推测一个值比留空
 *        更有害，报表会拿它当事实。scene / subscribedAt 照记，信息不丢。
 *
 *   微信侧的 `subscribe_scene` / `qr_scene_str` / `subscribe_time` 从公众号接口读
 *   （这正是"他怎么找到我们的"那个答案），referrer / UA / IP **永久缺失** ——
 *   那时没有记录，绝不编造。
 *
 * 用法（**必须在服务器上跑**，见下）：
 *   npx tsx scripts/backfill-signup-source.ts            # 干跑，只打印将要写入的内容
 *   npx tsx scripts/backfill-signup-source.ts --apply    # 真正写库
 *
 * ⚠️ 为什么必须在服务器上跑：微信的 `/cgi-bin/token` 有**调用方 IP 白名单**，
 * 本机（开发机）不在白名单里，会直接返回
 * `invalid ip …, not in whitelist`。实测过一次：本地跑第一个请求就失败。
 *
 * 幂等：只处理 `signup_channel IS NULL AND signup_source IS NULL` 的行，
 * 已有来源的不会被动。重复执行安全。
 */
import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import mysql from "mysql2/promise"
import { buildSignupSource, type SignupSource } from "../src/lib/signup-source"

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, "..", ".env.local") })

const APPLY = process.argv.includes("--apply")

interface UserRow {
  id: string
  name: string | null
  phone: string | null
  wechat_openid: string | null
  has_token: number
  created_at: Date
}

interface WeChatInfo {
  subscribe?: number
  subscribe_scene?: string
  qr_scene_str?: string
  subscribe_time?: number
}

let oaToken = ""

/**
 * 取公众号 access_token（**懒加载**）。
 *
 * 为什么懒：如果待回填的行里一个微信 openid 都没有（例如只有手机号用户），
 * 这个请求就是纯粹的多余动作 —— 而它失败时的报错（IP 白名单）会让人以为
 * 整个回填坏了。只在真的要查微信时才取。
 */
async function ensureOAToken(): Promise<string> {
  if (oaToken) return oaToken
  const appid = process.env.WECHAT_OA_APP_ID
  const secret = process.env.WECHAT_OA_APP_SECRET
  if (!appid || !secret) throw new Error("缺少 WECHAT_OA_APP_ID / WECHAT_OA_APP_SECRET")
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`,
  )
  const data = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string }
  if (!data.access_token) {
    throw new Error(
      `取 access_token 失败: ${data.errmsg ?? "unknown"}` +
        (String(data.errmsg ?? "").includes("ip")
          ? " —— 微信接口有调用方 IP 白名单，本脚本必须在服务器上运行"
          : ""),
    )
  }
  oaToken = data.access_token
  return oaToken
}

/**
 * 读一个关注者在公众号侧的信息。
 *
 * 查不到（未关注 / openid 不属于这个公众号）返回 null —— 调用方照常回填渠道，
 * 只是没有 scene。**不重试**：这里是一次性脚本，失败信息打出来更有用。
 */
async function fetchWeChatInfo(openid: string): Promise<WeChatInfo | null> {
  const token = await ensureOAToken()
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/user/info?access_token=${token}&openid=${openid}&lang=zh_CN`,
  )
  const data = (await res.json()) as WeChatInfo & { errcode?: number; errmsg?: string }
  if (data.errcode) return null
  return data
}

/**
 * 渠道判定。见文件头的证据规则 —— 判不出来就返回 null，不猜。
 */
function decideChannel(row: UserRow): string | null {
  const openid = row.wechat_openid ?? ""
  if (openid.startsWith("dev")) return "dev"
  if (!openid && row.phone) return "phone"
  // 公众号维度的 openid 前缀（本项目实测；不同公众号前缀不同，所以只作为一种
  // 佐证，真正的判据是"没有 token"）
  if (openid && !row.has_token) return "wechat_oa_qr"
  return null
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL")
  if (!databaseUrl.includes("typenow")) {
    throw new Error(`DATABASE_URL 看起来不对（不含 typenow）：${databaseUrl.slice(0, 40)}…`)
  }

  const pool = mysql.createPool(databaseUrl)
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, name, phone, wechat_openid,
              (wechat_access_token IS NOT NULL) AS has_token,
              created_at
         FROM users
        WHERE signup_channel IS NULL AND signup_source IS NULL
        ORDER BY created_at`,
    )
    const users = rows as unknown as UserRow[]
    console.log(`待回填：${users.length} 行${APPLY ? "" : "（干跑，不会写库）"}\n`)

    if (users.length === 0) return

    let filled = 0
    let channelNull = 0

    for (const u of users) {
      const channel = decideChannel(u)

      let source: SignupSource | null = null
      const openid = u.wechat_openid ?? ""
      if (openid && !openid.startsWith("dev")) {
        const info = await fetchWeChatInfo(openid)
        if (info) {
          source = buildSignupSource({
            scene: info.subscribe_scene ?? null,
            qrScene: info.qr_scene_str ?? null,
            subscribedAt: info.subscribe_time
              ? new Date(info.subscribe_time * 1000).toISOString()
              : null,
          })
        }
      }

      if (!channel) channelNull++
      const label = `${u.id.slice(0, 8)} ${(u.name ?? "?").slice(0, 12).padEnd(14)}`
      console.log(
        `${label} channel=${(channel ?? "NULL").padEnd(14)} ${source ? JSON.stringify(source) : "(无微信侧信息)"}`,
      )

      if (APPLY && (channel || source)) {
        await pool.query(
          `UPDATE users SET signup_channel = ?, signup_source = ? WHERE id = ? AND signup_channel IS NULL AND signup_source IS NULL`,
          [channel, source ? JSON.stringify(source) : null, u.id],
        )
        filled++
      }
    }

    console.log(
      `\n合计：${users.length} 行，渠道可判定 ${users.length - channelNull} 行，` +
        `渠道留空 ${channelNull} 行（有 token，建号路径无从考证）。`,
    )
    console.log(
      APPLY
        ? `已写入 ${filled} 行。`
        : "这是干跑：确认无误后加 --apply 再执行一次。",
    )
    if (channelNull > 0) {
      console.log(
        "注意：留空的行仍记录了微信侧 scene —— 那是「他怎么找到我们的」的权威答案，\n" +
          "只是『哪条链路建的号』没有记录，推测一个值比留空更有害。",
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error("[backfill-signup-source] 失败:", err)
  process.exit(1)
})
