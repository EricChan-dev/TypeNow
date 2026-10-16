/**
 * 图形滑块对齐验证码（服务端出题 + 服务端判分）。
 *
 * 防盗刷思路：发送短信验证码前，用户必须先把拼图滑到缺口位置。关键安全性质是
 * **答案只存在服务端**（captcha_challenges.answer_x）——若由客户端出题/判分，
 * 脚本可以直接读到答案，验证码形同虚设。本文件只负责两件事：
 *
 *   1. generateSliderPuzzle() —— 用 pngjs 现画一张随机背景（渐变+圆斑纹理，无
 *      素材文件）并在随机位置抠出拼图块，返回背景/拼图两张 data URL 和答案 x。
 *   2. verifySliderAnswer() —— 纯函数判分：x 距答案 ±5px 内、拖拽时长合理、
 *      有轨迹。配合「一题一用、验一次即作废」（见路由），枚举 x 的成本被
 *      拉到每次都要重新取题。
 *
 * 客户端组件是 rc-slider-captcha（React 生态现成滑块），它只负责交互与收集
 * {x, duration, trail}；对错完全由这里说了算。
 */
import { PNG } from "pngjs"

// ─── 几何常量（与客户端 puzzleSize 约定一致，改这里要同步 UI） ────────────────
export const SLIDER_BG_WIDTH = 320
export const SLIDER_BG_HEIGHT = 160
export const SLIDER_PUZZLE_WIDTH = 60
const PIECE_RADIUS = 27 // 圆形拼图块半径，圆心在 60x60 框的 (30, 30)
const GAP_MARGIN = 20 // 缺口左右留白（贴边时与边界难以区分）
const GAP_Y_MARGIN = 20

// 拼图对齐时，拼图块左缘允许落在的 x 范围（也是答案的取值范围）
export const SLIDER_MIN_X = GAP_MARGIN
export const SLIDER_MAX_X = SLIDER_BG_WIDTH - SLIDER_PUZZLE_WIDTH - GAP_MARGIN

// 判定容差：±5px。太小误伤触屏用户，太大降低脚本成本。
export const SLIDER_TOLERANCE_PX = 5

// 题目有效期：从出题（入库 expires_at）到提交判分的窗口。真人填手机号的
// 时间绰绰有余；过期题在 send-sms 认领时即判无效。
export const SLIDER_TTL_MS = 5 * 60 * 1000

// 拖拽时长合理性：rc-slider-captcha 的 duration 是按下到松开的毫秒数。
// 下限放宽到 120ms（快速轻扫也要这么久），上限 60s（再慢也是异常/重放）。
// 这两项防的是最懒的脚本；真屏障是服务端持有的答案 + 一题一用。
const MIN_DURATION_MS = 120
const MAX_DURATION_MS = 60_000

// 轨迹至少 2 个点：正常拖拽 rc-slider-captcha 一定会采集移动轨迹。
const MIN_TRAIL_POINTS = 2

export interface SliderPuzzleImages {
  /** 背景图 data URL（320x160，缺口已画在上面） */
  background: string
  /** 拼图块 data URL（60x160，透明底，块贴左缘、纵向位置与缺口一致） */
  puzzle: string
  /** 答案：对齐时拼图块左缘的 x。只允许入库，绝不下发给客户端。 */
  answerX: number
}

export interface SliderVerifyInput {
  /** 数据库里的正确答案 */
  expectedX: number
  /** 客户端回传的拼图左缘 x */
  x: unknown
  /** 客户端回传的拖拽时长 ms */
  duration: unknown
  /** 客户端回传的轨迹 [[x,y], ...] */
  trail?: unknown
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100)
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l / 100 - c / 2
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function setPx(img: PNG, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const idx = (img.width * y + x) << 2
  img.data[idx] = r
  img.data[idx + 1] = g
  img.data[idx + 2] = b
  img.data[idx + 3] = a
}

function getPx(img: PNG, x: number, y: number): [number, number, number, number] {
  const idx = (img.width * y + x) << 2
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2], img.data[idx + 3]]
}

function toDataUrl(img: PNG): string {
  return `data:image/png;base64,${PNG.sync.write(img).toString("base64")}`
}

/** 在 img 上画一个实心圆（混合模式：直接覆盖并按 alpha 与底色插值） */
function fillCircle(
  img: PNG,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number],
  alpha: number
): void {
  const r2 = radius * radius
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(img.height - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(img.width - 1, Math.ceil(cx + radius)); x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > r2) continue
      const [br, bg, bb] = getPx(img, x, y)
      setPx(
        img,
        x,
        y,
        Math.round(br + (color[0] - br) * alpha),
        Math.round(bg + (color[1] - bg) * alpha),
        Math.round(bb + (color[2] - bb) * alpha)
      )
    }
  }
}

/**
 * 现画一张滑块验证码题。
 *
 * 无外部素材：背景是随机色相的竖向渐变加随机圆斑纹理（保证缺口附近总有可
 * 辨识的参照物），缺口是深色圆形凹槽带一圈浅色描边，拼图块从原背景抠出、
 * 带浅色描边，纵向位置与缺口一致 —— 客户端只需水平对齐。
 */
