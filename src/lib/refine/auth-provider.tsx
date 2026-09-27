"use client"

import type { AuthProvider } from "@refinedev/core"

export const authProvider: AuthProvider = {
  /**
   * 后台**没有**独立登录入口：管理员走主站登录（手机号 / 微信），
   * 身份由 users.role 或 ADMIN_PHONES 决定（判定见 lib/admin-identity）。
   *
   * 这里原来有一个 email + 密码的 login，调 `/api/admin/auth/login` —— 但它
   * **永远登不进去**：那条接口按 email 查用户，而线上 `users.email` 一条都没有；
   * 生产也没配置 `ADMIN_PASSWORD_HASH`（该接口必定 401）。那条接口已删除。
   *
   * 保留这个方法是必须的：refine 的 AuthProvider 类型要求 login 存在
   * （不是可选的）。所以留一个**明确失败**的实现，并说清该从哪里进，
   * 而不是留一个看着可用、实则死路的表单。
   */
  login: async () => ({
    success: false,
    error: {
      name: "AdminLoginNotSupported",
      message: "后台没有独立登录入口，请先在主站登录管理员账号，再访问 /admin。",
    },
  }),

  logout: async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" })
    return { success: true, redirectTo: "/admin/login" }
  },

  check: async () => {
    // Dev mode: always authenticated
    if (process.env.NODE_ENV === "development") {
      return { authenticated: true }
    }
    /**
     * 由服务端回答"我是不是管理员"，**不在这里自己判 role**。
     *
     * 这里原来写的是 `user.role !== "admin"`，而服务端（proxy 与 requireAdmin）
     * 还认 ADMIN_PHONES —— 于是仅凭手机号获得权限的管理员：页面能进、接口全通，
     * 却被这一行踢回 /admin/login，而那个页面没有可用的登录入口，
     * 他永远进不了后台。前端复制服务端规则，漂移只是时间问题。
     */
    const res = await fetch("/api/admin/whoami")
    if (!res.ok) {
      return { authenticated: false, redirectTo: "/admin/login", logout: true }
    }
    const { isAdmin } = (await res.json().catch(() => ({ isAdmin: false }))) as {
      isAdmin?: boolean
    }
    if (!isAdmin) {
      return { authenticated: false, redirectTo: "/admin/login", logout: true }
    }
    return { authenticated: true }
  },

  getPermissions: async () => ["admin"],

  getIdentity: async () => {
    const res = await fetch("/api/auth/me")
    const { user } = await res.json().catch(() => ({ user: null }))
    if (!user) return null
    return { id: user.id, name: user.name || "Admin", avatar: user.avatar }
  },

  onError: async (error) => {
    console.error("Auth error:", error)
    return { error }
  },
}
