/**
 * 输入槽宽度测量 —— measureWordInputWidth / adjustInputDynamicWidth 两个入口都在这里。
 *
 * 为什么必须有这一层：每个输入框的宽度**不是 CSS 算的**，是用一个隐藏的
 * 探针元素量出这段文字的真实像素宽，再加上若干按字号缩放的余量反推出来的。
 * 所以字体、字号、内边距、边框宽任何一项变了，算出的宽度都会变 —— 这正是
 * `--dictation-input-font-size` 变更后必须 `invalidateMeasureCache()` 的原因。
 *
 * 不照抄这套机制的后果：槽位要么把长词裁掉（宽度不够），要么整行间距松垮
 * （统一给一个够大的宽度），观感一眼就能看出差别。
 *
 * 实现上按 React 的方式重写，但**数值公式逐字保留**（含那些 magic number：
 * 0.18 / 0.10 / 0.45 / 0.35 / 28）。这些数字是反复调试出来的手感，不是随便写的。
 */

/** 探针与被测文字之间允许的像素误差（浮点测量会有亚像素抖动）。 */
const WIDTH_EPSILON = 0.01

/** 从探针上读出的、参与宽度计算的排版数值。 */
interface MeasureStyle {
  paddingLeft: number
  paddingRight: number
  borderLeftWidth: number
  borderRightWidth: number
  fontSizeNum: number
}

interface MeasureContext {
  host: HTMLElement
  probe: HTMLInputElement
  span: HTMLSpanElement
}

let ctx: MeasureContext | null = null

/** 样式缓存按需失效：个性化设置变更后必须调，否则量的还是旧字号的宽。 */
let cachedStyle: MeasureStyle | null = null

/**
 * 指定测量元素的宿主容器。
 *
 * **必须传带 `.input-style-underline` 类的那个壳元素**，不能挂在 document.body 上，
 * 有两个原因：
 * 1. 我们的字体变量定义在 `.practice-shell` 作用域下（不是 `:root` 全局）：挂到 body
 *      的探针读不到 `--font-tech` / `--dictation-input-font-size`，量出来的宽会整体
 *      偏小，表现为「长词被裁」。
 * 2. `input-style-underline` 的选择器是 `.practice-shell .input-style-underline …`
 *      （必须是后代），所以这个类只能落在 `.practice-shell` **内部**的元素上 ——
 *      传 `cyber-interface` 正是这个元素。探针挂进它里面，才能量到横线模式下的
 *      内边距/边框。
 */
export function configureMeasureHost(host: HTMLElement | null): void {
  if (ctx && ctx.host === host) return
  disposeMeasureElements()
  if (!host) return
  if (typeof document === "undefined") return

  const probe = document.createElement("input")
  probe.type = "text"
  probe.className = "word-input"
  probe.setAttribute("aria-hidden", "true")
  probe.tabIndex = -1
  probe.size = 1
  // width:1px 是为了让 scrollWidth 反映内容宽而不是被元素宽截断
  probe.style.cssText =
    "position:absolute;visibility:hidden;left:-9999px;top:-9999px;width:1px;min-width:0;max-width:none;"

  const span = document.createElement("span")
  span.setAttribute("aria-hidden", "true")
  span.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:-9999px;white-space:pre;"

  host.appendChild(probe)
  host.appendChild(span)
  ctx = { host, probe, span }
}

/** 把探针的排版样式同步给 span，两者必须完全一致，否则两个宽不可比。 */
function syncMeasureStyle(c: MeasureContext): MeasureStyle {
  if (cachedStyle) return cachedStyle
  const cs = window.getComputedStyle(c.probe)
  const style: MeasureStyle = {
    paddingLeft: parseFloat(cs.paddingLeft) || 0,
    paddingRight: parseFloat(cs.paddingRight) || 0,
    borderLeftWidth: parseFloat(cs.borderLeftWidth) || 0,
    borderRightWidth: parseFloat(cs.borderRightWidth) || 0,
    fontSizeNum: parseFloat(cs.fontSize) || 16,
  }
  c.span.style.fontFamily = cs.fontFamily
  c.span.style.fontSize = cs.fontSize
  c.span.style.fontWeight = cs.fontWeight
  c.span.style.fontStyle = cs.fontStyle
  c.span.style.letterSpacing = cs.letterSpacing
  c.span.style.textTransform = cs.textTransform
  c.span.style.lineHeight = cs.lineHeight
  cachedStyle = style
  return style
}

/**
 * 清除探针本身的行内宽度等干扰项 —— 探针也带 `word-input` 类，会吃到
 * `.word-input` 的规则，但它必须是「裸样式」才能量准。
 */
