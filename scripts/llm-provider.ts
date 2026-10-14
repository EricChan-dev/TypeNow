#!/usr/bin/env tsx
/**
 * 脚本侧统一 LLM 调用层（自定义端点 / DeepSeek / 智谱 GLM 自动降级）。
 *
 * 背景：src/lib/llm.ts 是应用运行时用的，写死 DeepSeek。数据回填脚本量大，
 * DeepSeek 欠费（402 Insufficient Balance）时整条管线就停摆；本文件让脚本可以
 * 用 .env.local 里已有的 ZHIPU_API_KEY 跑，充值后一条 env 就能切回。
 * 另支持任意 OpenAI 兼容端点：配 CUSTOM_LLM_BASE_URL/CUSTOM_LLM_API_KEY/CUSTOM_LLM_MODEL
 * 即自动优先使用（见下方 custom provider）。
 *
 * 选择规则（env LLM_PROVIDER）：
 *   "deepseek" 只用 DeepSeek；"glm" 只用 GLM；"custom" 只用自定义端点；
 *   默认 "auto" = custom > deepseek > glm 依次尝试（ready() 为真的才参与），
 *   遇到 402/401（余额或鉴权失效）自动切下一个，并在进程内记住该 provider 已死，
 *   后续调用直接走备选，不再重复撞墙。
 *
 * 429/5xx：指数退避重试 3 次（与其他脚本一致），不切换 provider（避免重复生成）。
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, "..", ".env.local") })

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

/** 模型名可用 env 覆盖，方便临时换更贵/更便宜的档位。 */
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash"
const GLM_MODEL = process.env.GLM_MODEL || "glm-4.5-flash"
/**
 * 自定义 provider：任何 OpenAI 兼容端点（/v1/chat/completions）。
 * .env.local 里配 CUSTOM_LLM_BASE_URL / CUSTOM_LLM_API_KEY / CUSTOM_LLM_MODEL 即启用，
 * 且默认排在最前（配置了就用它）。BASE_URL 填到 /v1 这一级即可。
 */
const CUSTOM_BASE_URL = (process.env.CUSTOM_LLM_BASE_URL || "").replace(/\/+$/, "")
const CUSTOM_MODEL = process.env.CUSTOM_LLM_MODEL || ""
const CUSTOM_URL = CUSTOM_BASE_URL
  ? CUSTOM_BASE_URL.endsWith("/chat/completions")
    ? CUSTOM_BASE_URL
    : `${CUSTOM_BASE_URL}/chat/completions`
  : ""

/** provider 失效（余额/鉴权）——触发降级到下一个 provider。 */
class ProviderExhausted extends Error {}

/**
 * 是否属于「所有 provider 都死了」（余额/鉴权），调用方据此中断整批任务，
 * 而不是把剩下每一条都记成失败空转。
 */
export function isProviderDown(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes("所有 LLM provider 均不可用") || msg.includes("没有可用的 LLM provider")
}

interface Provider {
  name: string
  model: string
  ready: () => boolean
  url: string
  headers: () => Record<string, string>
  body: (messages: ChatMessage[], opts: ChatOptions) => Record<string, unknown>
}

const providers: Provider[] = [
  {
    name: "custom",
    model: CUSTOM_MODEL,
    ready: () => Boolean(CUSTOM_URL && CUSTOM_MODEL && process.env.CUSTOM_LLM_API_KEY),
    url: CUSTOM_URL,
    headers: () => ({ "Content-Type": "application/json", Authorization: `Bearer ${process.env.CUSTOM_LLM_API_KEY}` }),
    body: (messages, opts) => ({
      model: CUSTOM_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      // 有的自定义端点 max_tokens 上限更低，可用 CUSTOM_LLM_MAX_TOKENS 夹一下。
      max_tokens: process.env.CUSTOM_LLM_MAX_TOKENS
        ? Math.min(opts.maxTokens ?? Number.POSITIVE_INFINITY, Number(process.env.CUSTOM_LLM_MAX_TOKENS))
        : opts.maxTokens,
      // 关闭思考模式（实测 routers.opays.ai 的 vLLM 部署：4.9s/193 reasoning tokens → 1.1s/0）。
      // reasoning_effort 是 OpenAI 风格；chat_template_kwargs.enable_thinking 是 vLLM Jinja 模板风格，双保险。
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
    }),
  },
  {
    name: "deepseek",
    model: DEEPSEEK_MODEL,
    ready: () => Boolean(process.env.DEEPSEEK_API_KEY),
    url: "https://api.deepseek.com/chat/completions",
    headers: () => ({ "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }),
    body: (messages, opts) => ({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens,
      thinking: { type: "disabled" },
    }),
  },
  {
    name: "glm",
    model: GLM_MODEL,
    ready: () => Boolean(process.env.ZHIPU_API_KEY),
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    headers: () => ({ "Content-Type": "application/json", Authorization: `Bearer ${process.env.ZHIPU_API_KEY}` }),
    body: (messages, opts) => ({
      model: GLM_MODEL,
      messages,
      // GLM 的 temperature 上限是 1.0，调用方（扩句脚本）用 1.1 提高多样性，这里夹一下。
      temperature: Math.min(opts.temperature ?? 0.7, 1),
      max_tokens: opts.maxTokens,
      // glm-4.5-flash 默认开思考：实测同一句成分切分，开思考时温度被忽略且更慢。
      thinking: { type: "disabled" },
    }),
  },
]

const preferred = (process.env.LLM_PROVIDER || "auto").toLowerCase()
/** 默认 custom 优先（配了就用自定义端点），其次 deepseek，最后 glm。 */
const DEFAULT_ORDER = ["custom", "deepseek", "glm"]
const ordered = DEFAULT_ORDER
  .map((name) => providers.find((p) => p.name === name)!)
  .concat(providers.filter((p) => !DEFAULT_ORDER.includes(p.name)))
  .sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0))

