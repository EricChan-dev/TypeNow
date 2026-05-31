"use client"

export function isWechatBrowser(): boolean {
  if (typeof navigator === "undefined") return false
  return /MicroMessenger/i.test(navigator.userAgent)
}

export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
