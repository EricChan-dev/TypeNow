#!/usr/bin/env tsx
import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import mysql from "mysql2/promise"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, "..", ".env.local") })

const pool = mysql.createPool(process.env.DATABASE_URL!)

const migrations = [
  { label: "users: add invite_code", sql: `ALTER TABLE users ADD COLUMN invite_code VARCHAR(12)` },
  { label: "users: add referred_by", sql: `ALTER TABLE users ADD COLUMN referred_by VARCHAR(36)` },
  { label: "users: add referral_locked_until", sql: `ALTER TABLE users ADD COLUMN referral_locked_until DATETIME` },
  { label: "users: add is_partner", sql: `ALTER TABLE users ADD COLUMN is_partner TINYINT NOT NULL DEFAULT 0` },
  { label: "users: add partner_agreed_at", sql: `ALTER TABLE users ADD COLUMN partner_agreed_at DATETIME` },
  { label: "users: add invite_code unique index", sql: `ALTER TABLE users ADD UNIQUE INDEX users_invite_code_unique (invite_code)` },
  {
    label: "payment_orders: extend plan ENUM",
    sql: `ALTER TABLE payment_orders MODIFY plan ENUM('monthly','yearly','partner') NOT NULL`,
  },
  {
    label: "subscriptions: extend plan ENUM",
    sql: `ALTER TABLE subscriptions MODIFY plan ENUM('monthly','yearly','partner') NOT NULL`,
  },
  {
    label: "create partner_commissions",
    sql: `CREATE TABLE IF NOT EXISTS partner_commissions (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      partner_id VARCHAR(36) NOT NULL,
      order_id VARCHAR(36) NOT NULL,
      referred_user_id VARCHAR(36) NOT NULL,
      gross_amount INT NOT NULL,
      commission_amount INT NOT NULL,
      rate DECIMAL(4,2) NOT NULL,
      commission_type ENUM('first','renewal') NOT NULL,
      status ENUM('cooling','available','withdrawn','clawed_back') NOT NULL DEFAULT 'cooling',
      available_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY idx_pc_order_id (order_id),
      INDEX idx_pc_partner_id (partner_id),
      INDEX idx_pc_referred_user (referred_user_id),
      INDEX idx_pc_status (status)
    )`,
  },
  {
    label: "create withdrawal_requests",
    sql: `CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      partner_id VARCHAR(36) NOT NULL,
      amount INT NOT NULL,
      wechat_openid VARCHAR(100),
      partner_trade_no VARCHAR(64) UNIQUE,
      wx_transfer_id VARCHAR(64),
      status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
      fail_reason TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      INDEX idx_wr_partner_id (partner_id),
      INDEX idx_wr_status (status)
    )`,
  },
  {
    label: "create partner_risk_flags",
    sql: `CREATE TABLE IF NOT EXISTS partner_risk_flags (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      user_id VARCHAR(36) NOT NULL,
      flag_type ENUM('duplicate_ip','abnormal_frequency','manual') NOT NULL,
      detail TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_prf_user_id (user_id)
    )`,
  },
]

async function main() {
  const conn = await pool.getConnection()
  let ok = 0
  let fail = 0
  for (const m of migrations) {
    try {
      await conn.query(m.sql)
      console.log("✓", m.label)
      ok++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("Duplicate key name") || msg.includes("already exists") || msg.includes("Duplicate column name")) {
        console.log("~", m.label, "(already applied)")
        ok++
      } else {
        console.error("✗", m.label, "-", msg)
        fail++
      }
    }
  }
  conn.release()
  await pool.end()
  console.log(`\n${ok} succeeded, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
