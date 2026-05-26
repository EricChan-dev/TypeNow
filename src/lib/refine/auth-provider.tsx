"use client"

import type { AuthProvider } from "@refinedev/core"

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const res = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "登录失败" }))
      return { success: false, error: { message: error, name: "LoginError" } }
    }
    return { success: true, redirectTo: "/admin" }
  },

  logout: async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" })
    return { success: true, redirectTo: "/admin/login" }
  },

  check: async () => {
    const res = await fetch("/api/auth/me")
    const { user } = await res.json().catch(() => ({ user: null }))
    if (!user || user.role !== "admin") {
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
