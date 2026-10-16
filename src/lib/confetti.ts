"use client"

/**
 * 极简 canvas 烟花，在**不新增依赖**的前提下提供 canvas-confetti 风格的参数口径。
 *
 * 本仓库没有 canvas-confetti 包，且项目约束是「不加新依赖」。所以这里自己用
 * canvas + rAF 实现了一个
 * **参数语义与 canvas-confetti 一致**的粒子系统：调用方传
 * `{ particleCount, angle, spread, origin, startVelocity, gravity, ticks, colors, scalar }`
 * 即可，视觉上足够接近，行为（何时炸、炸几发、持续多久）完全一致。
 *
 * 粒子物理与 canvas-confetti 同构，单位是「每帧」：
 *   velocity *= DECAY            每帧指数衰减，起始速度 v 的总射程 ≈ v / (1 - DECAY)
 *   x += cos(angle2D) * velocity + drift
 *   y += sin(angle2D) * velocity + gravity      gravity 是**每帧常量下坠**，不是加速度
 *
 * 因此两组预设参数才会呈现出各自的手感：
 *   · 答对单句   startVelocity 60 / gravity 3.5 / ticks 50   → 又快又急、立刻坠落
 *   · 课节完成   startVelocity 45 / gravity 1.2 / ticks 200  → 缓缓飘、持续很久
 *
 * 本模块**不在导入期触碰任何浏览器全局**（函数体内才取 document/window），
 * 这样 SSR 与 vitest(node 环境) 里 import 它是安全的。
 */

export interface ConfettiOptions {
  /** 粒子数，默认 50 */
  particleCount?: number
  /** 发射方向（度）。90 = 正上方；60 = 右上；120 = 左上。默认 90 */
  angle?: number
  /** 散射角（度），以 angle 为中心左右各一半。默认 45 */
  spread?: number
  /** 起始速度（px/帧），实际每个粒子取 0.5×~1.5× 的随机值。默认 45 */
  startVelocity?: number
  /** 每帧常量下坠（px/帧）。默认 1 */
  gravity?: number
  /** 存活帧数（60fps 下 50 帧 ≈ 0.83s，200 帧 ≈ 3.3s）。默认 200 */
  ticks?: number
  /** 发射点，取值 0~1 的视口比例。默认居中 { x: 0.5, y: 0.5 } */
  origin?: { x?: number; y?: number }
  /** 调色板，默认用内置的 12 色 */
  colors?: string[]
  /** 整体尺寸缩放。默认 1 */
  scalar?: number
}

interface Particle {
  x: number
  y: number
  angle2D: number
  velocity: number
  gravity: number
  drift: number
  color: string
  scalar: number
  wobble: number
  wobbleSpeed: number
  tilt: number
  tiltSpeed: number
  tick: number
  totalTicks: number
}

const DEFAULT_COLORS = [
  "#f59e0b",
  "#ef4444",
  "#22c55e",
  "#6366f1",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#a855f7",
  "#10b981",
  "#fbbf24",
  "#f43f5e",
  "#fb923c",
]

/** 课节完成烟花专用的 7 色 */
const COMPLETION_COLORS = [
  "#ff0040",
  "#fbbf24",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#10b981",
  "#00ffff",
]

/** 与 canvas-confetti 的 decay 默认值一致 */
const DECAY = 0.9
/** canvas-confetti 默认 zIndex 是 100，这里保持一致 */
const Z_INDEX = 100

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let rafId = 0
let particles: Particle[] = []
let layerDpr = 1

function syncSize(): void {
  if (!canvas || !ctx) return
  layerDpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.max(1, Math.floor(window.innerWidth * layerDpr))
  canvas.height = Math.max(1, Math.floor(window.innerHeight * layerDpr))
  ctx.setTransform(layerDpr, 0, 0, layerDpr, 0, 0)
}

/**
 * 懒创建全屏画布并挂到 `document.body`。
 *
 * 挂 body 而不是某个容器，是为了避开祖先的 `transform`/`filter` ——
 * 那些属性会让 `position:fixed` 退化成本地定位。
 */
function ensureLayer(): CanvasRenderingContext2D | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null
  if (ctx && canvas && canvas.isConnected) return ctx

  canvas = document.createElement("canvas")
  canvas.setAttribute("aria-hidden", "true")
  canvas.dataset.confettiLayer = "true"
  canvas.style.cssText =
    `position:fixed;top:0;left:0;width:100%;height:100%;` +
    `pointer-events:none;z-index:${Z_INDEX}`
  document.body.appendChild(canvas)

  ctx = canvas.getContext("2d")
  if (!ctx) {
    // 拿不到 2d 上下文（极端环境）时把画布撤掉，别留个死节点。
    canvas.remove()
    canvas = null
    return null
  }
  syncSize()
  window.addEventListener("resize", syncSize)
  return ctx
}

