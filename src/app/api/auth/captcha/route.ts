import { NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { captchaChallenges } from "@/lib/db/schema"
import { lt } from "drizzle-orm"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"
import {
  generateSliderPuzzle,
  SLIDER_TTL_MS,
  SLIDER_BG_WIDTH,
  SLIDER_BG_HEIGHT,
  SLIDER_PUZZLE_WIDTH,
} from "@/lib/slider-captcha"

/**
 * 取一张滑块验证码题（发短信防刷的第一步）。
 *
 * 服务端用 pngjs 现画背景+拼图（无素材文件），缺口答案（x 坐标）**只入库、
 * 不下发**——客户端自出题自校验等于没有验证码。前端 rc-slider-captcha 只负责
 * 交互与采集 {x, duration, trail}；判分在 send-sms（verifySliderAnswer）。
 *
 * 一题一用的语义在 send-sms 侧保证：无论对错，验一次即作废（原子 UPDATE
 * used=0→1），想枚举 x 必须每次重新取题，而取题按 IP 限流。
 */
export async function GET(request: Request) {
  if (!db) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 500 })
  }

  // 取题限流：盗刷方若想暴力枚举缺口位置，每次尝试都得先花掉一次取题额度。
  // 30 次/分钟/IP 足够真人重试，脚本枚举 0..240 的 x（±5px 容差≈4% 命中）无利可图。
  const ip = getClientIP(request).slice(0, 50)
  const limit = checkRateLimit("captcha-issue-ip", ip, 30, 60_000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limit.retryAfter}秒后重试` },
      { status: 429 }
    )
  }

  const { background, puzzle, answerX } = generateSliderPuzzle()
  const expiresAt = new Date(Date.now() + SLIDER_TTL_MS)

  // 主键用应用侧 UUID（与库表 DEFAULT (UUID()) 等价的 36 位格式），拿 id 当
  // 回传令牌，避免依赖驱动返回值。
  const id = crypto.randomUUID()
  await db.insert(captchaChallenges).values({ id, answerX, ip, expiresAt })

  // 过期题目的顺手清理（fire-and-forget，保留 24h 便于排查盗刷来源）。
  void db
    .delete(captchaChallenges)
    .where(lt(captchaChallenges.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
    .catch(() => {})

  return NextResponse.json({
    id,
    background,
    puzzle,
    expiresAt: expiresAt.toISOString(),
    // 尺寸随题下发：前端 puzzleSize/bgSize 与出题几何共用这里的常量，
    // 改几何只需改 slider-captcha.ts 一处。
    bgSize: { width: SLIDER_BG_WIDTH, height: SLIDER_BG_HEIGHT },
    puzzleSize: { width: SLIDER_PUZZLE_WIDTH },
  })
}
