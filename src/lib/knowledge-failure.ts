/**
 * AI 句子解析失败时的展示决策。
 *
 * 为什么需要这个模块：
 *   `SentenceKnowledge` 原本在任何失败（含未配置 key）时都会塞入
 *   `getMockKnowledge()` 的硬编码占位文案，只挂一个「缓存数据」角标。
 *   那些内容既不是缓存、也不是分析结果，用户看到的是被冒充成解析结论的假文本。
 *   这里把"失败长什么样"收敛成一个纯函数，好处有两个：
 *     1) 能区分「服务未配置」（重试无意义）与「临时故障」（应当重试），
 *        避免用户对着一个永远不会成功的按钮反复点；
 *     2) 决策可单测，不依赖浏览器环境。
 */

export interface KnowledgeFailureView {
  /** 主标题，一句话说清是什么问题 */
  title: string
  /** 补充说明；限流等场景透出服务端的重试提示 */
  detail: string
  /** 是否值得让用户点重试。服务未配置/未登录/句子非法时为 false */
  canRetry: boolean
}

/** 服务端在 AI key 缺失时回传的标记，必须与 route.ts 保持一致 */
export const KNOWLEDGE_UNCONFIGURED_CODE = "unconfigured"

function pickErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string") {
    const t = payload.trim()
    return t === "" ? null : t
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const err = (payload as { error?: unknown }).error
    if (typeof err === "string" && err.trim() !== "") return err.trim()
  }
  return null
}

function hasUnconfiguredCode(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  return (payload as { code?: unknown }).code === KNOWLEDGE_UNCONFIGURED_CODE
}

export function describeKnowledgeFailure(
  status: number | null,
  payload: unknown,
  options?: { timedOut?: boolean },
): KnowledgeFailureView {
  const serverMessage = pickErrorMessage(payload)

  // 等待超时优先判定：它的 status 也是 null，若不先拦下来会被
  // 当成网络故障，把用户推去排查一个其实没坏的网络。
  if (options?.timedOut) {
    return {
      title: "分析耗时过长",
      detail: "服务端还在生成解析，稍后重试即可。",
      canRetry: true,
    }
  }

  // 未配置优先于状态码判断：服务端可能用 500 兜底，但 code 才是权威信号。
  if (status === 503 || hasUnconfiguredCode(payload)) {
    return {
      title: "AI 解析服务暂未配置",
      detail: "服务端尚未配置 DeepSeek API Key，配置后即可使用。",
      canRetry: false,
    }
  }

  if (status === 401) {
    return {
      title: "请先登录",
      detail: serverMessage ?? "登录后即可查看 AI 句子解析。",
      canRetry: false,
    }
  }

  if (status === 400) {
    return {
      title: "这句话无法解析",
      detail: serverMessage ?? "句子内容不合法，请换一句试试。",
      canRetry: false,
    }
  }

  if (status === 429) {
    return {
      title: "请求过于频繁",
      detail: serverMessage ?? "稍等片刻再试即可。",
      canRetry: true,
    }
  }

  if (status === null) {
    return {
      title: "网络连接失败",
      detail: "请检查网络连接后重试。",
      canRetry: true,
    }
  }

  return {
    title: "AI 解析暂时不可用",
    detail: serverMessage ?? "服务端返回异常，请稍后重试。",
    canRetry: true,
  }
}