function drawParticle(p: Particle, opacity: number): void {
  if (!ctx) return
  const size = 7 * p.scalar
  // 纸片翻飞：横向按 wobble 正弦缩放，看起来像一张张纸在转。
  const squish = 0.35 + 0.65 * (Math.sin(p.wobble) * 0.5 + 0.5)
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.tilt)
  ctx.globalAlpha = opacity
  ctx.fillStyle = p.color
  ctx.beginPath()
  ctx.ellipse(0, 0, size * squish, size * 0.55, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function frame(): void {
  rafId = 0
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width / layerDpr, canvas.height / layerDpr)

  for (const p of particles) {
    p.tick++
    p.wobble += p.wobbleSpeed
    p.tilt += p.tiltSpeed
    p.velocity *= DECAY
    p.x += Math.cos(p.angle2D) * p.velocity + p.drift
    p.y += Math.sin(p.angle2D) * p.velocity + p.gravity

    const progress = p.tick / p.totalTicks
    if (progress >= 1) continue
    // 末段 30% 淡出，避免粒子「啪」地消失。
    const opacity = progress > 0.7 ? (1 - progress) / 0.3 : 1
    drawParticle(p, opacity)
  }

  particles = particles.filter((p) => p.tick < p.totalTicks)
  // 没有存活粒子就把画布整个拆掉，不留空转的 rAF 和一个全屏节点。
  if (particles.length === 0) {
    teardown()
    return
  }
  rafId = requestAnimationFrame(frame)
}

function teardown(): void {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (canvas) {
    if (typeof window !== "undefined") window.removeEventListener("resize", syncSize)
    canvas.remove()
  }
  canvas = null
  ctx = null
  particles = []
}

/** 发射一发烟花。参数语义同 canvas-confetti，见文件头注释。 */
export function confetti(opts: ConfettiOptions = {}): void {
  if (typeof window === "undefined") return
  if (!ensureLayer()) return

  const {
    particleCount = 50,
    angle = 90,
    spread = 45,
    startVelocity = 45,
    gravity = 1,
    ticks = 200,
    origin = {},
    colors = DEFAULT_COLORS,
    scalar = 1,
  } = opts

  const originX = (origin.x ?? 0.5) * window.innerWidth
  const originY = (origin.y ?? 0.5) * window.innerHeight
  const radAngle = (angle * Math.PI) / 180
  const radSpread = (spread * Math.PI) / 180

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: originX,
      y: originY,
      angle2D: -radAngle + (0.5 * radSpread - Math.random() * radSpread),
      velocity: startVelocity * 0.5 + Math.random() * startVelocity,
      gravity,
      drift: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)] ?? DEFAULT_COLORS[0],
      scalar,
      wobble: Math.random() * 10,
      wobbleSpeed: Math.min(0.11, Math.random() * 0.1 + 0.05),
      tilt: (Math.random() * (0.75 - 0.25) + 0.25) * Math.PI,
      tiltSpeed: (Math.random() - 0.5) * 0.2,
      tick: 0,
      totalTicks: ticks,
    })
  }

  if (!rafId) rafId = requestAnimationFrame(frame)
}

/**
 * 答对单句的中心爆破。
 *
 * `{ particleCount: 50, spread: 80, origin: { y: 0.55 }, gravity: 3.5, startVelocity: 60, ticks: 50 }`
 * （无 colors 参数，即用默认调色板。）
 */
export function fireSuccessBurst(): void {
  confetti({
    particleCount: 50,
    spread: 80,
    origin: { y: 0.55 },
    gravity: 3.5,
    startVelocity: 60,
    ticks: 50,
  })
}

/**
 * 课节完成的双侧连发烟花，持续 `durationMs`（默认 6000ms）。
 *
 * 节奏：每 250ms
 * 左右两侧各来一发，共 7 色、`scalar 1.1`、`ticks 200`。
 *
 * 注意完成烟花**只做环境兜底（`typeof confetti !=='function'`），
 * 不受「答对烟花效果」开关约束** —— 所以调用方不要把 `confetti` 开关传进来。
 *
 * @returns 停止函数；组件卸载时必须调用，否则 interval 会一直跑到 6 秒结束。
 */
export function startCompletionFireworks(durationMs = 6000): () => void {
  // SSR / 非浏览器环境：没有 setInterval 可挂，直接给个空停止函数。
  if (typeof window === "undefined") return () => {}
  const end = Date.now() + durationMs
  let timer = 0

  const fire = () => {
    if (Date.now() > end) {
      if (timer) window.clearInterval(timer)
      timer = 0
      return
    }
    const common = {
      particleCount: 3,
      spread: 55,
      colors: COMPLETION_COLORS,
      startVelocity: 45,
      gravity: 1.2,
      ticks: 200,
      scalar: 1.1,
    }
    confetti({ ...common, angle: 60, origin: { x: 0, y: 0.65 } })
    confetti({ ...common, angle: 120, origin: { x: 1, y: 0.65 } })
  }

 // setInterval 节奏：第一发在 250ms 之后，不是立刻。
  timer = window.setInterval(fire, 250)
  return () => {
    if (timer) window.clearInterval(timer)
    timer = 0
  }
}

/** 立刻清空所有粒子并拆掉画布。组件卸载时用。 */
export function resetConfetti(): void {
  teardown()
}
