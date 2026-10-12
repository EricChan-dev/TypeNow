/**
 * 练习页的课时级偏好 —— 键名与默认值逐字对齐参考站。
 *
 * 为什么键名要照抄：用户可能两个站都开了（同一浏览器的不同标签页），键名一致
 * 才能让「我在这里选了隐藏中文」在那边也生效。这不是内部实现细节，是可观测行为。
 *
 * 全部读写都包 try/catch：隐私模式 / 存储配额满时 localStorage 会直接抛异常，
 * 而「读不到偏好」不应该让整个练习页崩掉 —— 回落到默认值即可。
 */

/** 中文提示是否显示。默认 **true**（参考站 `let showChineseHint = true`）。 */
export function showChineseKey(lessonId: string): string {
  return `lesson_${lessonId}_showChinese`
}

export function loadShowChinese(lessonId: string): boolean {
  try {
    const raw = window.localStorage.getItem(showChineseKey(lessonId))
    // 只在键**存在**时覆盖默认值；不存在就保持 true。
    // `raw === "1"` 而不是 `!== "0"`：脏数据（"abc"）应当落回默认显示。
    if (raw !== null) return raw === "1"
  } catch {
    /* 存储不可用 */
  }
  return true
}

export function saveShowChinese(lessonId: string, value: boolean): void {
  try {
    window.localStorage.setItem(showChineseKey(lessonId), value ? "1" : "0")
  } catch {
    /* ignore */
  }
}

/**
 * 答对后自动跳到下一句。默认 **关**。
 *
 * 参考站读的是 `=== 'on'`（不是 `'1'`），所以写入时也必须写 `'on'`/`'off'`,
 * 否则参考站的设置面板读不懂我们写的值。
 */
export const AUTO_NEXT_KEY = "auto_next"

export function loadAutoNext(): boolean {
  try {
    return window.localStorage.getItem(AUTO_NEXT_KEY) === "on"
  } catch {
    return false
  }
}

export function saveAutoNext(value: boolean): void {
  try {
    window.localStorage.setItem(AUTO_NEXT_KEY, value ? "on" : "off")
  } catch {
    /* ignore */
  }
}

/**
 * 连错几次后自动揭示答案。默认 **3**，`0` 表示永不揭示。
 *
 * 参考站允许 0/3/4/5 四档（设置面板是个下拉）。这里不写死合法集合，
 * 只钳制到 [0, 10]：值来自我们自己的 UI，写不进脏值。
 */
export const AUTO_REVEAL_KEY = "auto_reveal_mistake_threshold"
export const DEFAULT_AUTO_REVEAL = 3

export function loadAutoRevealThreshold(): number {
  try {
    const raw = window.localStorage.getItem(AUTO_REVEAL_KEY)
    const n = Number.parseInt(raw ?? "", 10)
    if (!Number.isFinite(n) || n < 0) return DEFAULT_AUTO_REVEAL
    return Math.min(10, n)
  } catch {
    return DEFAULT_AUTO_REVEAL
  }
}

export function saveAutoRevealThreshold(value: number): void {
  try {
    window.localStorage.setItem(AUTO_REVEAL_KEY, String(value))
  } catch {
    /* ignore */
  }
}

/**
 * 答对后原音重播次数。
 *
 * 参考站默认 1（practice.js:7410 `parseInt(localStorage.getItem('success_play_count') || '1', 10)`，
 * 静态 HTML 里 `#successPlayDisplay` 就是 `1X`），合法取值被 :7411 夹在 **[1,3]**，
 * :7526 也在 3 处循环。
 *
 * 注意 :4945 的 `successPlayCount || 2` **不是**「默认念 2 次」：`1` 是真值，
 * `1 || 2` 仍然是 1 —— 那个 `|| 2` 只在取值 falsy 时兜底，而夹取已经把
 * 这种情况排除掉了。所以设置写几就念几次，默认念 1 次。
 */
