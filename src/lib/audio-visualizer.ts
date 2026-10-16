/**
 * 底栏声音频谱条（`.audio-visualizer > #audioCanvas`）的绘制层。
 *
 * 频谱条的绘制层，几何参数是反复调试后的定稿：
 * 画布 300×60、48 根柱、柱间距 2px、`globalAlpha 0.6`、填充 `#9ca3af`、
 * 柱高 `(value/255) * 60 * 0.6`、最小高度 4、居中、圆角 `min(barWidth/2, 1.5)`。
 *
 * ## 与 TTS 播放器接线的结构约束
 *
 * 我们的 `useTTSSettings` 每念一句都 `new Audio(blobUrl)`，不是全局复用同一个
 * `<audio>`，所以每次播放都得
 * 给新的元素建节点；旧节点必须 `disconnect()` 掉，否则每念一句就往
 * AudioContext 里挂一个永不释源的节点。
 *
 * ## 为什么用模块级单例而不是 React 组件
 *
 * AudioContext 与 canvas 都是「同一时刻只应有一份」的东西：练习页重新挂载
 * （切课、切模式）时若各自新建，浏览器会因 AudioContext 数量上限而静默失效。
 * 按仓库既有约定（`lib/sfx.ts`、`lib/hooks/useTTSSettings.ts`）用模块级单例。
 */

/** 柱子数量与画布尺寸（绘制函数里的几何参数与此处一致）。 */
const CANVAS_W = 300
const CANVAS_H = 60
const BAR_COUNT = 48
const BAR_GAP = 2
const BAR_COLOR = "#9ca3af"
/** 音频暂停多久后自动收尾（3000ms）。pause() 不触发 ended。 */
const PAUSE_GRACE_MS = 3000

let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let source: MediaElementAudioSourceNode | null = null
let attached: HTMLAudioElement | null = null
let raf = 0
let freqData: Uint8Array | null = null
let canvas: HTMLCanvasElement | null = null
let ctx2d: CanvasRenderingContext2D | null = null
/** 音频「已暂停」的起始时刻，用于兜底收尾。 */
let pausedSince = 0

function ensureGraph(el: HTMLAudioElement): AnalyserNode | null {
  if (attached === el && analyser) return analyser
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    if (!audioCtx) audioCtx = new Ctor()
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {})
    // 换元素时必须先断开旧节点：MediaElementAudioSourceNode 一经创建就把
    // 该元素的声音接到图里，不断开就会越积越多。
    if (source) {
      try { source.disconnect() } catch { /* ignore */ }
      source = null
    }
    source = audioCtx.createMediaElementSource(el)
    if (!analyser) {
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
    }
    source.connect(analyser)
    analyser.connect(audioCtx.destination)
    attached = el
    pausedSince = 0
    return analyser
  } catch {
    // 元素已经被别的 AudioContext 接过（同一元素只能 createMediaElementSource
    // 一次），或浏览器不支持 Web Audio —— 静默降级为「只有声音、没有频谱」。
    return null
  }
}

function paint() {
  if (!canvas) canvas = document.getElementById("audioCanvas") as HTMLCanvasElement | null
  if (!canvas) return
  if (!ctx2d) {
    ctx2d = canvas.getContext("2d")
    if (!ctx2d) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== CANVAS_W * dpr) {
      canvas.width = CANVAS_W * dpr
      canvas.height = CANVAS_H * dpr
      canvas.style.width = `${CANVAS_W}px`
      canvas.style.height = `${CANVAS_H}px`
      ctx2d.scale(dpr, dpr)
    }
  }
  if (!analyser) return

  const bufferLength = analyser.frequencyBinCount
  if (!freqData || freqData.length !== bufferLength) {
 // 用裸 Uint8Array 按 frequencyBinCount 取数。
    freqData = new Uint8Array(bufferLength)
  }
  analyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>)

  const barWidth = (CANVAS_W - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT
  ctx2d.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx2d.globalAlpha = 0.6
  ctx2d.fillStyle = BAR_COLOR
  ctx2d.beginPath()
  for (let i = 0; i < BAR_COUNT; i++) {
    const dataIndex = Math.floor((i * (bufferLength / 2.5)) / BAR_COUNT)
    const value = freqData[dataIndex]
    const barHeight = (value / 255) * CANVAS_H * 0.6
    const x = i * (barWidth + BAR_GAP)
 // y 用未夹紧的 barHeight 算，但绘制高度夹到至少 4px。
    const y = (CANVAS_H - barHeight) / 2
    const h = Math.max(barHeight, 4)
    const radius = Math.min(barWidth / 2, 1.5)
    if (typeof ctx2d.roundRect === "function") ctx2d.roundRect(x, y, barWidth, h, radius)
    else ctx2d.rect(x, y, barWidth, h)
  }
  ctx2d.fill()
}

function loop() {
  // 音频已经停下超过 3s 就自己收尾：pause() 不触发 ended，若只靠外部
  // 调 stopVisualizer，遇到「播放被打断」的路径会让 rAF 永远转下去。
  if (attached && attached.paused && !attached.seeking) {
    if (!pausedSince) pausedSince = Date.now()
    else if (Date.now() - pausedSince > PAUSE_GRACE_MS) {
      stopVisualizer()
      return
    }
  } else {
    pausedSince = 0
  }
  paint()
  raf = requestAnimationFrame(loop)
}

/**
 * 开始绘制。`el` 是当前正在播的 `<audio>`；传 null 表示只清空、不接线。
 * 幂等：重复调用不会叠加 rAF。
 */
export function startVisualizer(el: HTMLAudioElement | null): void {
  if (el) ensureGraph(el)
  if (raf) return
  raf = requestAnimationFrame(loop)
}

/** 停止绘制并清空画布。安全重复调用。 */
export function stopVisualizer(): void {
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  if (ctx2d && canvas) ctx2d.clearRect(0, 0, canvas.width, canvas.height)
  pausedSince = 0
  // 保留 analyser/canvas 引用以复用；只断开当前元素。
  if (source) {
    try { source.disconnect() } catch { /* ignore */ }
    source = null
  }
  attached = null
}

/** 测试与热重载用：彻底释放 AudioContext。 */
export function disposeVisualizer(): void {
  stopVisualizer()
  if (source) {
    try { source.disconnect() } catch { /* ignore */ }
  }
  source = null
  attached = null
  analyser = null
  canvas = null
  ctx2d = null
  freqData = null
  if (audioCtx) {
    void audioCtx.close().catch(() => {})
    audioCtx = null
  }
}
