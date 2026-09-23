/**
 * HTTP 客户端：带 cookie 罐，供 API 级功能/业务测试使用。
 *
 * 刻意不做任何"测试专用后门"（比如直接改库来假装已登录）——除了下面这个
 * dev 会话旁路，它与 src/lib/auth/session.ts 的 development 分支一一对应，
 * 本身就是要被测的行为。需要覆盖真实会话查询的用例改用 createRealSession()。
 */
import { randomUUID } from "crypto"
import { E2E_BASE_URL } from "./env"
import { q } from "./db"

export interface ApiResponse<T = unknown> {
  status: number
  ok: boolean
  body: T
  headers: Headers
  raw: string
}

export class ApiClient {
  private cookies = new Map<string, string>()

  constructor(private baseUrl: string = E2E_BASE_URL) {}

  /** 由 userId 造一个 dev 会话 cookie（对应 session.ts 的 dev 旁路）。 */
  static asUser(userId: string): ApiClient {
    const c = new ApiClient()
    c.cookies.set("typenow_session", `dev:${userId}`)
    return c
  }

  /** 造一条真实 sessions 行并带上它的 UUID（覆盖真实会话查询路径）。 */
  static async asRealSession(userId: string): Promise<ApiClient> {
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ")
    await q("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
      id,
      userId,
      expiresAt,
    ])
    const c = new ApiClient()
    c.cookies.set("typenow_session", id)
    return c
  }

  static anonymous(): ApiClient {
    return new ApiClient()
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value)
  }

  getCookie(name: string): string | undefined {
    return this.cookies.get(name)
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  private absorbSetCookie(res: Response): void {
    const list = res.headers.getSetCookie?.() ?? []
    for (const raw of list) {
      const [pair] = raw.split(";")
      const idx = pair.indexOf("=")
      if (idx <= 0) continue
      const name = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (value === "") this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    init: { json?: unknown; headers?: Record<string, string>; redirect?: RequestRedirect } = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
      ...init.headers,
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      redirect: init.redirect ?? "manual",
      signal: AbortSignal.timeout(60_000),
    })
    this.absorbSetCookie(res)
    const raw = await res.text()
    let body: unknown = raw
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      /* 非 JSON（HTML/纯文本）原样返回，便于断言重定向等 */
    }
    return { status: res.status, ok: res.ok, body: body as T, headers: res.headers, raw }
  }

  get<T = unknown>(path: string, init?: Parameters<ApiClient["request"]>[2]) {
    return this.request<T>("GET", path, init)
  }
  post<T = unknown>(path: string, json?: unknown, init?: Parameters<ApiClient["request"]>[2]) {
    return this.request<T>("POST", path, { ...init, json: json ?? {} })
  }
  put<T = unknown>(path: string, json?: unknown) {
    return this.request<T>("PUT", path, { json: json ?? {} })
  }
  del<T = unknown>(path: string, json?: unknown) {
    return this.request<T>("DELETE", path, json !== undefined ? { json } : {})
  }
}
