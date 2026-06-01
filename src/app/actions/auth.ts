"use server"

import { getSession, deleteSession, isDbConfigured } from "@/lib/auth/session"
import { getCurrentUser } from "@/lib/auth/user"

export async function signOutAction() {
  await deleteSession()
}

export { getSession, isDbConfigured }

export async function getUser() {
  return getCurrentUser()
}