export const SUCCESS_PLAY_KEY = "success_play_count"
export const DEFAULT_SUCCESS_PLAY = 1
/** 参考站 practice.js:7411 的合法区间上界。 */
export const MAX_SUCCESS_PLAY = 3

export function loadSuccessPlayCount(): number {
  try {
    const raw = window.localStorage.getItem(SUCCESS_PLAY_KEY)
    const n = Number.parseInt(raw ?? "", 10)
    // 参考站 practice.js:7411 `if (successPlayCount < 1 || successPlayCount > 3) successPlayCount = 1`
    // —— 越界是**重置为 1**，不是夹到边界（写 9 会回到 1 而不是 3）。
    if (!Number.isFinite(n) || n < 1 || n > MAX_SUCCESS_PLAY) return DEFAULT_SUCCESS_PLAY
    return n
  } catch {
    return DEFAULT_SUCCESS_PLAY
  }
}

export function saveSuccessPlayCount(value: number): void {
  try {
    window.localStorage.setItem(SUCCESS_PLAY_KEY, String(value))
  } catch {
    /* ignore */
  }
}

/**
 * 输入框个性化（字体 / 字号 / 样式）。
 *
 * 三个键与参考站 practice-sys-controls.js 一致；`size` 钳制到 [16, 40]，
 * `style` 非 `'box'` 一律归 `'underline'` —— 与参考站的容错口径逐字一致，
 * 因为字号直接进宽度测量公式，脏值会让输入框宽度算成 NaN。
 */
export type DictationInputStyle = "underline" | "box"
export type DictationInputFont = "default" | "monospace" | "rounded" | "system"

export interface DictationInputSettings {
  font: DictationInputFont
  size: number
  inputStyle: DictationInputStyle
}

export const DEFAULT_DICTATION_INPUT_SETTINGS: DictationInputSettings = {
  font: "default",
  size: 24,
  inputStyle: "underline",
}

/** 字体族映射，与参考站 DICTATION_FONT_OPTIONS 逐字一致。 */
export const DICTATION_FONT_OPTIONS: Record<DictationInputFont, string> = {
  default: "var(--font-tech)",
  monospace: "'Outfit', sans-serif",
  rounded: "'Arial Rounded MT Bold', 'Quicksand', sans-serif",
  system: "'Playfair Display', serif",
}

/**
 * 卡片显示用的短标签，对应参考站 `updatePersonalizationDisplay()`
 * (practice-sys-controls.js:308) 里的 `labels` 表。
 */
export const DICTATION_FONT_LABELS: Record<DictationInputFont, string> = {
  default: "默认字体",
  monospace: "现代无衬线",
  rounded: "圆体",
  system: "古典优雅",
}

/**
 * 个性化模态框按钮上的长标签，对应参考站
 * `句子练习 - 句游英语.html` 里 `.font-option-btn` 的文本。
 * 与卡片标签**不同** —— `rounded` 在按钮上是「圆体字体」、在卡片上是「圆体」。
 */
export const DICTATION_FONT_MODAL_LABELS: Record<DictationInputFont, string> = {
  default: "默认字体",
  monospace: "现代无衬线",
  rounded: "圆体字体",
  system: "古典优雅",
}

const INPUT_FONT_KEY = "dictation_input_font"
const INPUT_SIZE_KEY = "dictation_input_size"
const INPUT_STYLE_KEY = "dictation_input_style"

function isInputFont(v: string): v is DictationInputFont {
  return v in DICTATION_FONT_OPTIONS
}

export function loadDictationInputSettings(): DictationInputSettings {
  const fallback = DEFAULT_DICTATION_INPUT_SETTINGS
  try {
    const fontRaw = window.localStorage.getItem(INPUT_FONT_KEY)
    const font = fontRaw && isInputFont(fontRaw) ? fontRaw : fallback.font

    const sizeRaw = Number.parseInt(window.localStorage.getItem(INPUT_SIZE_KEY) ?? "", 10)
    const size = Number.isFinite(sizeRaw) ? Math.min(40, Math.max(16, sizeRaw)) : fallback.size

    const styleRaw = window.localStorage.getItem(INPUT_STYLE_KEY)
    const inputStyle: DictationInputStyle = styleRaw === "box" ? "box" : "underline"

    return { font, size, inputStyle }
  } catch {
    return fallback
  }
}

