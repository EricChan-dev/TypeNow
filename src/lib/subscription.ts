import { createServiceClient } from "@/lib/supabase/service"

function getPlanDurationDays(plan: "monthly" | "yearly"): number {
  return plan === "monthly" ? 30 : 365
}

export async function activateSubscription(
  userId: string,
  plan: "monthly" | "yearly",
  paymentOrderId?: string
) {
  const supabase = createServiceClient()
  if (!supabase) throw new Error("Service client not configured")

  const days = getPlanDurationDays(plan)

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("expires_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  const startsAt = new Date()
  const baseDate = existing?.expires_at
    ? new Date(existing.expires_at)
    : startsAt
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)

  const { error: subError } = await supabase.from("subscriptions").insert({
    user_id: userId,
    plan,
    status: "active",
    payment_order_id: paymentOrderId || null,
    starts_at: startsAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  })

  if (subError) throw new Error(`Failed to create subscription: ${subError.message}`)

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      is_pro: true,
      pro_expires: expiresAt.toISOString(),
    })
    .eq("id", userId)

  if (profileError) throw new Error(`Failed to update profile: ${profileError.message}`)

  return { plan, startsAt, expiresAt }
}

export async function checkAndExpirePro(userId: string) {
  const supabase = createServiceClient()
  if (!supabase) return

  const { data: profile } = await supabase
    .from("profiles")
    .select("pro_expires")
    .eq("id", userId)
    .maybeSingle()

  if (profile?.pro_expires) {
    const expiresAt = new Date(profile.pro_expires)
    if (expiresAt <= new Date()) {
      await supabase
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("user_id", userId)
        .eq("status", "active")
        .lte("expires_at", new Date().toISOString())

      await supabase
        .from("profiles")
        .update({ is_pro: false, pro_expires: null })
        .eq("id", userId)
    }
  }
}

export async function getActiveSubscription(userId: string) {
  const supabase = createServiceClient()
  if (!supabase) return null

  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}

export async function cancelSubscription(userId: string) {
  const supabase = createServiceClient()
  if (!supabase) throw new Error("Service client not configured")

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (!sub) throw new Error("No active subscription found")

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", sub.id)

  if (error) throw new Error(`Failed to cancel subscription: ${error.message}`)

  return { success: true }
}
