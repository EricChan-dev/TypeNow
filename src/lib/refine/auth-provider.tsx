"use client"

import type { AuthProvider } from "@refinedev/core"
import { createClient } from "@/lib/supabase/client"

function getClient() {
  return createClient()
}

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const supabase = getClient()
    if (!supabase) return { success: false, error: { message: "服务未配置", name: "ConfigError" } }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { success: false, error: { message: error.message, name: "LoginError" } }

    const { data: profile } = await supabase.from("profiles").select("role").single()
    if (profile?.role !== "admin") {
      await supabase.auth.signOut()
      return { success: false, error: { message: "非管理员账户", name: "AdminError" } }
    }
    return { success: true, redirectTo: "/admin" }
  },

  logout: async () => {
    const supabase = getClient()
    if (supabase) await supabase.auth.signOut()
    return { success: true, redirectTo: "/login" }
  },

  check: async () => {
    const supabase = getClient()
    if (!supabase) return { authenticated: false, redirectTo: "/login", logout: true }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      return { authenticated: false, redirectTo: "/login", logout: true }
    }
    const { data: profile } = await supabase.from("profiles").select("role").single()
    if (profile?.role !== "admin") {
      return { authenticated: false, redirectTo: "/", logout: true }
    }
    return { authenticated: true }
  },

  getPermissions: async () => ["admin"],

  getIdentity: async () => {
    const supabase = getClient()
    if (!supabase) return null
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    return {
      id: user.id,
      name: user.email || "Admin",
      avatar: user.user_metadata?.avatar_url,
    }
  },

  onError: async (error) => {
    console.error("Auth error:", error)
    return { error }
  },
}