export function saveDictationInputSettings(s: DictationInputSettings): void {
  try {
    window.localStorage.setItem(INPUT_FONT_KEY, s.font)
    window.localStorage.setItem(INPUT_SIZE_KEY, String(s.size))
    window.localStorage.setItem(INPUT_STYLE_KEY, s.inputStyle)
  } catch {
    /* ignore */
  }
}

/**
 * 把个性化设置写到壳元素上。
 *
 * 与参考站的**唯一**差异：它写 `document.documentElement`，我们写 `.practice-shell`
 * 元素。原因见 dictation-measure.ts 的 configureMeasureHost —— 我们的抽取 CSS
 * 全部收敛在 `.practice-shell` 作用域下，变量写在 :root 虽然能靠继承生效，
 * 但 `input-style-underline` 这个**类**必须落在壳内部元素上，两者放一起更好维护。
 */
export function applyPersonalization(el: HTMLElement, s: DictationInputSettings): void {
  el.style.setProperty("--dictation-input-font-family", DICTATION_FONT_OPTIONS[s.font])
  el.style.setProperty("--dictation-input-font-size", `${s.size / 10}rem`)
  // 答案回顾屏的字号跟随输入字号一起缩放，比例与参考站一致（基准 24）
  el.style.setProperty("--dictation-review-font-scale", String(s.size / 24))
  // 注意：类名要落在**壳内部的容器**上（调用方传 cyber-interface），
  // 因为抽取后的选择器是 `.practice-shell .input-style-underline …`
  el.classList.toggle("input-style-underline", s.inputStyle === "underline")
}

/**
 * ── 「更多设置」里的开关 ────────────────────────────────────────────────────
 *
 * 下面这批键的读写口径全部照抄参考站 practice.js:7421-7442：
 * **默认都是「开」**，只有显式写入 `'off'` 才关。所以判定统一写成
 * `!== 'off'`，而不是 `=== 'on'` —— 用后者的话，用户从没进过设置页时
 * 会得到「关」，与参考站首次进入的表现相反。
 */
function loadOnByDefault(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== "off"
  } catch {
    return true
  }
}

function saveOnOff(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "on" : "off")
  } catch {
    /* ignore */
  }
}

/** 答案回顾屏是否显示音标。挂 `hide-phonetics` 类到 `.practice-shell` 上。 */
export const SHOW_PHONETICS_KEY = "show_phonetics"
export function loadShowPhonetics(): boolean {
  return loadOnByDefault(SHOW_PHONETICS_KEY)
}
export function saveShowPhonetics(v: boolean): void {
  saveOnOff(SHOW_PHONETICS_KEY, v)
}

/** 复习界面底部是否显示「即将练习 N/M」预览。 */
export const NEXT_PREVIEW_KEY = "next_sentence_preview"
export function loadNextPreview(): boolean {
  return loadOnByDefault(NEXT_PREVIEW_KEY)
}
export function saveNextPreview(v: boolean): void {
  saveOnOff(NEXT_PREVIEW_KEY, v)
}

/**
 * 答对是否放烟花。默认开。
 *
 * 参考站用 canvas-confetti（约 6 秒）；我们没有这个依赖，用 `sfx.ts` 的
 * 合成音 + CSS 动画代替 —— 这是**唯一**需要替换外部资源的设置项，
 * 因为用户明确说过那 5 个音频文件没有、用现有合成音。
 */
export const CONFETTI_KEY = "confetti_effect"
export function loadConfetti(): boolean {
  return loadOnByDefault(CONFETTI_KEY)
}
export function saveConfetti(v: boolean): void {
  saveOnOff(CONFETTI_KEY, v)
}

