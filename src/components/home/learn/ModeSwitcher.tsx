"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  PRACTICE_MODE_LABELS,
  PRACTICE_MODES,
  switchModeConfirmText,
  type PracticeMode,
} from "@/lib/practice-mode"

/**
 * 顶部「练习模式」下拉切换器 —— 听写页与非听写页**共用**。
 *
 * 为什么要抽成组件：参考站四种模式共用同一个顶栏，切换器常驻在
 * `.header-right` 里（`practice.js:1351 switchMode`）。我们重写听写模式时
 * 只在 `DictationPractice` 里实现了一份，当时拼图/学习/口语仍走旧的
 * `LearnClient` —— 那个界面是 Tailwind 写的、没有顶栏，于是切过去之后
 * **没有入口切回来**。抽出来两处共用，切换器才真正成为「模式底座」。
 * （后来四种模式全部收编进 `DictationPractice`，那个旧界面已连同
 * `LearnClient` 整棵树删除；组件这层抽象保留，因为它仍然是唯一入口。）
 *
 * 样式来自参考站，但作用域前缀是 `.mode-switcher-scope` 而不是
 * `.practice-shell`：当初非听写模式整棵树都不在 `.practice-shell` 里，
 * 用后者一条规则都命中不了。规则由 `scripts/extract-practice-css.py`
 * 从同一份参考 CSS 生成到 `mode-switcher.css`，不手写、不复制。
 *
 * ⚠️ 这份第二作用域现在仍然**必须**保留，不是历史遗留：它的规则带
 * `:not(:where(.practice-shell) *)` 守卫，而在 `.practice-shell` 内部
 * 依然命中 —— 实测听写页里 `.mode-switcher-scope` 这条守卫为 false，
 * 但 `mode-dropdown` / `mdt-` / `custom-modal` 三族共 7 条后代规则照常生效。
 * 换句话说 `.practice-shell` 那份（`practice.css`）管不到切换器的这几族，
 * 删掉这份文件下拉就会退化成无样式裸按钮。
 *
 * 切换确认弹窗用 portal 挂到 `.practice-shell`（拿不到才退回 `body`）：
 * 参考站把它挂在 `body` 下（`modal.js:12`），但我们的主题变量写在壳上。
 * 而若**就地**渲染，弹窗会落进那些带 `transform`/`will-change` 的祖先里
 * —— 参考 CSS 的 `position:fixed` 会改以那个祖先为 containing block，
 * 遮罩盖不满视口（内联口语条就踩过这个坑）。portal 出来就没有这层祖先。
 * portal 出来的那层也要带上 `.mode-switcher-scope`，否则
 * `.custom-modal-*` 那些后代规则匹配不到、CSS 变量也解析不出来。
 */