/** 进程内已确认失效的 provider（余额/鉴权），后续直接跳过。 */
const dead = new Set<string>()
let loggedChoice = false

/**
 * 每个 provider 的并发/节流上限。
 * GLM 免费档实测并发 6 就会大面积 429，所以默认压到 2 并发 + 300ms 间隔；
 * DeepSeek 官方限速宽松，保持 8。都可用 env 覆盖。
 */
function limits(p: Provider): { concurrency: number; minIntervalMs: number } {
  if (p.name === "custom") {
    return {
      concurrency: Number(process.env.CUSTOM_LLM_CONCURRENCY ?? 4),
      minIntervalMs: Number(process.env.CUSTOM_LLM_MIN_INTERVAL_MS ?? 200),
    }
  }
  if (p.name === "glm") {
    return {
      concurrency: Number(process.env.GLM_CONCURRENCY ?? 2),
      minIntervalMs: Number(process.env.GLM_MIN_INTERVAL_MS ?? 1000),
    }
  }
  return {
    concurrency: Number(process.env.LLM_CONCURRENCY ?? 8),
    minIntervalMs: Number(process.env.LLM_MIN_INTERVAL_MS ?? 0),
  }
}

/** 信号量 + 最小发起间隔，避免把并行度甩给上游触发限流。 */
class Limiter {
  private active = 0
  private lastStart = 0
  private waiters: Array<() => void> = []
  constructor(private readonly max: number, private readonly minIntervalMs: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active++
    try {
      const gap = Date.now() - this.lastStart
      if (this.minIntervalMs > 0 && gap < this.minIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minIntervalMs - gap))
      }
      this.lastStart = Date.now()
      return await fn()
    } finally {
      this.active--
      this.waiters.shift()?.()
    }
  }
}

const limiters = new WeakMap<Provider, Limiter>()
function limiterFor(p: Provider): Limiter {
  let l = limiters.get(p)
  if (!l) {
    const { concurrency, minIntervalMs } = limits(p)
    l = new Limiter(Math.max(1, concurrency), Math.max(0, minIntervalMs))
    limiters.set(p, l)
  }
  return l
}

export function activeProvider(): string {
  const p = ordered.find((x) => x.ready() && !dead.has(x.name))
  return p ? `${p.name}/${p.model}` : "none"
}

/**
 * 429 的退避节奏（毫秒）。GLM 免费档是「每分钟请求数」限流，2/4/8s 这种短退避
 * 根本跨不过窗口，实测连续 429；这里给到 5s→15s→30s→60s→60s 并把尝试次数加到 6。
 * 5xx 属于服务端抖动，短退避重试即可。
 */
function retryPlan(p: Provider): { attempts: number; backoff: number[] } {
  if (p.name === "glm") {
    return { attempts: 6, backoff: [5000, 15000, 30000, 60000, 60000, 60000] }
  }
  return { attempts: 4, backoff: [2000, 4000, 8000, 16000] }
}

async function callOnce(p: Provider, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const plan = retryPlan(p)
  for (let attempt = 0; attempt <= plan.attempts; attempt++) {
    const wait = () => new Promise((r) => setTimeout(r, plan.backoff[Math.min(attempt, plan.backoff.length - 1)]))
    let res: Response
    try {
      res = await fetch(p.url, {
        method: "POST",
        headers: p.headers(),
        body: JSON.stringify(p.body(messages, opts)),
      })
    } catch (err) {
      if (attempt === plan.attempts) throw err
      await wait()
      continue
    }
    if (res.status === 402 || res.status === 401) {
      const detail = (await res.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ")
      throw new ProviderExhausted(`${p.name} 不可用（HTTP ${res.status}）：${detail}`)
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === plan.attempts) throw new Error(`${p.name} HTTP ${res.status}（重试 ${plan.attempts} 次后仍失败）`)
      await wait()
      continue
    }
    if (!res.ok) {
      throw new Error(`${p.name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return j.choices?.[0]?.message?.content ?? ""
  }
  throw new Error("unreachable")
}

/**
 * 调用 LLM，返回正文。所有 provider 都失效时抛出带原因的聚合错误
 * （调用方通常据此中断整批任务，而不是把每句都记成失败）。
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const tries: string[] = []
  for (const p of ordered) {
    if (!p.ready() || dead.has(p.name)) continue
    try {
      const out = await limiterFor(p).run(() => callOnce(p, messages, opts))
      if (!loggedChoice) {
        console.log(`   [LLM] provider=${p.name} model=${p.model}（并发上限 ${limits(p).concurrency}）`)
        loggedChoice = true
      }
      return out
    } catch (err) {
      if (err instanceof ProviderExhausted) {
        dead.add(p.name)
        tries.push(err.message)
        continue
      }
      throw err
    }
  }
  if (tries.length) throw new Error(`所有 LLM provider 均不可用：\n  - ${tries.join("\n  - ")}`)
  throw new Error("没有可用的 LLM provider（缺 CUSTOM_LLM_* / DEEPSEEK_API_KEY / ZHIPU_API_KEY 配置）")
}