/** 播放语音时是否显示频谱动画。 */
export const AUDIO_VISUALIZER_KEY = "audio_visualizer"
export function loadAudioVisualizer(): boolean {
  return loadOnByDefault(AUDIO_VISUALIZER_KEY)
}
export function saveAudioVisualizer(v: boolean): void {
  saveOnOff(AUDIO_VISUALIZER_KEY, v)
}

/** 按住 ⌘/Ctrl 时是否从顶部滑出快捷键提示条。 */
export const SHORTCUT_OVERLAY_KEY = "practice_shortcut_overlay"
export function loadShortcutOverlay(): boolean {
  return loadOnByDefault(SHORTCUT_OVERLAY_KEY)
}
export function saveShortcutOverlay(v: boolean): void {
  saveOnOff(SHORTCUT_OVERLAY_KEY, v)
}

/** 句子配图。参考站**默认关**（`sentence_image_enabled`，仅 `'on'` 才加载）。 */
export const SENTENCE_IMAGE_KEY = "sentence_image_enabled"
export function loadSentenceImage(): boolean {
  try {
    return window.localStorage.getItem(SENTENCE_IMAGE_KEY) === "on"
  } catch {
    return false
  }
}
export function saveSentenceImage(v: boolean): void {
  saveOnOff(SENTENCE_IMAGE_KEY, v)
}

/**
 * 「分段练习」总开关。
 *
 * 参考站 practice.js:668 的口径是
 * `localStorage.getItem('fragment_mode') === '1'` —— **默认关**，写入 `'1'`/`'0'`
 * （不是 on/off）。AND 上一个会员门控 `canUseFragmentPractice()`，但那个门控
 * 属于「能不能开」的判定，落库与否仍看这个键，所以这里只负责存取。
 */
export const FRAGMENT_MODE_KEY = "fragment_mode"
export function loadFragmentMode(): boolean {
  try {
    return window.localStorage.getItem(FRAGMENT_MODE_KEY) === "1"
  } catch {
    return false
  }
}
export function saveFragmentMode(v: boolean): void {
  try {
    window.localStorage.setItem(FRAGMENT_MODE_KEY, v ? "1" : "0")
  } catch {
    /* ignore */
  }
}

/**
 * 分段练习里的单词配图。参考站用 `!== 'false'` 判真（默认**开**），
 * 写入的是 `String(bool)` 即 `'true'`/`'false'`（practice-sys-controls.js:468-470）。
 * 不能用 `saveOnOff` —— 键值语义是布尔字符串，不是 on/off。
 *
 * 我们仓库**没有** `GET /api/searchWord/image` 接口（参考站 practice.js:8463
 * `fetchWordImage`），所以这个开关目前只负责存取偏好，界面不渲染配图位。
 */
export const FRAGMENT_IMAGE_KEY = "fragment_image_enabled"
export function loadFragmentImage(): boolean {
  try {
    return window.localStorage.getItem(FRAGMENT_IMAGE_KEY) !== "false"
  } catch {
    return true
  }
}
export function saveFragmentImage(v: boolean): void {
  try {
    window.localStorage.setItem(FRAGMENT_IMAGE_KEY, String(v))
  } catch {
    /* ignore */
  }
}

/** 底栏密度。参考站 `'compact'` 才紧凑，其余一律常规。 */
export type ToolbarDensity = "normal" | "compact"
export const TOOLBAR_DENSITY_KEY = "practice_toolbar_density"
export function loadToolbarDensity(): ToolbarDensity {
  try {
    return window.localStorage.getItem(TOOLBAR_DENSITY_KEY) === "compact" ? "compact" : "normal"
  } catch {
    return "normal"
  }
}
export function saveToolbarDensity(v: ToolbarDensity): void {
  try {
    window.localStorage.setItem(TOOLBAR_DENSITY_KEY, v)
  } catch {
    /* ignore */
  }
}