export function invalidateMeasureCache(): void {
  cachedStyle = null
}

/** 组件卸载时清理，避免多次挂载累积隐藏节点。 */
export function disposeMeasureElements(): void {
  if (!ctx) return
  ctx.probe.remove()
  ctx.span.remove()
  ctx = null
  cachedStyle = null
}

/**
 * 量一个词在输入框里需要多宽。
 *
 * @param word      要量的文字（原词）
 * @param isCompact 紧凑布局（窄屏）。方框模式下作为最小宽度传入。
 */
export function measureWordInputWidth(word: string, isCompact = false): number {
  const c = ctx
  const minWidth = isCompact ? 80 : 100
  if (!c) {
    // 宿主还没就绪（SSR / 首帧 effect 之前）：给一个保守的估算，
    // 绝不返回 0（0 宽输入框用户看不见）
    return Math.max(minWidth, word.length * 14 + 24)
  }
  const style = syncMeasureStyle(c)
  // 横线模式判定读**宿主自己**的类，不是 document.body —— 我们的抽取结果把
  // `input-style-underline` 收敛成 `.practice-shell .input-style-underline …`，
  // 只会出现在壳内部元素上（见 configureMeasureHost 的说明）。
  const isUnderlineMode = c.host.classList.contains("input-style-underline")

  c.probe.value = word
  c.span.textContent = word

  const textRectWidth = c.span.getBoundingClientRect().width
  const contentScrollWidth = Math.max(0, c.probe.scrollWidth - style.paddingLeft - style.paddingRight)
  const renderedContentWidth = Math.max(textRectWidth, contentScrollWidth)

  if (isUnderlineMode) {
    // 横线模式：文字下方有下划线，两端需要余量避免小写字母贴边
    const horizontalBuffer = Math.max(8, style.fontSizeNum * 0.18)
    const caretBuffer = Math.max(4, style.fontSizeNum * 0.1)
    const averageCharWidth = word.length > 0 ? textRectWidth / word.length : style.fontSizeNum * 0.5
    // 长词更容易被裁：平均字符宽越大，需要越多余量
    const longWordBuffer = word.length >= 7 ? Math.max(10, averageCharWidth * 0.45) : 0
    // 撇号/连字符结尾会让最后一个字符的视觉边界更靠右
    const punctTailBuffer = /['\-]/.test(word) ? Math.max(6, averageCharWidth * 0.35) : 0
    const width =
      textRectWidth +
      style.paddingLeft +
      style.paddingRight +
      style.borderLeftWidth +
      style.borderRightWidth +
      horizontalBuffer +
      caretBuffer +
      longWordBuffer +
      punctTailBuffer
    return Math.ceil(Math.max(28, width))
  }

  // 方框模式：光标更宽、边框更厚，需要额外防裁余量
  const averageCharWidth = word.length > 0 ? renderedContentWidth / word.length : style.fontSizeNum * 0.5
  const caretBuffer = Math.max(18, style.fontSizeNum * 0.35)
  const antiClipBuffer = Math.max(8, style.fontSizeNum * 0.15)
  const longWordBuffer = word.length >= 7 ? Math.max(10, averageCharWidth * 0.45) : 0
  const width =
    renderedContentWidth +
    style.paddingLeft +
    style.paddingRight +
    style.borderLeftWidth +
    style.borderRightWidth +
    caretBuffer +
    antiClipBuffer +
    longWordBuffer
  return Math.ceil(Math.max(minWidth, width))
}

/**
 * 打字时动态放宽当前输入框（adjustInputDynamicWidth）。
 *
 * 语义：**宽度只会从「基准宽」往上涨，不会缩回基准以下**。
 *   - 输入比原词长 → 按当前内容量宽（可能超出基准）
 *   - 输入与原词等长 → 允许比基准宽（某些字符比原词更胖），否则回基准
 *   - 其他（更短）→ 回基准
 * 所以用户删字时框会缩回原词的宽，而不是跟着一路缩到看不见。
 *
 * @returns 应该应用的像素宽
 */
export function dynamicInputWidth(
  currentValue: string,
  baseWidth: number,
  targetWord: string,
  isCompact = false,
): number {
  const val = currentValue
  const target = targetWord
  if (val.length > target.length) {
    return Math.max(baseWidth, measureWordInputWidth(val, isCompact))
  }
  if (val.length > 0 && val.length === target.length) {
    const actual = measureWordInputWidth(val, isCompact)
    return actual > baseWidth ? actual : baseWidth
  }
  return baseWidth
}

/** 给测试用：断言测量模块没有把节点留在 DOM 里。 */
export function _hasMeasureElements(): boolean {
  return ctx !== null
}

export { WIDTH_EPSILON }