export function ModeSwitcher({
  courseId,
  lessonId,
  mode,
  completedCount,
}: {
  courseId: string
  lessonId: string
  mode: PracticeMode
  /** 已完成句数。> 0 才弹「会结束当前进度」的确认框，同参考站 `practice.js:1279`。 */
  completedCount: number
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<PracticeMode | null>(null)
  /**
   * 确认弹窗的挂载点。
   *
   * **不能**挂 `document.body`：弹窗颜色全走 `var(--neon-cyan)` 等变量，而
   * 主题变量是写在 `.practice-shell` 上的（`applyThemeStyle`，参考站写
   * `document.body`，我们收敛到壳元素）。挂 body 就落在变量作用域之外，
   * 浅色主题下弹窗仍是深色霓虹（实测：`--neon-cyan` 在壳上是 `#0c4a6e`，
   * 而挂 body 的弹窗量到 `rgb(0,240,255)`）。
   *
   * 挂到 `.practice-shell` 上还有个附带好处：它 `transform` 为 `none`，
   * `position:fixed` 仍以视口为 containing block。反过来，听写页里
   * `.learning-container` 带 `animation: … forwards`（留下非 none 的 computed
   * transform）、`.cyber-header` 带 `backdrop-filter`，**两者都会成为
   * containing block**，弹窗若渲染在它们内部就盖不满视口 —— 这正是内联口语条
   * 踩过的坑，也是这里必须 portal 的原因。
   *
   * 旧界面（拼图/学习/口语）没有 `.practice-shell`，退回 `document.body`；
   * 那边没有浅色主题，弹窗用第二份 CSS 自带的深色默认变量即可。
   *
   * 在点击处理里解析而**不是** effect 里：`react-hooks/set-state-in-effect`
   * 会拦，且首帧也不需要弹窗（同 `InlineSpeakingBar` 的处理）。
   */
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)

  const openConfirm = (m: PracticeMode) => {
    setPortalHost(document.querySelector<HTMLElement>(".practice-shell") ?? document.body)
    setPendingMode(m)
  }

  const goto = (m: PracticeMode) => {
    window.location.href = `/home/learn/${courseId}?lesson=${lessonId}&mode=${m}`
  }

  /**
   * ESC 关确认弹窗。
   *
   * 用 `stopImmediatePropagation`：父级（听写页）也在 document 上挂了 ESC
   * 监听去关各种浮层，而**子组件的 effect 先于父组件注册**，所以我们一定
   * 先收到事件。不停掉的话一次 ESC 会同时关掉弹窗和它下面那层浮层。
   * 参考站等价：`modal.js:53-59` 的 ESC 监听是弹窗创建时才挂的，
   * 当时页面上只有它能收到事件。
   */
  useEffect(() => {
    if (pendingMode === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopImmediatePropagation()
      setPendingMode(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [pendingMode])

  const overlay = pendingMode !== null && (
    <div className="mode-switcher-scope">
      {/* 参考站点遮罩即关（`modal.js` `if (e.target === overlay) close`） */}
      <div
        className="custom-modal-overlay"
        id="customModalOverlay"
        onClick={(e) => { if (e.target === e.currentTarget) setPendingMode(null) }}
      >
        <div className="custom-modal">
          <div className="custom-modal-title">切换练习模式</div>
          <div className="custom-modal-message">{switchModeConfirmText(mode, pendingMode)}</div>
          <div className="custom-modal-buttons">
            <button
              type="button"
              className="custom-modal-button custom-modal-button-cancel"
              id="modalCancelBtn"
              onClick={() => setPendingMode(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="custom-modal-button custom-modal-button-confirm"
              id="modalConfirmBtn"
              onClick={() => {
                const target = pendingMode
                setPendingMode(null)
                goto(target)
              }}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/*
        `display: contents` 让这层不生成盒子：它的子节点直接参与外层 flex
        布局，`.header-right` 里的排版与抽取前逐像素一致；而自定义属性照常
        继承下来，`.mode-switcher-scope .mode-dropdown-*` 依然命中。
      */}
      <div className="mode-switcher-scope" style={{ display: "contents" }}>
        <div className={`mode-dropdown-wrapper${menuOpen ? " open" : ""}`}>
          <button
            type="button"
            className="mode-dropdown-trigger"
            id="modeDropdownTrigger"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="mdt-icon" id="modeDropdownIcon"><ModeIcon mode={mode} /></span>
            <span className="mdt-text" id="modeDropdownText">{PRACTICE_MODE_LABELS[mode]}</span>
            <svg className="mdt-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {/*
            常驻 DOM + `.open` 切换，理由同设置面板：移植过来的基础规则是
            `display:none`，`.mode-dropdown-wrapper.open` 才 `display:block`
            （reference practice-cyber.css:874/890）。条件渲染虽然也能出效果，
            但会让 `#modeDropdownMenu` 在关着时不存在，DOM 与参考站不一致。
          */}
          <div className="mode-dropdown-menu" id="modeDropdownMenu">
            {PRACTICE_MODES.map((m) => (
              <button
                key={m}
                type="button"
                id={`mode${m === "dictation" ? "Dictation" : m === "puzzle" ? "Puzzle" : m === "learning" ? "Learning" : "Speaking"}`}
                data-mode={m}
                className={`mode-dropdown-item${m === mode ? " active" : ""}`}
                disabled={m === mode}
                onClick={() => {
                  setMenuOpen(false)
                  if (m === mode) return
                  // 已有进度才提示；切换会结束当前进度并从句首重来
                  // （参考站 practice.js:1279 `if (completedCount > 0)`）。
                  if (completedCount > 0) { openConfirm(m); return }
                  goto(m)
                }}
              >
                <ModeIcon mode={m} />
                <span>{PRACTICE_MODE_LABELS[m]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {overlay && portalHost && createPortal(overlay, portalHost)}
    </>
  )
}

/** 四种模式各一个小图标，形状照参考站顶栏的 inline SVG 重画。 */
function ModeIcon({ mode }: { mode: PracticeMode }) {
  const paths: Record<PracticeMode, string> = {
    dictation: "M3 7h18M3 12h18M3 17h10",
    puzzle: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    learning: "M4 5h16v14H4zM4 9h16",
    speaking: "M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[mode]} />
    </svg>
  )
}
