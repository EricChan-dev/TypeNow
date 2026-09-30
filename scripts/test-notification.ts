/**
 * TypeNow · 服务通知「真机验证」——只发一条，不经过扫描路由
 *
 * ## 为什么需要它
 *
 * 微信公众号**模板消息的字段名必须与申请到的模板完全一致**，否则发送被驳回。
 * 而模板申请本身要等 1~3 天，字段名写错等于白等一轮；更糟的是，
 * **失败只会发生在"用户该收到提醒的那一刻"** —— 那时已经错过了挽回窗口。
 *
 * 所以在打开 `LIFECYCLE_ENABLED` 之前，先用这个脚本对**自己的账号**发一条，
 * 确认三件事：
 *   ① 模板 ID 有效（不是 40037）
 *   ② 字段名与模板对得上（不是 47003 / 参数不匹配）
 *   ③ 文案在真实客户端里读起来是对的（时态、日期、数字）
 *
 * ## 用法
 *
 *   # 发给你自己（按手机号找 openid；也可以用 --openid 或 --user 指定）
 *   pnpm notify:test -- --phone=13800000000 --template=veIYcDZG...
 *
 *   # 不指定 --template 时用 .env.local 里对应场景的变量
 *   pnpm notify:test -- --phone=13800000000 --scenario=yearly_expired_1d
 *
 *   # 只打印将要发送的 payload，不真的发（用于核对字段名）
 *   pnpm notify:test -- --phone=13800000000 --dry-run
 *
 *   # 校验全部 6 个场景的 payload 结构（不发消息，不需要 openid）
 *   pnpm notify:test -- --check-all
 *
 *   # 读回阿里云短信模板的正文与变量名，并核对是否与代码传参一致
 *   pnpm notify:test -- --sms-template
 *   pnpm notify:test -- --sms-template=SMS_512530543
 *
 *   # 列出公众号账号下所有模板的 ID / 标题 / 字段（不发消息，最有用的一步）
 *   pnpm notify:test -- --list
 *   pnpm notify:test -- --list --template=veIYcDZG...   # 顺便核对指定 ID
 *
 * ## 安全约定
 *
 *   - 只读用户表 + 只调用微信接口，**不写任何数据库数据**（不会占幂等位、
 *     不会改退订状态）。所以它可以在打开总开关之前随便跑。
 *   - 一次只发一条，不循环、不批量。
 */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local")
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvLocal()

const args = process.argv.slice(2)
function arg(name: string): string | undefined {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  const eq = hit.indexOf("=")
  return eq === -1 ? "true" : hit.slice(eq + 1)
}

const DRY_RUN = arg("dry-run") !== undefined
const CHECK_ALL = arg("check-all") !== undefined
const SCENARIO_KEY = arg("scenario") ?? "trial_expiring_24h"
const TEMPLATE_OVERRIDE = arg("template")
const LANDING_URL = arg("url") ?? "https://typenow.cn/home/membership"