export function generateSliderPuzzle(): SliderPuzzleImages {
  const bg = new PNG({ width: SLIDER_BG_WIDTH, height: SLIDER_BG_HEIGHT })

  // 1) 竖向渐变底色（同题内固定，跨题随机）
  const baseHue = randInt(0, 359)
  const top = hslToRgb(baseHue, randInt(35, 60), randInt(55, 72))
  const bottom = hslToRgb((baseHue + randInt(40, 160)) % 360, randInt(35, 60), randInt(38, 55))
  for (let y = 0; y < SLIDER_BG_HEIGHT; y++) {
    const t = y / (SLIDER_BG_HEIGHT - 1)
    for (let x = 0; x < SLIDER_BG_WIDTH; x++) {
      setPx(
        bg,
        x,
        y,
        Math.round(top[0] + (bottom[0] - top[0]) * t),
        Math.round(top[1] + (bottom[1] - top[1]) * t),
        Math.round(top[2] + (bottom[2] - top[2]) * t)
      )
    }
  }

  // 2) 随机圆斑纹理（深浅各几枚）：缺口附近有纹理，肉眼才好对齐
  const blobCount = randInt(6, 9)
  for (let i = 0; i < blobCount; i++) {
    const darker = i % 2 === 0
    fillCircle(
      bg,
      randInt(10, SLIDER_BG_WIDTH - 10),
      randInt(10, SLIDER_BG_HEIGHT - 10),
      randInt(8, 26),
      darker ? [20, 30, 45] : [250, 250, 255],
      randInt(18, 42) / 100
    )
  }

  // 3) 缺口位置（即答案）与拼图块
  const answerX = randInt(SLIDER_MIN_X, SLIDER_MAX_X)
  const gapY = randInt(GAP_Y_MARGIN, SLIDER_BG_HEIGHT - SLIDER_PUZZLE_WIDTH - GAP_Y_MARGIN)
  const gapCx = answerX + SLIDER_PUZZLE_WIDTH / 2
  const gapCy = gapY + SLIDER_PUZZLE_WIDTH / 2

  // 3a) 先按原背景抠出拼图块（60 x BG_HEIGHT 透明画布，块贴左缘）
  const piece = new PNG({ width: SLIDER_PUZZLE_WIDTH, height: SLIDER_BG_HEIGHT })
  const rIn = PIECE_RADIUS * PIECE_RADIUS
  const rEdgeIn = (PIECE_RADIUS - 1.6) * (PIECE_RADIUS - 1.6)
  for (let y = Math.floor(gapCy - PIECE_RADIUS); y <= Math.ceil(gapCy + PIECE_RADIUS); y++) {
    for (let x = Math.floor(gapCx - PIECE_RADIUS); x <= Math.ceil(gapCx + PIECE_RADIUS); x++) {
      const dx = x - gapCx
      const dy = y - gapCy
      const d2 = dx * dx + dy * dy
      if (d2 > rIn) continue
      const [pr, pg, pb] = getPx(bg, x, y)
      const edge = d2 >= rEdgeIn // 块边缘加一圈浅描边，拖动时看得清
      setPx(piece, x - answerX, y, pr, pg, pb, 255)
      if (edge) {
        // 描边画在块自身像素上（往白里混 55%）
        const idx = (piece.width * y + (x - answerX)) << 2
        piece.data[idx] = Math.round(pr + (255 - pr) * 0.55)
        piece.data[idx + 1] = Math.round(pg + (255 - pg) * 0.55)
        piece.data[idx + 2] = Math.round(pb + (255 - pb) * 0.55)
      }
    }
  }

  // 3b) 再在背景上把缺口挖出来：整体压暗 + 一圈浅色描边
  fillCircle(bg, gapCx, gapCy, PIECE_RADIUS, [10, 14, 22], 0.55)
  for (let y = Math.floor(gapCy - PIECE_RADIUS); y <= Math.ceil(gapCy + PIECE_RADIUS); y++) {
    for (let x = Math.floor(gapCx - PIECE_RADIUS); x <= Math.ceil(gapCx + PIECE_RADIUS); x++) {
      const dx = x - gapCx
      const dy = y - gapCy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > PIECE_RADIUS || d < PIECE_RADIUS - 2) continue
      const [br, bgc, bb] = getPx(bg, x, y)
      setPx(
        bg,
        x,
        y,
        Math.round(br + (255 - br) * 0.7),
        Math.round(bgc + (255 - bgc) * 0.7),
        Math.round(bb + (255 - bb) * 0.7)
      )
    }
  }

  return { background: toDataUrl(bg), puzzle: toDataUrl(piece), answerX }
}

/**
 * 判分：x 命中 ±5px 容差、拖拽时长与轨迹形态合理。
 * 客户端数据（x/duration/trail）本身都可以被脚本伪造，这里挡的是"无脑直发"；
 * 真正的防刷预算花在：答案只在服务端、一题一用、取题与发信各自限流。
 */
export function verifySliderAnswer(input: SliderVerifyInput): boolean {
  const { expectedX, x, duration, trail } = input

  if (typeof x !== "number" || !Number.isFinite(x)) return false
  if (Math.abs(x - expectedX) > SLIDER_TOLERANCE_PX) return false

  if (typeof duration !== "number" || !Number.isFinite(duration)) return false
  if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) return false

  if (!Array.isArray(trail) || trail.length < MIN_TRAIL_POINTS) return false

  return true
}
