import { describe, it, expect } from "vitest"
import { PNG } from "pngjs"
import {
  generateSliderPuzzle,
  verifySliderAnswer,
  SLIDER_MIN_X,
  SLIDER_MAX_X,
  SLIDER_BG_WIDTH,
  SLIDER_BG_HEIGHT,
  SLIDER_PUZZLE_WIDTH,
  SLIDER_TOLERANCE_PX,
} from "@/lib/slider-captcha"

function parseDataUrl(dataUrl: string): PNG {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
  expect(m).not.toBeNull()
  return PNG.sync.read(Buffer.from(m![1], "base64"))
}

const passInput = { x: 120, duration: 800, trail: [[100, 10], [110, 12], [120, 12]] }

describe("verifySliderAnswer", () => {
  it("正中答案与容差内（±4px）都通过", () => {
    expect(verifySliderAnswer({ expectedX: 120, ...passInput })).toBe(true)
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, x: 120 - (SLIDER_TOLERANCE_PX - 1) })).toBe(true)
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, x: 120 + (SLIDER_TOLERANCE_PX - 1) })).toBe(true)
  })

  it("超出容差（±6px）拒绝", () => {
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, x: 120 + SLIDER_TOLERANCE_PX + 1 })).toBe(false)
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, x: 120 - SLIDER_TOLERANCE_PX - 1 })).toBe(false)
  })

  it("x 不是有限数字直接拒绝", () => {
    for (const bad of [undefined, null, "120", NaN, Infinity, { x: 120 }]) {
      expect(verifySliderAnswer({ expectedX: 120, ...passInput, x: bad as unknown as number })).toBe(false)
    }
  })

  it("拖拽时长异常（瞬间提交 / 超长重放）拒绝", () => {
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, duration: 0 })).toBe(false)
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, duration: 10 })).toBe(false)
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, duration: 61_000 })).toBe(false)
    expect(verifySliderAnswer({ expectedX: 120, ...passInput, duration: undefined })).toBe(false)
  })

  it("没有拖拽轨迹拒绝（正常拖拽 rc-slider-captcha 必然采集）", () => {
    expect(verifySliderAnswer({ expectedX: 120, x: 120, duration: 800, trail: [] })).toBe(false)
    expect(verifySliderAnswer({ expectedX: 120, x: 120, duration: 800, trail: [[100, 10]] })).toBe(false)
    expect(verifySliderAnswer({ expectedX: 120, x: 120, duration: 800, trail: undefined })).toBe(false)
  })
})

describe("generateSliderPuzzle", () => {
  it("背景 320x160 不透明，拼图 60x160 且含透明区", () => {
    const q = generateSliderPuzzle()
    const bg = parseDataUrl(q.background)
    const piece = parseDataUrl(q.puzzle)
    expect(bg.width).toBe(SLIDER_BG_WIDTH)
    expect(bg.height).toBe(SLIDER_BG_HEIGHT)
    expect(piece.width).toBe(SLIDER_PUZZLE_WIDTH)
    expect(piece.height).toBe(SLIDER_BG_HEIGHT)

    let opaqueBg = 0
    let opaquePiece = 0
    for (let i = 3; i < bg.data.length; i += 4) if (bg.data[i] === 255) opaqueBg++
    for (let i = 3; i < piece.data.length; i += 4) if (piece.data[i] === 255) opaquePiece++
    expect(opaqueBg).toBe(bg.width * bg.height) // 背景无透明像素
    expect(opaquePiece).toBeGreaterThan(0) // 拼图块存在
    expect(opaquePiece).toBeLessThan(piece.width * piece.height) // 其余透明
  })

  it("答案落在允许区间内且为整数，每次出题位置随机", () => {
    const xs = new Set<number>()
    for (let i = 0; i < 20; i++) {
      const q = generateSliderPuzzle()
      expect(Number.isInteger(q.answerX)).toBe(true)
      expect(q.answerX).toBeGreaterThanOrEqual(SLIDER_MIN_X)
      expect(q.answerX).toBeLessThanOrEqual(SLIDER_MAX_X)
      xs.add(q.answerX)
    }
    expect(xs.size).toBeGreaterThan(3) // 20 次出题不可能挤在 4 个位置
  })

  it("出题 → 判分自洽：按答案作答必过", () => {
    const q = generateSliderPuzzle()
    expect(verifySliderAnswer({ expectedX: q.answerX, ...passInput, x: q.answerX })).toBe(true)
  })

  it("拼图块的水平中心在图片中线（VerifyParam.x 以图片左缘计，块心=左缘+30）", () => {
    // rc-slider-captcha 以拼图图片左缘对齐滑块位置：图片左缘到 x 时，块心在
    // x+30。要使 VerifyParam.x == answerX 时块心正好压在缺口心（answerX+30），
    // 块的水平中心必须落在图片中线 30 上 —— 这是对齐坐标系的自洽性。
    const q = generateSliderPuzzle()
    const piece = parseDataUrl(q.puzzle)
    let minX = piece.width
    let maxX = -1
    for (let y = 0; y < piece.height; y++) {
      for (let x = 0; x < piece.width; x++) {
        if (piece.data[(piece.width * y + x) * 4 + 3] === 255) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
    }
    expect(minX).toBeLessThanOrEqual(maxX)
    expect((minX + maxX) / 2).toBeCloseTo(SLIDER_PUZZLE_WIDTH / 2, 0)
  })
})
