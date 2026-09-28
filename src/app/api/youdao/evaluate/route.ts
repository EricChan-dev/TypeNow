import { NextResponse } from "next/server"
import { createHash, randomUUID } from "crypto"
import { getSession } from "@/lib/auth/session"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { isProActive } from "@/lib/subscription"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import {
  DAY_MS,
  FREE_PRONUNCIATION_PER_DAY,
  PRO_PRONUNCIATION_PER_DAY,
} from "@/lib/membership-benefits"
import {
  EVALUATE_UNCONFIGURED_CODE,
  describeYoudaoError,
  mapYoudaoEvaluate,
  youdaoErrorCode,
} from "@/lib/pronunciation"

/**
 * 跟读评分 / 有道语音评测代理。
 *
 * ── 这一版修的是一个「从未成功过」的接口 ────────────────────────────────────
 *
 * 旧实现打的是 `openapi.youdao.com/speechevaluateapi`，而该地址**不存在**：
 * 实测 POST 返回 HTTP 404 `{"status":404,"error":"Not Found"}`。于是那段 404 的
 * JSON 被当成业务响应解析，`errorCode` 为 undefined ≠ "0"，客户端最终看到的是
 * 「评分失败(undefined)」—— 也就是说这个功能上线以来一次都没成功过。
 *
 * 正确接口是 `openapi.youdao.com/iseapi`（文档：
 * https://ai.youdao.com/DOCSIRMA/html/tts/api/yypc/index.html）。与文档逐条对齐后
 * 的取值，已用一个伪造 appKey 的真实请求验证过：返回 errorCode=108
 * 「应用ID无效」—— 说明必填参数与音频格式都被接受，只差真实密钥。
 *
 * 同一组对照实验还确认了三件事（都是旧实现写错的地方）：
 *   · `type` 必须是 `1`（仅支持 base64 上传）；传 `2` 会得到 303「服务端异常」；
 *   · `format` 与 `channel` 会被**前置校验**（传 mp3 得 11001、channel=2 得 11003），
 *     所以上面那个 108 不是"还没校验到音频"，是真的通过了；
 *   · 文档要求的 `signType` 是 `v2`，且**没有** `audioType` 这个字段。
 *
 * 响应字段也读错了：文档的响应是**顶层** `integrity / fluency / pronunciation /
 * overall / speed / words[].{word,pronunciation}`，旧代码读的是
 * `result.integrity / result.accuracy / words[].{content,accuracy}`。
 * 映射与错误翻译收敛在 lib/pronunciation（纯函数、可单测）。
 *
 * ── 计费与额度 ──────────────────────────────────────────────────────────────
 *
 * 有道按调用计费，所以：每日额度按会员身份区分（数值与价格页文案同源，
 * 见 lib/membership-benefits），同一 IP 再兜一层 60 次/小时防止批量注册绕过。
 * key 检查放在额度之前 —— 没配置时根本没产生调用，不该扣掉用户当天的额度。
 */

const MAX_EVALUATE_PER_IP_HOUR = 60
// 评测对象是句子，500 字符足够。
const MAX_TEXT_LENGTH = 500
// 音频体积上限：16k/16bit/单声道 120 秒 ≈ 3.8MB 原始数据、base64 后约 5.1MB。
// 客户端只录 10 秒，2MB 已是宽裕的闸门（挡掉异常大的请求体）。
const MAX_AUDIO_LENGTH = 2_000_000
/** 有道侧超时。评测是同步接口，超过这个时间让用户重试比一直转圈更好。 */
const YOUDAO_TIMEOUT_MS = 20_000

