/**
 * 跟读评分（有道语音评测）的结果映射与失败文案。
 *
 * ── 为什么单独一个纯模块 ────────────────────────────────────────────────────
 *
 * 这一处曾经**从未成功过**，而且失败得很安静，根源是「照着想象的接口写」：
 *
 *   1. 请求打的是 `openapi.youdao.com/speechevaluateapi` —— 该地址**不存在**，
 *      实测返回 HTTP 404（`{"status":404,"error":"Not Found"}`）。正确地址是
 *      `openapi.youdao.com/iseapi`。
 *   2. 参数与官方文档不符：`signType` 应为 `v2`（代码写 `v3`）、`type` 应为 `1`
 *      （代码写 `2`，实测该值会让有道返回 303「服务端的其它异常」），
 *      并且代码多传了一个文档里没有的 `audioType`。
 *   3. 返回字段读的是 `result.integrity / result.accuracy / words[].content /
 *      words[].accuracy`，而文档的响应是**顶层** `integrity / fluency /
 *      pronunciation / overall` 与 `words[].word / words[].pronunciation`。
 *   4. 音频发的是 webm/opus，而该接口只接受 wav（16k/16bit/单声道）。
 *
 * 于是旧实现的真实行为是：404 的响应体被当成业务响应解析 → `errorCode` 为
 * undefined ≠ "0" → 客户端看到「评分失败(undefined)」。
 *
 * 把映射与错误翻译收敛成纯函数，是为了让「文档里的响应长什么样 → 界面显示什么」
 * 这条链路可单测（含文档里的完整响应示例），而不是只能靠真实调用去碰。
 *
 * 官方文档：https://ai.youdao.com/DOCSIRMA/html/tts/api/yypc/index.html
 */

/** 服务端在未配置有道密钥时回传的标记（与 route.ts 保持一致）。 */
export const EVALUATE_UNCONFIGURED_CODE = "unconfigured"

export interface EvaluateWordScore {
  word: string
  /**
   * 单词得分。`null` 表示**有道没有给这个字段**，而不是「得了 0 分」——
   * 两者必须区分：旧实现用 `?? 0` 兜底，字段一变就会把整句词都标成红色 0 分，
   * 用户以为全读错了。
   */
  score: number | null
}

export interface EvaluateResult {
  /** 综合得分：优先 overall，缺失时退回 pronunciation，再退回 integrity */
  score: number
  /**
   * 准确度（有道字段名是 pronunciation）。**`null` 表示有道没给这个字段**，
   * 不是「得了 0 分」—— 与下面 words[].score 同一套策略：
   *
   * 维度一旦用 `?? 0` 兜底，下游评语规则「该维度 < 75 就出短板建议」就会命中，
   * 给一个字段缺失的用户生成「流利度偏低，试着连贯一些、少停顿。」并落库，
   * 历史回看时还是这句误导性评语。总分 `score` 非空，因为它有自己的兜底链。
   */
  accuracy: number | null
  /** 流利度。`null` = 有道没给，不是 0 分。理由同 accuracy。 */
  fluency: number | null
  /** 完整度（是否漏读/少读）。`null` = 有道没给，不是 0 分。理由同 accuracy。 */
  integrity: number | null
  /** 语速（单词/分钟）；缺失为 null */
  speed: number | null
  words: EvaluateWordScore[]
}

/** 有道响应里我们读取的字段（只声明用到的，避免把整个响应结构化）。 */
interface YoudaoRaw {
  errorCode?: string | number
  integrity?: unknown
  fluency?: unknown
  pronunciation?: unknown
  overall?: unknown
  speed?: unknown
  words?: unknown
}

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 有道把错误码放在 errorCode 里，成功时是字符串 "0"。 */
export function youdaoErrorCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const code = (data as YoudaoRaw).errorCode
  if (code === undefined || code === null) return null
  return String(code)
}