/**
 * 显示风格（主题 + 浅色背景变体）。
 *
 * 参考站的四个值见 practice.js:8030 `THEME_OPTIONS`：`dark` /
 * `light-standard` / `light-white` / `light-grey`。浅色三种都落在
 * `data-theme="light"`，差异靠 `data-light-bg`（standard 时**移除**该属性）。
 */
export type ThemeStyle = "dark" | "light-standard" | "light-white" | "light-grey"

export const THEME_STYLE_LABELS: Record<ThemeStyle, string> = {
  dark: "深色模式",
  "light-standard": "浅色标准",
  "light-white": "浅色纯白",
  "light-grey": "浅色浅灰",
}

const THEME_KEY = "app_theme"

export function loadThemeStyle(): ThemeStyle {
  try {
    const raw = window.localStorage.getItem(THEME_KEY)
    // 兼容旧值 'light'（参考站 migrateThemeSetting 也做这件事）
    if (raw === "light") return "light-standard"
    if (raw && raw in THEME_STYLE_LABELS) return raw as ThemeStyle
  } catch {
    /* ignore */
  }
  return "dark"
}

export function saveThemeStyle(v: ThemeStyle): void {
  try {
    window.localStorage.setItem(THEME_KEY, v)
  } catch {
    /* ignore */
  }
}

/** 把主题写到壳元素上（参考站写 documentElement，理由同 applyPersonalization）。 */
export function applyThemeStyle(el: HTMLElement, style: ThemeStyle): void {
  if (style === "dark") {
    el.removeAttribute("data-theme")
    el.removeAttribute("data-light-bg")
    return
  }
  el.setAttribute("data-theme", "light")
  // standard 是「没有额外属性」的那一档，靠 CSS 的默认浅色生效
  const bg = style === "light-standard" ? null : style.slice("light-".length)
  if (bg) el.setAttribute("data-light-bg", bg)
  else el.removeAttribute("data-light-bg")
}

/**
 * 极简沉浸模式。参考站键名 `cyber_immersive_mode`，存 `String(bool)`
 * （practice.js:1427 `localStorage.setItem('cyber_immersive_mode', String(isImmersiveMode))`）。
 *
 * 开启后参考站在 `document.body` 上挂 `immersive-mode`（practice.js:1425），
 * 顶栏只剩「退出沉浸」按钮（practice-cyber.css:10411 `body.immersive-mode
 * .header-left, .mode-dropdown-wrapper, .header-stats, .header-divider
 * { display:none }`）。我们把这套规则作用域改写到壳元素上，所以开关类也必须
 * 落在壳元素，而不是 `document.body` —— 理由同 applyPersonalization。
 */
export const IMMERSIVE_KEY = "cyber_immersive_mode"
export function loadImmersive(): boolean {
  try {
    return window.localStorage.getItem(IMMERSIVE_KEY) === "true"
  } catch {
    return false
  }
}
export function saveImmersive(v: boolean): void {
  try {
    window.localStorage.setItem(IMMERSIVE_KEY, String(v))
  } catch {
    /* ignore */
  }
}

/** 把沉浸模式写到壳元素上（参考站写 document.body）。 */
export function applyImmersive(el: HTMLElement, on: boolean): void {
  el.classList.toggle("immersive-mode", on)
}

/**
 * 句子自动播放次数（练习时英文语音播几遍）。参考站键名 `tts_playback_count`，
 * `0` 显示为「手动」。
 */
export const LOOP_COUNT_KEY = "tts_playback_count"
export function loadLoopCount(): number {
  try {
    const n = Number.parseInt(window.localStorage.getItem(LOOP_COUNT_KEY) ?? "", 10)
    if (!Number.isFinite(n) || n < 0) return 1
    return Math.min(5, n)
  } catch {
    return 1
  }
}
export function saveLoopCount(v: number): void {
  try {
    window.localStorage.setItem(LOOP_COUNT_KEY, String(v))
  } catch {
    /* ignore */
  }
}
