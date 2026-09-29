/**
 * 封面自查工具：把 176 张封面拼成「接触印相表」供人眼扫查，并做客观的配色漂移检测。
 *
 * 用法：
 *   npx tsx scripts/review-course-covers.ts
 *
 * 产物（都在 .covers-build/review/，不进仓库）：
 *   sheet-flat-N.jpg / sheet-water-N.jpg  每张 12 张封面 + 文件名标注
 *   stats.json                            每张图的饱和度/明度/主色统计
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 *
 * 176 张图不可能逐张打开看，但「全都扫一遍」又是必须的 —— 已知的三类问题
 * （画面乱码文字、水彩手写体落款、配色随场景漂移）都只能靠看发现。
 * 拼图把 176 次查看压缩成十几次；配色漂移则更进一步用统计量客观标出，
 * 不依赖我当时的眼力（v2 那次的冷调单色就是漏看过的）。
 *
 * ── 为什么不用视觉模型自动判定 ──────────────────────────────────────────────
 *
 * 「这算不算乱码文字」没有可靠的自动判据，而误报会让我去重跑本来没问题的图
 * （每张 0.14 元 + 十几秒）。所以自动化只用在**有明确数学定义**的那一项（配色），
 * 其余交给人眼。
 */

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

import { COVER_THEME_SLOTS, themeSlug } from "@/lib/course-cover-themes"

const ROOT = path.join(__dirname, "..")
const COVER_DIR = path.join(ROOT, "public", "images", "courses")
const OUT_DIR = path.join(ROOT, ".covers-build", "review")

// sharp 不在顶层依赖里（它是 next 的 optionalDependency，pnpm 未提升），
// 从 next 的 package.json 作锚点解析即可，不新增依赖
const cwdRequire = createRequire(path.join(ROOT, "scripts", ".resolve-anchor.cjs"))
const nextRequire = createRequire(cwdRequire.resolve("next/package.json"))
const sharp = nextRequire("sharp") as typeof import("sharp")

/**
 * 风格按**变体号**判定，不再按大类。
 *
 * 第一版是「一个大类一种风格」，所以按大类分组是对的；第二版改成
 * 「每个槽位的 v1/v2/v3 分别是扁平/水彩/3D 卡通」，再按大类分组就会把
 * 三种风格混在一组里算统计量，均值与标准差都没意义（实测把 72 张标成 flat、
 * 60 张标成 water，而这两组里各自混着三种风格）。
 *
 * 变体号与风格的对应关系写死在生成脚本的 SCENES 里，这里用同一套约定。
 */
type StyleGroup = "v1-flat" | "v2-water" | "v3-toon"

function styleOfName(name: string): StyleGroup {
  if (name.endsWith("__v1")) return "v1-flat"
  if (name.endsWith("__v2")) return "v2-water"
  return "v3-toon"
}

const THUMB_W = 360
const THUMB_H = 240 // 3:2，与原图一致
const LABEL_H = 26
const PER_SHEET = 12
const COLS = 4

/** 用 SVG 画一个带文件名标注的单元格 —— sharp 没有原生文字合成，走 SVG data URI 最省事 */
function cellSvg(label: string, w: number, h: number): Buffer {
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  return Buffer.from(
    `<svg width="${w}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${LABEL_H}" fill="#111827"/>
      <text x="6" y="17" font-family="Menlo,monospace" font-size="12" fill="#e5e7eb">${safe}</text>
    </svg>`,
  )
}

interface Stat {
  name: string
  style: StyleGroup
  /** 平均饱和度 0~1（HSV 的 S） */
  saturation: number
  /** 平均明度 0~1（HSV 的 V） */
  brightness: number
  /** 主色相角度 0~360（按像素加权） */
  hue: number
  /** 暖色像素占比（色相在橙红黄区间），用于识别「塌成冷调单色」 */
  warmRatio: number
}