export function isYoudaoSuccess(data: unknown): boolean {
  return youdaoErrorCode(data) === "0"
}

/**
 * 把有道的成功响应映射成界面用的结构。
 *
 * 不是成功响应（errorCode 非 "0"）时返回 null —— 调用方必须先判空再展示，
 * 绝不用 0 分兜底：那会把「接口报错」显示成「你读得很差」。
 */
export function mapYoudaoEvaluate(data: unknown): EvaluateResult | null {
  if (!isYoudaoSuccess(data)) return null
  const raw = data as YoudaoRaw

  const overall = asFiniteNumber(raw.overall)
  const pronunciation = asFiniteNumber(raw.pronunciation)
  const integrity = asFiniteNumber(raw.integrity)
  const fluency = asFiniteNumber(raw.fluency)

  // 综合分的兜底链：overall → pronunciation → integrity → 0。
  // 文档保证有 overall，但服务端字段变动的代价太大（整句显示 0 分），
  // 所以按可靠度逐级退让。三者全缺时只能给 0，但那种响应本身已不是成功响应。
  // 注意这条链**只有总分有**，所以只有 score 敢写成非空。
  const score = overall ?? pronunciation ?? integrity ?? 0

  // 三维度与下面的词级分是**同一套策略**：有道没给就保留 null，绝不 `?? 0`。
  // 理由见 EvaluateResult.accuracy 的注释（0 会命中「< 75 出短板建议」的评语规则）。
  // 取整：句子级已经是整数，混着小数会让界面参差不齐。
  const roundOrNull = (n: number | null): number | null => (n === null ? null : Math.round(n))

  const words: EvaluateWordScore[] = Array.isArray(raw.words)
    ? (raw.words as Array<Record<string, unknown>>)
        .map((w) => {
          const n = asFiniteNumber(w?.pronunciation)
          return {
            word: typeof w?.word === "string" ? w.word : "",
            // 关键是**保留 null** —— 不能用 `?? 0`，那会把"字段缺失"显示成"0 分"。
            score: roundOrNull(n),
          }
        })
        .filter((w) => w.word !== "")
    : []

  return {
    score: Math.round(score),
    accuracy: roundOrNull(pronunciation),
    fluency: roundOrNull(fluency),
    integrity: roundOrNull(integrity),
    speed: asFiniteNumber(raw.speed),
    words,
  }
}

export interface YoudaoErrorView {
  /** 回给客户端的 HTTP 状态码 */
  status: number
  /** 服务端写给日志的中文原因 */
  reason: string
  /** 客户端能否通过重试解决 */
  retriable: boolean
  /** 配置类问题带上 unconfigured 标记，客户端据此提示"服务未配置"而不是"网络错误" */
  code?: string
}

/**
 * 把有道的错误码翻译成「我们对客户端的态度」。
 *
 * 取值依据官方错误码表，只列我们真正会遇到的；其余归入 502 可重试。
 * 关键是把三类分开：
 *   · 配置问题（密钥/IP 白名单/欠费）→ 503 + unconfigured，重试无意义；
 *   · 音频问题（格式/采样率/声道/太短）→ 400，是我们客户端该修的；
 *   · 服务端/限流 → 429 或 502，值得重试。
 */