function truncateInput(q: string): string {
  if (q.length <= 20) return q
  return q.substring(0, 10) + q.length + q.substring(q.length - 10)
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  let body: { audio?: string; text?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const { audio, text } = body
  if (!audio || !text) {
    return NextResponse.json({ error: "audio 和 text 不能为空" }, { status: 400 })
  }
  if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: `text 不能超过${MAX_TEXT_LENGTH}字符` }, { status: 400 })
  }
  if (typeof audio !== "string" || audio.length > MAX_AUDIO_LENGTH) {
    return NextResponse.json({ error: "audio 数据过大" }, { status: 413 })
  }

  // 先查 key：未配置时根本没产生调用，不该先扣掉用户当天的额度
  // （顺序与 tts 路由一致）。回 503 + code 而不是笼统的 500：
  // 客户端据此区分「服务未配置（重试无意义）」与「临时故障（值得重试）」。
  const appKey = process.env.YOUDAO_APP_KEY
  const appSecret = process.env.YOUDAO_APP_SECRET
  if (!appKey || !appSecret) {
    return NextResponse.json(
      { error: "语音评测服务尚未配置", code: EVALUATE_UNCONFIGURED_CODE },
      { status: 503 },
    )
  }

  // 每日额度按会员身份区分。key 里带上海日历日 —— 跨天即换新桶，额度自然重置；
  // 窗口取一天，且必须配合 rate-limit 的「按桶窗口清理」才不会被截短成 1 小时。
  const [viewer] = db
    ? await db
        .select({ isPro: users.isPro, proExpires: users.proExpires })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1)
    : []
  const isPro = isProActive(viewer)
  const dailyQuota = isPro ? PRO_PRONUNCIATION_PER_DAY : FREE_PRONUNCIATION_PER_DAY

  const userLimit = checkRateLimit(
    "youdao-evaluate-user-daily",
    `${session.userId}:${toShanghaiDateStr()}`,
    dailyQuota,
    DAY_MS,
  )
  if (!userLimit.allowed) {
    return NextResponse.json(
      {
        error: isPro
          ? `今日评测次数已用完（会员每天 ${PRO_PRONUNCIATION_PER_DAY} 次），请明天再来`
          : `今日免费评测次数已用完（每天 ${FREE_PRONUNCIATION_PER_DAY} 次），开通会员可提升至每天 ${PRO_PRONUNCIATION_PER_DAY} 次`,
        code: "quota_exhausted",
      },
      { status: 429 },
    )
  }

  const ipLimit = checkRateLimit(
    "youdao-evaluate-ip",
    getClientIP(request),
    MAX_EVALUATE_PER_IP_HOUR,
    3600_000,
  )
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: `评测次数已达上限，请${ipLimit.retryAfter}秒后重试` },
      { status: 429 },
    )
  }

  const salt = randomUUID()
  const curtime = Math.floor(Date.now() / 1000).toString()
  const sign = createHash("sha256")
    .update(appKey + truncateInput(audio) + salt + curtime + appSecret)
    .digest("hex")

  // 参数严格按官方文档：signType=v2、type=1（base64 上传）、channel=1、
  // rate=16000、format=wav。**不要**加回 audioType —— 文档里没有这个字段。
  const formData = new URLSearchParams({
    q: audio,
    text,
    langType: "en",
    appKey,
    salt,
    curtime,
    sign,
    signType: "v2",
    type: "1",
    format: "wav",
    rate: "16000",
    channel: "1",
  })

  let youdaoData: unknown
  try {
    const res = await fetch("https://openapi.youdao.com/iseapi", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      signal: AbortSignal.timeout(YOUDAO_TIMEOUT_MS),
    })
    // 有道在异常时可能返回非 JSON（例如网关 HTML）。先取文本再尝试解析，
    // 避免 res.json() 直接抛错后只剩一句无信息的"评分失败"。
    const raw = await res.text()
    try {
      youdaoData = JSON.parse(raw)
    } catch {
      console.error("[youdao/evaluate] 响应不是 JSON:", res.status, raw.slice(0, 300))
      return NextResponse.json({ error: "语音评测服务返回异常" }, { status: 502 })
    }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError"
    console.error("[youdao/evaluate] 调用失败:", timedOut ? "超时" : err)
    return NextResponse.json(
      { error: timedOut ? "语音评测超时，请重试" : "语音评测服务不可达" },
      { status: 504 },
    )
  }

  const errorCode = youdaoErrorCode(youdaoData)
  if (errorCode !== "0") {
    const view = describeYoudaoError(errorCode)
    console.error("[youdao/evaluate] 有道返回错误:", errorCode, view.reason)
    return NextResponse.json(
      view.code ? { error: view.reason, code: view.code } : { error: view.reason },
      { status: view.status },
    )
  }

  const result = mapYoudaoEvaluate(youdaoData)
  if (!result) {
    // errorCode 为 "0" 却映射不出结果 —— 响应结构变了。必须留痕，
    // 否则又会退化成"用户看到 0 分、我们不知道发生了什么"。
    console.error("[youdao/evaluate] 成功响应无法映射:", JSON.stringify(youdaoData).slice(0, 500))
    return NextResponse.json({ error: "评分结果解析失败" }, { status: 502 })
  }

  return NextResponse.json(result)
}