async function analyse(file: string, name: string, style: StyleGroup): Promise<Stat> {
  // 缩到 96px 再统计：足够稳定，且避免对 1440px 原图逐像素循环。
  // removeAlpha 保证恒为 3 通道，下面的下标运算才不用按 channels 分支。
  const { data, info } = await sharp(file)
    .resize(96, 96, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const ch = info.channels
  let sSum = 0
  let vSum = 0
  let hueX = 0
  let hueY = 0
  let warm = 0
  const n = info.width * info.height

  for (let i = 0; i < n; i++) {
    const r = data[i * ch] / 255
    const g = data[i * ch + 1] / 255
    const b = data[i * ch + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    const s = max === 0 ? 0 : d / max
    sSum += s
    vSum += max

    if (d > 0.0001) {
      let h: number
      if (max === r) h = ((g - b) / d) % 6
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h = ((h * 60) % 360 + 360) % 360
      // 用饱和度作权重：灰像素的色相没有意义，不该参与主色计算
      const w = s
      hueX += Math.cos((h * Math.PI) / 180) * w
      hueY += Math.sin((h * Math.PI) / 180) * w
      // 暖色区间：红(345~360,0~20) / 橙黄(20~70)
      if (s > 0.15 && (h <= 70 || h >= 345)) warm++
    }
  }

  const hue = ((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360
  return {
    name,
    style,
    saturation: sSum / n,
    brightness: vSum / n,
    hue,
    warmRatio: warm / n,
  }
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
}
function std(xs: number[]): number {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const names: { name: string; file: string; style: StyleGroup; slug: string }[] = []
  for (const slot of COVER_THEME_SLOTS) {
    const slug = themeSlug(slot.categoryKey, slot.subCategoryKey)
    for (let v = 1; v <= 4; v++) {
      const name = `${slug}__v${v}`
      const file = path.join(COVER_DIR, `${name}.webp`)
      if (fs.existsSync(file)) names.push({ name, file, style: styleOfName(name), slug })
    }
  }
  console.log(`找到 ${names.length} 张已转码的封面`)

  // ── 1. 统计 ────────────────────────────────────────────────────────────────
  const stats: Stat[] = []
  for (const it of names) stats.push(await analyse(it.file, it.name, it.style))
  fs.writeFileSync(path.join(OUT_DIR, "stats.json"), JSON.stringify(stats, null, 2))

  for (const style of ["v1-flat", "v2-water", "v3-toon"] as const) {
    const group = stats.filter((s) => s.style === style)
    if (!group.length) continue
    console.log(`\n[${style}] ${group.length} 张`)
    for (const key of ["saturation", "brightness", "warmRatio"] as const) {
      const vals = group.map((s) => s[key])
      const m = mean(vals)
      const sd = std(vals)
      console.log(`  ${key.padEnd(12)} 均值 ${m.toFixed(3)}  标准差 ${sd.toFixed(3)}`)
      // 2σ 以外的标出来 —— 配色漂移正是这样一张一张冒出来的
      const outliers = group.filter((s) => Math.abs(s[key] - m) > 2 * sd)
      for (const o of outliers.slice(0, 4)) {
        console.log(`    ⚠ ${o.name}  ${key}=${o[key].toFixed(3)}`)
      }
    }
  }

  // ── 2. 接触印相表 ──────────────────────────────────────────────────────────
  for (const style of ["v1-flat", "v2-water", "v3-toon"] as const) {
    const group = names.filter((n) => n.style === style)
    for (let s = 0; s < Math.ceil(group.length / PER_SHEET); s++) {
      const chunk = group.slice(s * PER_SHEET, (s + 1) * PER_SHEET)
      const rows = Math.ceil(chunk.length / COLS)
      const sheetW = COLS * THUMB_W
      const sheetH = rows * (THUMB_H + LABEL_H)

      const composites: Parameters<ReturnType<typeof sharp>["composite"]>[0] = []
      for (let i = 0; i < chunk.length; i++) {
        const col = i % COLS
        const row = Math.floor(i / COLS)
        const left = col * THUMB_W
        const top = row * (THUMB_H + LABEL_H)
        const thumb = await sharp(chunk[i].file)
          .resize(THUMB_W, THUMB_H, { fit: "cover" })
          .jpeg({ quality: 86 })
          .toBuffer()
        composites.push({ input: thumb, left, top })
        composites.push({ input: cellSvg(chunk[i].name, THUMB_W, LABEL_H), left, top: top + THUMB_H })
      }

      const out = path.join(OUT_DIR, `sheet-${style}-${s + 1}.jpg`)
      await sharp({
        create: { width: sheetW, height: sheetH, channels: 3, background: "#1f2937" },
      })
        .composite(composites)
        .jpeg({ quality: 84 })
        .toFile(out)
      console.log(`拼图 ${path.relative(ROOT, out)}  （${chunk.length} 张，${sheetW}x${sheetH}）`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
