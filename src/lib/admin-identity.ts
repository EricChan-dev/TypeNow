/**
 * 「谁是管理员」的**唯一定义**。
 *
 * 为什么要有这个模块：这个判定此前散在三处，而且其中两处不一致 ——
 *
 *   proxy.ts          ：role === "admin" || phone ∈ ADMIN_PHONES
 *   requireAdmin()    ：role === "admin" || phone ∈ ADMIN_PHONES
 *   authProvider.check()：**只认** role === "admin"
 *
 * 后果不是"权限太松"而是"**合法管理员被挡在后台外面**"：仅凭 ADMIN_PHONES
 * 拿到权限的人，服务端一路放行（页面能进、接口全通），但前端 AuthGate 会把他
 * 重定向到 /admin/login —— 而那个页面只有一句"请从登录页进入"，于是他永远进不去。
 * 这类 bug 只在"给某人加个手机号"时才出现，平时看不见。
 *
 * 所以判定收敛到这里，proxy、requireAdmin、/api/admin/whoami 三处共用同一份；
 * 前端不再自己判 role，而是问 whoami。将来改规则（比如加第二因素、加管理员表）
 * 只需要改这一个文件。
 */

/**
 * 开发态兜底手机号。e2e 与本地开发靠它拿到后台权限，生产不生效。
 * 与 tests 里的夹具手机号段（139xxxxxxx）刻意错开，避免某个测试用户被意外提权。
 */
const DEV_ADMIN_PHONE = "16634482010"

/**
 * 允许的后台手机号白名单（逗号分隔）。
 *
 * dev 兜底放在这里、而不是各调用点自己写，是因为它曾经就是不一致的来源：
 * /api/auth/me 原来**无条件**返回这个号（连 ADMIN_PHONES 都不看），
 * 而 proxy.ts 与 requireAdmin 完全没有兜底 —— 于是开发态出现
 * "前端说你是管理员、后台接口全 401"，两边各说各话。
 * 现在四处共用这一份：配了 ADMIN_PHONES 就用它，没配才回落到 dev 兜底。
 */
export function getAdminPhones(): string[] {
  const raw = process.env.ADMIN_PHONES
  const configured = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : []
  if (configured.length > 0) return configured
  if (process.env.NODE_ENV === "development") return [DEV_ADMIN_PHONE]
  return []
}

export interface AdminCandidate {
  role: string | null
  phone: string | null
}

export type AdminVia = "role" | "phone"

export interface AdminVerdict {
  isAdmin: boolean
  /** 命中的是哪条规则；不是管理员时为 null */
  via: AdminVia | null
}

/**
 * 判定一个用户是不是管理员，并说明是靠哪条规则命中的。
 *
 * 返回 `via` 而不是布尔值：出问题时"他是靠角色还是靠手机号进来的"是第一个
 * 要回答的问题，日志与 whoami 都直接用它，不必再各自推断一遍。
 */
export function judgeAdmin(user: AdminCandidate | null | undefined): AdminVerdict {
  if (!user) return { isAdmin: false, via: null }
  if (user.role === "admin") return { isAdmin: true, via: "role" }
  if (user.phone != null && user.phone !== "" && getAdminPhones().includes(user.phone)) {
    return { isAdmin: true, via: "phone" }
  }
  return { isAdmin: false, via: null }
}

export function isAdminUser(user: AdminCandidate | null | undefined): boolean {
  return judgeAdmin(user).isAdmin
}
