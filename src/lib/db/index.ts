import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import * as schema from "./schema"

const globalForDb = global as unknown as { pool: mysql.Pool }

function createPool() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  return mysql.createPool(url)
}

const pool = globalForDb.pool ?? createPool()

if (process.env.NODE_ENV !== "production" && pool) {
  globalForDb.pool = pool
}

export const db = pool ? drizzle(pool, { schema, mode: "default" }) : null

export function isDbConfigured(): boolean {
  return !!pool
}