async function main() {
  const { buildMessage, findScenario, LIFECYCLE_SCENARIOS } = await import(
    "../src/lib/lifecycle-scenarios"
  )

  // ── 阿里云短信模板自查：变量名对不对 ──────────────────────────────────────
  //
  // 模板里的 `${变量}` 必须与代码传的参数名完全一致，差一个字母就发送失败。
  // 模板审核要等 1~2 天，所以启用前先自查，比事后从失败率里发现划算。
  if (arg("sms-template") !== undefined) {
    const code =
      arg("sms-template") === "true"
        ? process.env.ALIYUN_SMS_NOTIFY_TEMPLATE_CODE ?? ""
        : (arg("sms-template") as string)
    const { getSmsTemplateInfo } = await import("../src/lib/aliyun-sms")
    console.log(`查询短信模板 ${code || "(未配置)"}\n`)
    const info = await getSmsTemplateInfo(code)
    if (!info.ok) {
      console.error(`✗ ${info.error}`)
      process.exitCode = 1
      return
    }
    console.log(`  模板名称  ${info.name}`)
    console.log(`  模板类型  ${info.type}`)
    console.log(`  审核状态  ${info.status}`)
    console.log(`  模板正文  ${info.content}`)
    console.log(`  变量      ${info.variables.join(", ") || "（无）"}`)

    // 代码实际会传的参数名（用于年卡的到期提醒）
    const expected = ["tier", "date", "count"]
    const missing = expected.filter((v) => !info.variables.includes(v))
    const extra = info.variables.filter((v) => !expected.includes(v))
    console.log("")
    console.log(`  代码会传  ${expected.join(", ")}`)
    if (missing.length === 0 && extra.length === 0) {
      console.log("  ✓ 变量名完全对得上")
    } else {
      if (missing.length) console.error(`  ✗ 模板里缺变量：${missing.join(", ")}（代码会传但模板没有 → 发送失败）`)
      if (extra.length) console.error(`  ✗ 模板里有代码不传的变量：${extra.join(", ")}（模板要必填则发送失败）`)
      process.exitCode = 1
    }
    return
  }

  // ── 列出账号下所有模板：直接回答"这个 ID 是哪个模板、字段叫什么" ─────────
  //
  // 微信的 get_all_private_template 会连**模板内容**一起返回，其中的
  // {{first.DATA}}/{{keyword1.DATA}}... 就是该模板的字段名。
  // 有它就不必"发一条试试看"——判断字段是否匹配不再需要骚扰任何用户。
  if (arg("list") !== undefined) {
    const { getOAGlobalAccessToken, isWeChatOAConfigured } = await import("../src/lib/wechat")
    if (!isWeChatOAConfigured()) {
      console.error("✗ 本地 .env.local 缺少 WECHAT_OA_APP_ID / WECHAT_OA_APP_SECRET。")
      console.error("  可以在服务器上跑： su - admin -c 'cd /home/admin/TypeNow && pnpm notify:test -- --list'")
      process.exitCode = 1
      return
    }
    const token = await getOAGlobalAccessToken()
    const res = await fetch(
      // ⚠️ 路径必须是 cgi-bin/**template**/get_all_private_template。
      //    少了 template/ 这一层会返回 404 且**响应体是空的**，报出来是
      //    "Unexpected end of JSON input"，很容易误判成网络问题。
      `https://api.weixin.qq.com/cgi-bin/template/get_all_private_template?access_token=${token}`,
      // 没有超时的 fetch 会把脚本挂死（本地网络到微信不通时实测会一直等）
      { signal: AbortSignal.timeout(20000) },
    )
    const payload = (await res.json()) as {
      template_list?: { template_id: string; title: string; content: string }[]
      errcode?: number
      errmsg?: string
    }
    if (payload.errcode) {
      console.error(`✗ 微信返回错误 ${payload.errcode}: ${payload.errmsg}`)
      process.exitCode = 1
      return
    }
    const list = payload.template_list ?? []
    console.log(`账号下共 ${list.length} 个模板：\n`)
    for (const t of list) {
      const marked = TEMPLATE_OVERRIDE && t.template_id === TEMPLATE_OVERRIDE
      const fields = [...t.content.matchAll(/\{\{(\w+)\.DATA\}\}/g)].map((m) => m[1])
      console.log(`${marked ? "★" : " "} ${t.title}`)
      console.log(`    template_id: ${t.template_id}`)
      console.log(`    字段: ${fields.join(", ")}`)
      console.log(`    内容: ${t.content.replace(/\n/g, " ⏎ ")}`)
      console.log("")
    }
    if (TEMPLATE_OVERRIDE) {
      const hit = list.find((t) => t.template_id === TEMPLATE_OVERRIDE)
      if (!hit) {
        console.error("✗ 指定的模板 ID 不在这个账号下（可能复制错了，或属于另一个公众号）")
        process.exitCode = 1
      } else {
        const fields = [...hit.content.matchAll(/\{\{(\w+)\.DATA\}\}/g)].map((m) => m[1])
        const need = ["first", "keyword1", "keyword2", "keyword3", "remark"]
        const ok = need.every((f) => fields.includes(f))
        console.log(
          ok
            ? "✓ 字段与「到期提醒」所需的 5 个一致（first/keyword1..3/remark）"
            : `✗ 缺字段：${need.filter((f) => !fields.includes(f)).join(", ") || "（无）"} —— 与到期类 payload 不匹配`,
        )
      }
    }
    return
  }

  const ctx = {
    nickname: "测试",
    // 用一个明确的未来/过去时间，便于肉眼核对时态与日期格式
    expiry: new Date(Date.now() + 10 * 60 * 60 * 1000),
    practicedSentences: 47,
    pendingReview: 23,
    tierLabel: "月度会员",
  }

  // ── 只校验 payload 结构：不发消息、不需要 openid ─────────────────────────
  if (CHECK_ALL) {
    console.log("校验全部场景的模板 payload（不发送）\n")
    const byTemplate = new Map<string, string[]>()
    for (const scenario of LIFECYCLE_SCENARIOS) {
      const msg = buildMessage({ scenario, ...ctx })
      const keys = Object.keys(msg.templateData)
      const env = scenario.templateIdEnv ?? "(无模板渠道)"
      console.log(`  ${scenario.key}`)
      console.log(`    渠道    ${scenario.channels.join(" + ")}`)
      console.log(`    模板变量 ${env}`)
      console.log(`    字段    ${keys.length ? keys.join(", ") : "（不用模板）"}`)
      if (scenario.templateIdEnv) {
        const list = byTemplate.get(scenario.templateIdEnv) ?? []
        list.push(keys.join(","))
        byTemplate.set(scenario.templateIdEnv, list)
      }
    }
    console.log("\n  共用的模板变量必须字段一致，否则同一个模板会一会儿成功一会儿失败：")
    let bad = false
    for (const [env, shapes] of byTemplate) {
      const uniq = [...new Set(shapes)]
      const ok = uniq.length === 1
      if (!ok) bad = true
      console.log(`    ${ok ? "✓" : "✗"} ${env}  ${uniq.length} 种字段集合`)
      if (!ok) for (const u of uniq) console.log(`        ${u}`)
    }
    process.exitCode = bad ? 1 : 0
    return
  }

  const scenario = findScenario(SCENARIO_KEY)
  if (!scenario) {
    console.error(`未知场景：${SCENARIO_KEY}`)
    console.error(`可选：${LIFECYCLE_SCENARIOS.map((s) => s.key).join(", ")}`)
    process.exitCode = 1
    return
  }

  const templateId =
    TEMPLATE_OVERRIDE ?? (scenario.templateIdEnv ? process.env[scenario.templateIdEnv] : "")
  const msg = buildMessage({ scenario, ...ctx })

  console.log(`场景      ${scenario.key}（${scenario.channels.join(" + ")}）`)
  console.log(`模板变量  ${scenario.templateIdEnv ?? "（该场景不用模板渠道）"}`)
  if (scenario.templateIdEnv) {
    const fromEnv = process.env[scenario.templateIdEnv]
    console.log(`模板 ID   ${templateId || "(空)"}${TEMPLATE_OVERRIDE ? "  ← --template" : fromEnv ? "  ← .env.local" : "  ← 未配置"}`)
  }
  console.log(`标题      ${msg.title}`)
  console.log("模板字段：")
  for (const [k, v] of Object.entries(msg.templateData)) {
    console.log(`  ${k.padEnd(9)} = ${v}`)
  }
  console.log(`正文      ${msg.body.replace(/\n/g, " / ")}`)

  if (!scenario.channels.includes("template")) {
    console.error("\n✗ 该场景的渠道里没有 template，无法用模板消息验证。")
    process.exitCode = 1
    return
  }
  if (!templateId) {
    console.error(`\n✗ 模板 ID 为空：请在 .env.local 配置 ${scenario.templateIdEnv}，或用 --template 指定。`)
    process.exitCode = 1
    return
  }

  // ── 解析收件人（只读） ───────────────────────────────────────────────────
  const { db } = await import("../src/lib/db")
  const { users } = await import("../src/lib/db/schema")
  const { and, eq, isNotNull, ne, sql } = await import("drizzle-orm")
  if (!db) {
    console.error("\n✗ DATABASE_URL 未配置，无法解析收件人。")
    process.exitCode = 1
    return
  }

  const openidArg = arg("openid")
  const phoneArg = arg("phone")
  const userArg = arg("user")

  let openid = openidArg ?? ""
  let who = openidArg ? `openid=${openidArg}` : ""

  if (!openid) {
    if (!phoneArg && !userArg) {
      console.error("\n✗ 需要 --openid=<openid> 或 --phone=<手机号> 或 --user=<id前缀>")
      process.exitCode = 1
      return
    }
    const [row] = await db
      .select({ id: users.id, openid: users.wechatOpenid, name: users.name })
      .from(users)
      .where(
        and(
          isNotNull(users.wechatOpenid),
          ne(users.wechatOpenid, ""),
          phoneArg ? eq(users.phone, phoneArg) : sql`${users.id} LIKE ${userArg + "%"}`,
        ),
      )
      .limit(1)
    if (!row?.openid) {
      console.error(`\n✗ 找不到带 openid 的用户（${phoneArg ? `phone=${phoneArg}` : `user=${userArg}`}）`)
      process.exitCode = 1
      return
    }
    openid = row.openid
    who = `${row.name ?? "?"}（id ${row.id.slice(0, 8)}）`
  }

  // 脱敏打印：openid 属于可识别信息，日志里不留全量
  const masked = crypto.createHash("sha256").update(openid).digest("hex").slice(0, 8)
  console.log(`\n收件人    ${who}  openid#${masked}`)

  if (DRY_RUN) {
    console.log("\n--dry-run：以上是完整 payload，未发送。")
    return
  }

  const { sendOATemplateMessage } = await import("../src/lib/wechat")
  console.log("\n发送中...")
  const r = await sendOATemplateMessage(openid, templateId, msg.templateData, LANDING_URL)
  if (r.ok) {
    console.log("✓ 发送成功。请到微信里看这条消息的文案是否读得通。")
    return
  }
  console.error(`✗ 发送失败  reason=${r.reason}  error=${r.error}`)
  console.error("\n按 reason 判断怎么修：")
  console.error("  not_configured → 模板 ID 无效（40037）或公众号凭据缺失")
  console.error("  failed         → 字段名与模板不匹配（47003/参数错误）或用户未关注（43004）")
  process.exitCode = 1
}

main().catch((e) => {
  console.error("脚本异常：", e)
  process.exitCode = 1
})
