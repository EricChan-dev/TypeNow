#!/usr/bin/env tsx
/**
 * Dev helper: switch a user's role/membership for testing
 * Run: pnpm switch-role
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { eq, and } from "drizzle-orm"
import * as readline from "readline"

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, "../.env.local") })
config({ path: join(__dirname, "../.env") })

// ── Schema (inline to avoid import issues) ────────────────────────────────────
import { users, subscriptions } from "../src/lib/db/schema"

const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { mode: "default" })

// ── Roles ─────────────────────────────────────────────────────────────────────
type Role = "free" | "trial" | "monthly" | "yearly" | "partner"

const ROLES: { key: Role; label: string; desc: string }[] = [
  { key: "free",    label: "普通用户",        desc: "无会员，无体验期" },
  { key: "trial",   label: "三天体验期",      desc: "is_pro=1，无订阅记录（新注册效果）" },
  { key: "monthly", label: "月度会员",        desc: "is_pro=1，active subscription plan=monthly" },
  { key: "yearly",  label: "年度会员",        desc: "is_pro=1，active subscription plan=yearly" },
  { key: "partner", label: "合伙人",          desc: "is_partner=1，is_pro=1，永久有效" },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((res) => rl.question(q, res))
}

function days(n: number) {
  return new Date(Date.now() + n * 86_400_000)
}

async function expireAllSubs(userId: string) {
  await db
    .update(subscriptions)
    .set({ status: "expired" })
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
}

async function applyRole(userId: string, role: Role) {
  await expireAllSubs(userId)

  if (role === "free") {
    await db.update(users).set({ isPro: 0, proExpires: null, isPartner: 0 }).where(eq(users.id, userId))
  }

  if (role === "trial") {
    const exp = days(3)
    await db.update(users).set({ isPro: 1, proExpires: exp, isPartner: 0 }).where(eq(users.id, userId))
    // No subscription row → memberTier resolves to "trial" in layout.tsx
  }

  if (role === "monthly") {
    const exp = days(30)
    await db.update(users).set({ isPro: 1, proExpires: exp, isPartner: 0 }).where(eq(users.id, userId))
    await db.insert(subscriptions).values({
      userId, plan: "monthly", status: "active",
      startsAt: new Date(), expiresAt: exp,
    })
  }

  if (role === "yearly") {
    const exp = days(365)
    await db.update(users).set({ isPro: 1, proExpires: exp, isPartner: 0 }).where(eq(users.id, userId))
    await db.insert(subscriptions).values({
      userId, plan: "yearly", status: "active",
      startsAt: new Date(), expiresAt: exp,
    })
  }

  if (role === "partner") {
    const exp = days(365 * 99)
    await db.update(users).set({ isPro: 1, proExpires: exp, isPartner: 1 }).where(eq(users.id, userId))
    await db.insert(subscriptions).values({
      userId, plan: "partner", status: "active",
      startsAt: new Date(), expiresAt: exp,
    })
  }
}

// ── Current tier display ──────────────────────────────────────────────────────
function currentTier(u: typeof users.$inferSelect): string {
  if (u.isPartner) return "合伙人"
  if (!u.isPro) return "普通用户"
  const exp = u.proExpires ? new Date(u.proExpires) : null
  if (!exp) return "体验期（无到期日）"
  const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86_400_000)
  if (daysLeft <= 0) return "已过期（is_pro 仍为 1，待刷新）"
  return `Pro 有效（剩 ${daysLeft} 天到 ${exp.toLocaleDateString()}）`
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log("\n══════════════════════════════════════")
  console.log("  TypeNow 角色切换工具（仅限开发环境）")
  console.log("══════════════════════════════════════\n")

  // List users
  const allUsers = await db
    .select({ id: users.id, name: users.name, phone: users.phone, email: users.email, isPro: users.isPro, isPartner: users.isPartner, proExpires: users.proExpires })
    .from(users)
    .limit(20)

  if (allUsers.length === 0) {
    console.log("数据库中没有用户。\n")
    rl.close()
    await pool.end()
    return
  }

  console.log("用户列表：")
  allUsers.forEach((u, i) => {
    const ident = u.phone ?? u.email ?? u.id.slice(0, 8)
    console.log(`  [${i + 1}] ${ident.padEnd(20)} 当前：${currentTier(u as typeof users.$inferSelect)}`)
  })

  const userInput = await prompt(rl, "\n选择用户编号（或直接输入手机号/邮箱）：")
  let target = allUsers.find((_, i) => String(i + 1) === userInput.trim())
  if (!target) {
    target = allUsers.find((u) => u.phone === userInput.trim() || u.email === userInput.trim())
  }
  if (!target) {
    console.log("找不到该用户。")
    rl.close()
    await pool.end()
    return
  }

  console.log(`\n已选：${target.phone ?? target.email ?? target.id}（当前：${currentTier(target as typeof users.$inferSelect)}）\n`)

  console.log("切换到：")
  ROLES.forEach((r, i) => {
    console.log(`  [${i + 1}] ${r.label.padEnd(12)} — ${r.desc}`)
  })

  const roleInput = await prompt(rl, "\n选择角色编号：")
  const chosen = ROLES[parseInt(roleInput.trim()) - 1]
  if (!chosen) {
    console.log("无效选择。")
    rl.close()
    await pool.end()
    return
  }

  console.log(`\n正在将 ${target.phone ?? target.email} 切换为「${chosen.label}」…`)
  await applyRole(target.id, chosen.key)
  console.log(`✓ 完成！刷新浏览器即可看到效果。\n`)

  rl.close()
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