export function describeYoudaoError(code: string | null): YoudaoErrorView {
  const c = code ?? ""

  // ── 配置类：重试没有意义，必须让人去后台改配置 ──
  if (["108", "110", "111", "112", "202", "203", "205", "206", "401"].includes(c)) {
    const hints: Record<string, string> = {
      "108": "应用ID无效",
      "110": "应用未绑定语音评测服务实例",
      "111": "开发者账号无效",
      "112": "请求的服务无效",
      "202": "签名校验失败",
      "203": "调用来源 IP 不在有道白名单内",
      "205": "接口与应用的平台类型不一致",
      "206": "时间戳无效导致签名校验失败",
      "401": "账户已欠费停用",
    }
    return {
      status: 503,
      reason: `有道语音评测不可用：${hints[c] ?? `错误码 ${c}`}`,
      retriable: false,
      code: EVALUATE_UNCONFIGURED_CODE,
    }
  }

  // ── 音频类：我们客户端的问题，重试同一段音频没用 ──
  // 3001-3009 / 9001-9005 / 11001-11013 覆盖格式、采样率、声道、上传类型、
  // 时长与内容无效等（实测 format=mp3 会得到 11001、channel=2 得到 11003）。
  if (["3001", "3002", "3003", "3004", "3007", "3008", "3009",
       "9001", "9002", "9003", "9004",
       "11001", "11002", "11003", "11004", "11006", "11007",
       "11010", "11011", "11012"].includes(c)) {
    const audioHints: Record<string, string> = {
      "11010": "录音太短，请完整读完这句再提交",
      "11011": "没有识别到有效语音内容",
      "11012": "待评测文本过短",
    }
    return {
      status: 400,
      reason: audioHints[c] ?? `音频不符合评测要求（错误码 ${c}，需要 16k/16bit/单声道 wav）`,
      retriable: false,
    }
  }

  // ── 限流类：等一会儿就好 ──
  if (["411", "2411", "3411", "4411", "9411", "11303", "11411"].includes(c)) {
    return { status: 429, reason: "有道语音评测调用过于频繁，请稍后再试", retriable: true }
  }

  // ── 其余：服务端异常，值得重试 ──
  const transient: Record<string, string> = {
    "303": "有道服务端异常",
    "11301": "口语评测请求失败",
    "11302": "口语评测请求超时",
    "11304": "有道服务异常",
  }
  return {
    status: 502,
    reason: transient[c] ?? `有道语音评测失败（错误码 ${c || "未知"}）`,
    retriable: true,
  }
}

export interface EvaluateFailureView {
  title: string
  detail: string
  canRetry: boolean
}

/**
 * 客户端拿到失败响应后该显示什么。
 *
 * 与 lib/knowledge-failure 同一套思路：把「服务未配置」（重试无意义）与
 * 「临时故障」（值得重试）分开，避免用户对着一个永远不会成功的按钮反复点。
 */
export function describeEvaluateFailure(
  status: number | null,
  payload: unknown,
  options?: { timedOut?: boolean },
): EvaluateFailureView {
  const serverMessage =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? ((payload as { error?: unknown }).error as string | undefined)
      : undefined
  const code =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { code?: unknown }).code
      : undefined

  // 超时优先：它的 status 也是 null，不先拦下来会被当成网络故障
  if (options?.timedOut) {
    return { title: "评分耗时过长", detail: "语音评测服务响应较慢，稍后重试即可。", canRetry: true }
  }

  // 未配置优先于状态码：服务端可能用 500 兜底，code 才是权威信号
  if (code === EVALUATE_UNCONFIGURED_CODE || status === 503) {
    return {
      title: "跟读评分暂未开放",
      detail: serverMessage ?? "服务端尚未完成语音评测配置，配置后即可使用。",
      canRetry: false,
    }
  }

  if (status === 401) {
    return { title: "请先登录", detail: "登录后即可使用跟读评分。", canRetry: false }
  }

  if (status === 429) {
    return {
      title: "今日评分次数已用完",
      detail: serverMessage ?? "稍后再试，或开通会员获得更多次数。",
      canRetry: false,
    }
  }

  if (status === 400 || status === 413) {
    return {
      title: "这段录音无法评分",
      detail: serverMessage ?? "请靠近麦克风、完整读完这句再试一次。",
      canRetry: true,
    }
  }

  if (status === null) {
    return { title: "网络连接失败", detail: "请检查网络后重试。", canRetry: true }
  }

  return {
    title: "评分暂时不可用",
    detail: serverMessage ?? "服务端返回异常，请稍后重试。",
    canRetry: true,
  }
}
