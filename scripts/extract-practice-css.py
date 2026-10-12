#!/usr/bin/env python3
"""从参考站 practice-cyber.css 抽取「听写模式」所需规则，并把选择器收敛到 .practice-shell 下。

为什么要这么做：参考 CSS 完全不限定作用域（含 body / html / :root / [data-theme] 全局
选择器），直接 import 会把整个应用重刷一遍。本仓既有约定是所有参考页样式挂在作用域类下
（见 src/app/home/layout.tsx 对 .home-ref-shell 的说明）。

用法：python3 scripts/extract-practice-css.py
源文件：~/Downloads/句子练习 - 句游英语_files/practice-cyber.css
输出：  src/app/home/learn/practice.css
"""
import os
import re
import sys

HOME = os.path.expanduser("~")
SRC = os.path.join(HOME, "Downloads", "句子练习 - 句游英语_files", "practice-cyber.css")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src/app/home/learn/practice.css")
PREFIX = ".practice-shell"

# 第二个作用域：**模式切换器**（顶部下拉 + 切换确认弹窗）是听写页与非听写页
# 共用的组件。听写页整页在 .practice-shell 里，样式自然命中；但拼图/学习/口语
# 三种模式目前仍走旧的 LearnClient（Tailwind 界面，**没有** .practice-shell），
# 照搬 .practice-shell 前缀会一条都命中不了 —— 下拉会退化成无样式裸按钮。
# 所以同一个组件所需的那一小撮规则用第二个前缀另出一份文件，
# 组件自己挂 .mode-switcher-scope 承载。规则仍由本脚本从参考站抽取，
# 不手写、不复制粘贴，避免两份源码走偏。
OUT2 = os.path.join(REPO, "src/app/home/learn/mode-switcher.css")
PREFIX2 = ".mode-switcher-scope"
# 模式切换器所需的选择器关键字。刻意只收这三族：下拉本体、下拉内部件、
# 切换确认弹窗。其余（cyber-header / control-dock / info-card …）都属于整页骨架，
# 不该跟着第二份文件进 LearnClient。
MODE_SWITCHER_INCLUDE = ["mode-dropdown", "mdt-", "custom-modal"]

# 听写模式实际用到的选择器关键字（按参考页 DOM 实测枚举）
INCLUDE = [
    # 外框骨架
    "cyber-interface", "cyber-header", "cyber-main", "footer-stack",
    # 底栏外层的固定定位容器。**必须显式列出**：`.cyber-footer` 的基类规则
    # （position:fixed / bottom:0 / left:0 / right:0 / display:flex /
    # justify-content:center / padding 8px 0 12px / z-index:100 /
    # pointer-events:none）不含上面任何子串，只列 footer-stack 会得到
    # 「内部排版对、外层不固定」的半截结果 —— 底栏会落回文档流。
    "cyber-footer",
    # 顶栏
    "header-left", "header-right", "header-course-info", "course-name", "course-sep",
    "unit-name", "btn-abort", "mode-dropdown", "mdt-", "header-divider",
    "header-stats", "timer-display", "timer-icon", "mono-text", "counter",
    "header-controls", "header-icon-btn", "settings-wrapper", "settings-trigger-btn",
    # 面板本体。必须显式列出：`.settings-dropdown-panel` 的**基础规则**
    # （position:absolute / top:calc(100% + 12px) / right:0 / width:440px /
    # 背景 / 圆角 / display:none + .show{display:block}）本身不含任何其它
    # 白名单子串；只列 info-card 之类会得到「有卡片样式、没有面板定位」的
    # 半截结果 —— 面板会以 static 流定位渲染到视口上方（实测 y:-158）。
    "settings-dropdown-panel",
    "manual-play-indicator",
    # 设置面板里的信息卡片。必须逐条列全名：`ic-` 这种子串会误伤
    # `metric-item`（"metr**ic-**item"），把口语模式的样式一起拖进来。
    "info-card", "info-cards-stack", "ic-left", "ic-label", "ic-value", "ic-icon",
    # 设置面板的「更多设置」二级面板。真正控制「显示中文」的是这里的
    # `#showChineseToggle`（`.more-settings-toggle-btn`），而不是底栏那个
    # `#chineseToggleBtn` —— 后者被 `display:none !important` 强制隐藏，
    # 只是给旧 JS 留的兼容占位。子串 "more-settings-" 即可覆盖全部 11 个类。
    "more-settings-",
    # 「更多设置」与「个性化」两个模态框。参考站把「更多设置」独立成一个
    # `#moreSettingsModal`（而不是塞进设置下拉面板里），所以这一整块
    # 也是听写模式的可见界面，必须一起搬。
    # 子串 "personalization-" 覆盖模态框与字号/预览等；下列几组是模态框内部
    # 用独立顶层类写的控件，不含该子串，必须逐条列：
    #   .font-options / .font-option-btn   字体选择（4 个「Aa」按钮）
    #   .font-size-value / -slider / -marks 字号滑杆与刻度
    #   .input-style-options / -btn / .style-icon 方框/横线切换
    #   .preview-input-wrapper / .preview-input 预览框
    "personalization-",
    "font-options", "font-option-btn",
    "font-size-value", "font-size-slider", "font-size-marks",
    "input-style-options", "input-style-btn", "style-icon",
    "preview-input-wrapper", "preview-input",
    # 设置面板里「显示风格/发音偏好/自动播放次数」三张卡片点开会弹出一个
    # 绝对定位的下拉（参考站用 .dropdowns-container 铺满面板并
    # pointer-events:none 让点击穿透，真正的 .card-dropdown 再单独
    # pointer-events:auto）。漏掉的表现是点卡片什么都不弹、或弹出后
    # 把整块面板的点击都吃掉了。
    "dropdowns-container", "card-dropdown", "card-opt-btn",
    # 「更多设置」里的「显示音标」开关。参考站在 body 上挂 `hide-phonetics`
    # 类，用 `body.hide-phonetics .word-phonetic { display:none }` 隐藏答案
    # 回顾屏的音标与占位。scope_one 会改写成
    # `.practice-shell.hide-phonetics …`，所以这个开关类要落在
    # `div.practice-shell` 自己身上，而不是 document.body。
    "hide-phonetics",
    # 顶部分段进度条
    "progress-bar-segmented", "progress-segment",
    # 听写主区
    "mission-prompt-wrapper", "mission-objective-label", "chinese-prompt",
    "input-slots-container", "word-input", "word-speak-btn", "proper-name",
    "input-style-underline", "answer-reveal-panel", "result-message", "prompt-border-left",
    # 答错达到阈值时从底部滑入的「已加入错题本」通知（toast.js:49
    # showMistakeNotification 动态创建 `div.mistake-notification`，2s 后移除）。
    # 四个类都是顶层裸选择器，不含任何其它白名单子串，必须逐条列。
    "mistake-notification", "mistake-icon", "mistake-content", "mistake-subtitle",
    # 答案提示浮层（`#sentenceHint`）的底部操作栏。参考站把它拆成三个独立
    # 顶层类，不含 "answer-reveal-panel" 子串，只靠上一条抓不到 ——
    # 漏掉的表现是提示浮层里「Switch to Text / ESC」那行挤成无样式文本。
    "answer-panel-footer", "footer-action", "footer-hint",
    # 答案回顾屏（听写答对后必定进入）。
    # 注意 `answer-sentence` 在参考 CSS 里**不存在**（grep 计数 0）—— 它是
    # 运行时由 generateAnnotatedSentence 替换掉的占位元素，样式靠
    # `.learning-container` 的后代规则生效，所以这里只列真正有规则的类。
    "answer-text-plain", "chinese-translation", "view-switch-container",
    "learning-container", "learning-chinese",
    "grammar-info", "grammar-points", "grammar-tag",
    # 结构化答案视图（「看答案」浮层 + 复习屏的语法结构视图）。
    # 参考站 `renderStructuredAnswer()`（practice.js:5525-5710）把句子按成分切成
    # `<span class="answer-component component-<type>" data-word-start data-word-end>`
    # 里再嵌 `component-label`（「主语」）/`component-text`（可点单词）/
    # `component-meaning`（成分释义）/`component-phonetics`（音标）；
    # 没有成分标签时降级成 `.answer-component-plain`。11 个 `component-<type>`
    # （subject/predicate/object/attributive/adverbial/complement/conjunction/
    # preposition/interjection/appositive/clause）各自带一组配色。
    # 外层容器：hint 浮层是 `.structured-answer`，复习屏是 `.structure-view-wrapper`
    # （选择器更具体，`practice-cyber.css:9362-9606`），两族都要。
    # `answer-terminal-punctuation` 是补回原句句末标点的小 span。
    # `.answer-highlight` 本身**没有**独立规则（grep 计数 0），只作为
    # `.answer-component.answer-highlight` 的复合选择器出现，靠 "component-" 即可覆盖。
    # 这三个子串与其它三种模式**零交叉**（实测 component- 170 条、
    # structure-view 68 条、structured-answer 25 条，puzzle/speaking/dependency/
    # confetti/sentence-hint 命中均为 0），所以可以安全地从 EXCLUDE 里移出。
    "structured-answer", "component-", "structure-view", "answer-terminal-punctuation",
    # 答案回顾屏里的「带注释句子」。参考站先用 `.answer-sentence` 渲纯文本占位，
    # 再在 requestIdleCallback 里换成 `generateAnnotatedSentence()` 的产物：
    # `.annotated-sentence > .sentence-line` 里每个词是一个 `.sentence-word`
    # （`.word-annotation` 中文卡 + `.word-phonetic` 音标 + `.word-text` 单词
    # + `.word-pos-label` 词性），纯标点段落走 `.sentence-plain`。
    # 这些类都是顶层裸选择器，不含上面任何子串，必须逐条列。
    "annotated-sentence", "sentence-line", "sentence-plain", "sentence-word",
    "word-unit", "word-annotation", "word-chip", "word-translation",
    "word-text", "word-pos-label", "word-phonetic", "plain-with-phonetic",
    "phonetic-placeholder", "contraction-suffix", "clickable-word",
    "clickable-phonetic", "has-phonetics",
    # 下一句预告条（听写/拼图模式专属）
    "next-sentence-preview", "nsp-",
    # 底栏
    "control-dock", "dock-btn", "dock-divider", "fragment-info", "fragment-badge",
    "fragment-step", "fragment-divider", "skip-fragment", "mobile-submit-btn",
    "bottom-toolbar",
    # 分段练习（fragment practice）本体。参考站 practice.js:2797-2812 里的
    # `loadFragmentPractice()` 会往 `#practiceContent` 注入
    # `.fragment-practice-container`（内含 `.mission-prompt-wrapper` 中文提示、
    # 可选的 `.fragment-word-image` 配图、`.input-container` 输入格区、
    # `.result-message` 结果提示）。此前只有靠 `fragment-info`/`word-input`
    # 等旁路子串漏进来的 6 条规则，**基类 `.fragment-practice-container` 本身
    # （display:flex; flex-direction:column; min-height:250px）一直是缺的**，
    # 会让分段界面塌成普通块级流、与参考站布局不一致。
    # `.full-sentence-image` 是听写整句配图（practice.js 的
    # `isSentenceImageDisplayEnabled()`，`sentence-image-spin` 关键帧也一并进来）。
    "fragment-practice-container", "fragment-word-image", "fragment-hint",
    "full-sentence-image", "sentence-image-spin",
    # 底栏上方的声音频谱条（`.footer-stack` 的第一个子节点）。
    # 它是**常驻元素**：基类 `height:30px; margin:0 auto 4px`，
    # `visibility:hidden; opacity:0` 但仍占布局，播放语音时加 `.active` 变可见。
    # `#audioCanvas` 是它内部的 canvas。漏掉会让 .footer-stack 矮 34px，
    # 整个底栏相对参考站上移。`.learning-container .audio-visualizer`
    # （答案回顾屏里的变体）也一并收进来。
    "audio-visualizer", "audiocanvas",
    # 底栏里给旧 JS 留的兼容占位（`#chineseToggleBtn` 等）。参考站用一条
    # `display:none !important` 把它们钉死，因为 JS 会往上写 `style.display='flex'`。
    # 我们渲染这些占位时用的是内联 `display:none`（React 不会像旧 JS 那样改写），
    # 但仍把参考站这条规则一并搬过来，保持 DOM+CSS 双向一致。
    # 注意：INCLUDE 的匹配是 `k in low`（low 已转小写），所以这里必须写全小写。
    "chinesetogglebtn", "immersivetogglebtn", "playshortcutdisplay",
    # 快捷键提示条
    "shortcut-overlay-bar", "shortcut-item", "kbd",
    # 快捷键设置弹窗（设置面板里「自定义快捷键」卡片点开的那个）。
    # 参考站把这整块 HTML 写在页面末尾（`句子练习 - 句游英语.html:599`），
    # 而不是由 JS 生成，所以它的样式必须整块搬过来。
    "shortcut-modal", "shortcut-close-btn", "shortcut-reset-btn",
    "shortcut-close-action-btn", "shortcut-list", "shortcut-row",
    "shortcut-label", "shortcut-key-display", "shortcut-edit-btn",
    "shortcut-recording-text",
    # 回答回顾屏里的内联口语评估入口条（听写模式也会出现）。
    # 参考站 `practice.js:4813-4829` 拼 `inlineSpeakingHTML`，条件
    # `!autoNextEnabled && practiceMode !== 'speaking' && typeof initInlineSpeaking === 'function'`
    # —— 我们的 auto_next 默认就是 off，所以**听写模式的回顾屏上这条是可见的**。
    # `.inline-speaking-hint` 只有样式、参考站从不生成该元素，但也一起搬，
    # 保持与参考 CSS 逐条一致（同 `.ic-value.status-off` 的处理口径）。
    # 不要写裸 `.vis-bar` —— 那会把 `.isp-vis-bar`（另一个 `.isp-*` 弹窗的
    # 频谱条，参考 `practice-cyber.css:7543`）一起捞进来。`.inline-visualizer`
    # 这个子串已经能覆盖 `.inline-visualizer .vis-bar`。
    "inline-speaking", "inline-mic-icon", "inline-visualizer",
    # 内联口语评测弹窗（点上面那条入口条后弹出）。参考 `practice-cyber.css:7435+`，
    # HTML 由 `speaking.js:1588-1610 openInlineSpeakingModal()` 生成，16 根 `.isp-vis-bar`。
    "isp-",
    # 完成结算屏
    "celebration",
    # 结算屏里的按钮内部结构与统计数字。**必须单独列**：参考站把它们写成
    # 顶层选择器（`.btn-icon { … }`、`.stat-number { … }`），不含 "celebration"
    # 子串，所以只靠上面那条 "celebration" 抓不到 —— 漏掉的表现正是
    # 「继续下一课」按钮里 ▶ 图标与课节名挤成一行、统计数字不放大。
    "btn-icon", "btn-text", "btn-title", "btn-subtitle",
    "stat-number", "stat-label",
    # 切换练习模式的确认弹窗。参考站不走原生 window.confirm，而是自己造一个
    # `#customModalOverlay`（`modal.js:12 showConfirmModal`），样式在
    # `practice-cyber.css:6166-6268`。注意 overlay 的基础规则是 `display:flex`
    # （没有 `display:none` + `.show` 那套），所以这个组件**必须条件渲染**，
    # 和设置面板/模式下拉的常驻策略正好相反。
    "custom-modal",
    # 单词卡（悬停/点击可点单词时弹出的浮层）与它的「更多」详情弹窗。
    # 参考站 `makeWordsClickable()`（practice.js:8994，:9032 调用）在 **document**
    # 上挂 click：命中 `.clickable-word` → `showWordDetailCard()` 把
    # `div#wordDetailCard.word-detail-card` 挂到 document.body（:8633-8640），
    # 内容由 `renderWordCard()`（:8549）拼；点卡片上的「更多」再开
    # `#wordDetailModalOverlay.word-detail-modal-overlay`（:8783-8790），
    # 内容由 `renderWordModal()`（:8833）拼。
    #
    # 样式在 `practice-cyber.css:5164-5560`（浮层 + 小卡片 + 弹窗）与
    # `:5782-5880`（light 主题变体）。四个子串足以覆盖全部 53 个类：
    #   .word-detail-card / .word-detail-modal / .word-detail-modal-overlay
    #   .word-card-*（含 form-hint/image/info/header/title-group/word/phonetic/
    #                 play-btn/translation/pos/more/actions/favorite-btn/
    #                 more-btn/loading/not-found）
    #   .word-modal-*（含 close/header/image/info/word/phonetic/translations/
    #                  trans-item/forms/section(-title)/sentence/phrase/
    #                  remember/books/book-tag/body/play-btn(-s)/play-icon）
    # 少数辅助类（`.no-image` / `.spinner` / `.favorited` / `.searched-word` /
    # `.base-word` / `.form-item` / `.form-label` / `.form-value` / `.pos` /
    # `.en` / `.cn` / `.us` / `.uk`）只以「带上面这些父类」的复合选择器出现
    # （如 `.word-card-image .no-image`、`.word-modal-sentence .en`），
    # prelude 里必然含上述子串，不需要单独列 —— 单列反而会误伤别处。
    #
    # 交叉实测：命中这四个子串的 prelude 共 106 条，与 EXCLUDE 的重叠为 **0**。
    "word-detail-card", "word-card-", "word-detail-modal", "word-modal-",
    # 口语跟读模式（`speaking.js initSpeakingMode()` :264 渲染的那一屏）。
    # 参考站里含 "speaking" 的选择器共 116 条，交叉实测**全部**落在三族：
    # `.speaking-*`、`.inline-speaking-*`、`.isp-*`，族外命中为 0
    # —— 所以把 `.speaking-` 从 EXCLUDE 里放出来并在此显式列出即可，无连带。
    # 这一条同时覆盖 `.speaking-mode-container .audio-visualizer` 那个变体。
    "speaking-",
    # 评分反馈卡（`.speaking-feedback-card` 内部）：环形总分、等级、三条指标条。
    # 这些类名在参考站是**顶层裸类**（写成 `.feedback-header { … }`，前面不带
    # 任何父选择器），prelude 里没有 speaking 子串可依，必须逐个列出。
    # 碰撞实测：全仓除本生成文件外，这些裸类在 0 处 CSS、0 处组件里出现。
    "feedback-", "score-text", "metric-item", "circular-chart",
    # 环形图的底环与进度环。注意 "circle" **不是** "circular" 的子串
    # （c-i-r-c-l-e vs c-i-r-c-u-l-a-r），两条都得列。
    "circle",
    # 指标条的填充条。`[data-theme="light"] .progress-bg` 这类 light 变体的
    # prelude 里没有父类可依，只能靠裸关键字捞。
    # 只写 `progress-bg`/`progress-fill`，不写裸 `progress` —— 后者会把
    # `.fragment-progress`、`.progress-bar-segmented`、`.progress-segment`
    # 一起捞进来，那是分段/统计面板的东西，不属于口语模式。
    "progress-bg", "progress-fill",
    # 拼图（拼拼乐）模式。参考站把它单独放在 `puzzle.js`（213 行，
    # `initPuzzleMode()` :18 渲染 `.puzzle-container`），样式在
    # `practice-cyber.css:6276-6510`（深色）与 `:7170-7237`（light 主题）。
    # 交叉实测：含 "puzzle" 的 prelude 共 31 条，**全部**只属于这一族
    # —— 族外命中为 0，所以放开 EXCLUDE 后单列这一个子串即可，无连带。
    "puzzle",
    # 答错时答案区的抖动反馈。参考站由 `checkAnswer()` 的拼图分支加/删
    # （`practice.js:6838-6840`：`answerArea.classList.add('shake-animation')`，
    # 500ms 后移除）。这条是**顶层裸类**（`.shake-animation { … }`，前面不带
    # 任何父选择器），prelude 里没有 "puzzle" 可依，必须单独列。
    #
    # 注意它引用的 `@keyframes shake` 我们**已经有了**（听写模式的
    # `.word-input.incorrect` 在用，见生成文件 `@keyframes shake`），
    # 生成器的「按正文实际引用重算 keyframes」会自动保留，不必额外处理。
    # 碰撞实测：除参考站这一处外，本仓 "shake-animation" 0 处 CSS、0 处组件。
    "shake-animation",
]
# 其它模式的专属样式，等做那个模式时再搬。
#
# `audio-visualizer` 原本在 EXCLUDE 里，但它其实是**底栏常驻元素**：参考站
# footer > .footer-stack 的第一个子节点就是
# `<div class="audio-visualizer active" id="audioVisualizer"><canvas id="audioCanvas">`，
# 基类 `height:30px; margin:0 auto 4px`（`visibility:hidden` 仍占布局），
# 带 `.active` 时可见。整块漏掉会让 .footer-stack 矮 34px。
#
# `speaking-mode` / `.speaking-` 曾经在这里，是为了挡住**尚未移植**的说话模式
# （并连带挡住 `.speaking-mode-container .audio-visualizer` 变体）。口语跟读模式
# 本轮开工，这两条已移出并改列进 INCLUDE —— 见上面 "speaking-" 那段。
#
# 注意：`structure-view` 与 `component-` **不在**这里。它们原本被当成
# 「别的模式的成分样式」挡掉，但实际正是听写模式的结构化答案视图需要的
# （见上面 INCLUDE 里 "structured-answer" 那段的说明，交叉实测为 0）。
#
# `puzzle` 曾经在这里（挡尚未移植的拼图模式）。拼图模式本轮开工，已移出
# 并改列进 INCLUDE —— 见上面 "puzzle" 那段；它引用的 `.shake-animation`
# 也一并列了进去。
EXCLUDE = ["dependency", "sentence-hint", "confetti"]

# EXCLUDE 的**定向豁免**：选择器同时命中 EXCLUDE 与这里任一子串时保留。
#
# 现在**故意为空**：唯一的使用场景是内联口语弹窗里的逐词评分条
# （`.isp-modal .isp-words .speaking-word*`，参考 `practice-cyber.css:7684-7754`），
# 它带 `.speaking-` 子串、本该被上面那条 veto 挡掉。既然 `.speaking-` 已从
# EXCLUDE 移出，豁免就没用了（那些选择器靠 prelude 里的 `isp-` 正常入选）。
# 机制保留，留待下一个需要「命中 veto 但确实想要」的选择器。
EXCLUDE_RESCUE = []


def strip_comments(s: str) -> str:
    return re.sub(r"/\*.*?\*/", "", s, flags=re.S)


def strip_at_statements(s: str) -> str:
    """删掉 @import / @charset 语句。

    必须删，否则它们会被并进紧随其后那一条规则的 prelude 里，
    导致 `:root { …变量… }` 的 prelude 变成 "@import …; :root"、
    既不以 :root 开头也不含任何关键字，于是整个变量块被静默丢弃 ——
    结果是全站 var(--font-body) 全部解析失败且不报错。
    字体改为走 next/font，不需要参考页的 Google Fonts @import。
    """
    s = re.sub(r"@charset\s+[^;]+;", "", s)
    s = re.sub(r"@import\s+(?:url\([^)]*\)|[^;]+);", "", s)
    return s


def split_commas(s: str):
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts]


def scope_one(p: str, prefix: str = PREFIX) -> str:
    """把单个复合选择器的 body/html/:root 换成作用域前缀（默认 .practice-shell）。

    第一条正则是通用形式：允许 `body` 前面带任意属性前缀，且前缀可以有多段
    （`[data-theme="light"][data-light-bg="white"] body`）。之前只处理
    「单个 data-theme 前缀 + body」，导致浅色纯白/浅灰的**根级背景规则**
    被作用域成 `.practice-shell[...] body` —— 那是个指向不存在的嵌套 body 的
    空操作，所以三种浅色主题都退化成同一个背景（实测 light-white 量到
    light-standard 的 #e2e8f0）。
    """
    m = re.match(r'^(?:html)?((?:\s*\[[^\]]*\])*)\s*body\b(.*)$', p, re.S)
    if m:
        return prefix + m.group(1) + m.group(2)
    m = re.match(r'^(?:html)?\[data-theme="light"\](.*)$', p, re.S)
    if m:
        return prefix + '[data-theme="light"]' + m.group(1)
    m = re.match(r"^:root(.*)$", p, re.S)
    if m:
        return prefix + m.group(1)
    m = re.match(r"^(?:html|body)(.*)$", p, re.S)
    if m:
        return prefix + m.group(1)
    if p.startswith(prefix):
        return p
    return prefix + " " + p


def scope_selector(sel: str, prefix: str = PREFIX) -> str:
    return ", ".join(scope_one(p, prefix) for p in split_commas(sel))


def guard_outside_shell(sel: str) -> str:
    """给第二份文件的**变量表**加一道「不在 .practice-shell 内」的护栏。

    第二份文件是给旧界面（没有 .practice-shell）用的，所以它必须自带变量表。
    但在听写页里，`.mode-switcher-scope` 是 `.practice-shell` 的**后代** ——
    而自定义属性的解析规则是「元素自身的声明优先于从祖先继承的值」，
    于是 `.mode-switcher-scope { --neon-cyan:#00f0ff }` 会盖掉
    `.practice-shell[data-theme="light"] { --neon-cyan:#0c4a6e }`。
    实测确认过：浅色主题下 shell 上量到 `#0c4a6e`，而 scope 上仍是 `#00f0ff`。

    顶栏那几件目前**看不出来**，因为 `practice.css` 有针对浅色主题的直连覆盖
    （`.practice-shell[data-theme="light"] .mode-dropdown-trigger` 等，特异性更高），
    但这是巧合而非设计 —— 任何没有直连覆盖的部件都会立刻露馅。所以按「不在壳内
    才生效」来写，让听写页照常继承壳的主题、旧界面照常自带深色默认值。

    `:where()` 特异性为 0，`:not()` 因此不抬高整条规则的特异性
    （仍是 `.mode-switcher-scope` 的 0,1,0），不会打乱层叠顺序。
    """
    return ", ".join(p.strip() + ":not(:where(.practice-shell) *)" for p in split_commas(sel))


def parse_rules(s: str):
    """切成顶层 (prelude, body) 列表，body 保持原样（可能是嵌套块）。"""
    rules, i, n = [], 0, len(s)
    while i < n:
        j = s.find("{", i)
        if j < 0:
            break
        prelude = s[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if s[k] == "{":
                depth += 1
            elif s[k] == "}":
                depth -= 1
            k += 1
        rules.append((prelude, s[j + 1:k - 1]))
        i = k
    return rules


def is_var_block(body: str) -> bool:
    """定义自定义属性的块（:root / [data-theme] 变量表）必须无条件保留。"""
    return re.search(r"--[\w-]+\s*:", body) is not None


def is_root_selector(sel: str) -> bool:
    """该选择器是否「根级」——即应当无条件保留。

    覆盖三种形态：`:root`、裸 `html`/`body`、以及**带属性前缀的
    `[data-theme="light"][data-light-bg="white"] body`**。最后一种是浅色
    主题的背景/氛围规则，之前漏判 → 三种浅色主题共用同一背景色。
    """
    s = sel.strip().lower()
    if s.startswith((":root", "html", "body")):
        return True
    return bool(re.match(r'^(?:html)?\s*\[[^\]]*\](?:\s*\[[^\]]*\])*\s*(?:body|html)\b', s))


def keep_selectors(prelude: str, body: str, include=None):
    """返回这条规则里应当保留的选择器列表；空列表表示整条丢掉。

    EXCLUDE 必须按**单个选择器**判定，不能按整条规则判：参考站把
    `body.hide-phonetics .word-phonetic,
     body.hide-phonetics .component-phonetics,
     body.hide-phonetics .phonetic-placeholder`
    写在同一条规则里，按整条判的话 `.component-phonetics` 会把我们真正需要的
    「显示音标」开关样式一起连坐掉。

    `include` 缺省用听写模式的 INCLUDE；出第二份（模式切换器）时传
    MODE_SWITCHER_INCLUDE，逐关键字过同一套 EXCLUDE 口径。
    """
    keys = INCLUDE if include is None else include
    sels = split_commas(prelude)
    low = prelude.lower()
    rescued = any(x in low for x in EXCLUDE_RESCUE)

    if not rescued and not any(x in low for x in EXCLUDE):
        # 快路径：整条规则都没命中 EXCLUDE，沿用原来的判定口径
        if is_var_block(body):
            return sels
        if any(is_root_selector(s) for s in sels):
            return sels
        return sels if any(k in low for k in keys) else []

    # 慢路径：规则里混进了其它模式的样式，逐条选择器过筛
    keep = []
    for sel in sels:
        slow = sel.lower()
        if not rescued and any(x in slow for x in EXCLUDE):
            continue
        if is_var_block(body) or is_root_selector(sel):
            keep.append(sel)
        elif any(k in slow for k in keys):
            keep.append(sel)
    return keep


def included(prelude: str, body: str, include=None) -> bool:
    return bool(keep_selectors(prelude, body, include))


def process(s: str, collected_vars: list, prefix: str = PREFIX, include=None,
            emit_vars: bool = True, drop_root: bool = False):
    """抽取并作用域化。

    `emit_vars=False` 用于第二份文件：那边变量表由 main() 单独按「该文件实际
    引用到的变量」过滤后输出（并加「不在壳内」护栏），所以这里必须跳过变量块，
    否则会重复输出、且把整站主题变量整份复制进来。

    `drop_root=True` 同样只用于第二份文件：`body`/`html`/`[data-theme] body`
    这类**根级规则**（整页背景、底色、氛围渐变）与切换器无关。它们会被
    `scope_one` 作用域成「裸的 `.mode-switcher-scope`」，而 portal 出来的弹窗
    外壳恰好就是这个类 —— 一条 `background-color:#cbd5e1` 会直接糊在遮罩外面。
    切换器的样式全都写在 `.mode-switcher-scope <后代>` 上，根级规则一律不要。
    """
    out, kept, skipped = [], 0, []
    for prelude, body in parse_rules(s):
        pl = prelude.strip()
        if is_var_block(body):
            for name in re.findall(r"(--[\w-]+)\s*:", body):
                collected_vars.append(name)
        if pl.startswith(("@media", "@supports", "@layer")):
            inner, k, sk = process(body, collected_vars, prefix, include, emit_vars, drop_root)
            if k:
                out.append(pl + " {\n" + inner + "}\n")
                kept += k
            skipped += sk
            continue
        if "keyframes" in pl or pl.startswith(("@font-face", "@charset", "@import")):
            continue
        if is_var_block(body) and not emit_vars:
            # 交给 main() 的过滤通道处理，这里不重复输出
            continue
        kept_sels = keep_selectors(pl, body, include)
        if drop_root:
            kept_sels = [s for s in kept_sels if not is_root_selector(s)]
        if kept_sels:
            out.append(scope_selector(", ".join(kept_sels), prefix) + " {" + body + "}")
            kept += 1
        else:
            skipped.append(pl)
    return "\n".join(out), kept, skipped


def main():
    if not os.path.exists(SRC):
        sys.exit(f"源文件不存在：{SRC}")
    raw = strip_at_statements(strip_comments(open(SRC, encoding="utf-8").read()))
    defined: list = []
    body, kept, skipped = process(raw, defined)

    kf = {}
    for prelude, b in parse_rules(raw):
        m = re.match(r"^@(?:-webkit-)?keyframes\s+([\w-]+)", prelude.strip())
        if m:
            kf[m.group(1)] = prelude.strip() + " {" + b + "}"
    used = [n for n in kf if re.search(r"\b" + re.escape(n) + r"\b", body)]
    kf_css = "\n".join(kf[n] for n in used)

    # 输入个性化变量由 JS 在运行时写到 .practice-shell 上（见练习页的
    # setPersonalization / 参考站 practice-sys-controls.js:56-58），CSS 里都带
    # var(--x, 兜底值)，不属于「引用了未定义变量」。
    RUNTIME_VARS = {
        "--dictation-input-font-family",
        "--dictation-input-font-size",
        "--dictation-review-font-scale",
    }
    used_vars = set(re.findall(r"var\((--[\w-]+)", body + kf_css))
    undefined = sorted(used_vars - set(defined) - RUNTIME_VARS)

    header = (
        "/* 自动生成 —— 请勿手改。\n"
        " * 来源：句游英语参考站 practice-cyber.css（听写模式所需子集）。\n"
        " * 生成器：scripts/extract-practice-css.py（选择器已收敛到 .practice-shell 下）。\n"
        " * 重新生成：python3 scripts/extract-practice-css.py\n"
        " */\n\n"
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(header + body + "\n\n/* ── keyframes ── */\n" + kf_css + "\n")

    # ── 第二份：模式切换器（供没有 .practice-shell 的非听写模式使用）────────────
    # 只重跑一遍抽取，前缀换成 .mode-switcher-scope。变量表也要带上：
    # `.mdt-*` 用 var(--font-header)、`.custom-modal-button-confirm` 用
    # var(--neon-cyan)，而 LearnClient 的祖先链上没有 .practice-shell，
    # 变量得由这层自己定义。keyframes 同样按正文实际引用重算
    # （`custom-modal` 的 animation 引用了 fadeIn / zoomIn，其中 zoomIn
    # 在参考 CSS 里从未定义 —— 与听写侧同一处理口径，不补写）。
    defined2: list = []
    body2, kept2, skipped2 = process(raw, defined2, PREFIX2, MODE_SWITCHER_INCLUDE,
                                    emit_vars=False, drop_root=True)
    # 变量表整块搬过来（:root / [data-theme] 的 --x 定义都在里面）。
    var_blocks = []
    for prelude, b in parse_rules(raw):
        if is_var_block(b):
            sels = keep_selectors(prelude, b, MODE_SWITCHER_INCLUDE)
            if sels:
                var_blocks.append((prelude, b, sels))
    vars_css = ""
    seen_vars = set()
    for prelude, b, sels in var_blocks:
        # 只把这份文件真正用到的变量留下，避免整站主题变量被复制第二遍。
        wanted = [n for n in re.findall(r"(--[\w-]+)\s*:", b)
                  if re.search(r"var\(" + re.escape(n) + r"\)", body2)]
        if not wanted:
            continue
        sub = re.sub(r"(--[\w-]+)\s*:[^;]*;",
                     lambda mm: mm.group(0) if mm.group(1) in wanted else "",
                     b)
        if not sub.strip():
            continue
        sel_txt = ", ".join(sels)
        if sel_txt in seen_vars:
            continue
        seen_vars.add(sel_txt)
        vars_css += guard_outside_shell(scope_selector(sel_txt, PREFIX2)) + " {" + sub + "}\n"
    used2 = [n for n in kf if re.search(r"\b" + re.escape(n) + r"\b", body2)]
    kf_css2 = "\n".join(kf[n] for n in used2)
    header2 = (
        "/* 自动生成 —— 请勿手改。\n"
        " * 来源：句游英语参考站 practice-cyber.css（**模式切换器**子集）。\n"
        " * 生成器：scripts/extract-practice-css.py（作用域前缀 " + PREFIX2 + "）。\n"
        " * 重新生成：python3 scripts/extract-practice-css.py\n"
        " *\n"
        " * 为什么单独一份：模式切换器是听写页与非听写页共用的组件，但拼图/学习/口语\n"
        " * 目前仍走旧的 LearnClient（没有 .practice-shell），.practice-shell 前缀\n"
        " * 的规则在那里一条都不会命中。规则仍从参考站抽取，与 practice.css 同源。\n"
        " */\n\n"
    )
    with open(OUT2, "w", encoding="utf-8") as f:
        f.write(header2 + vars_css + "\n" + body2 + "\n\n/* ── keyframes ── */\n" + kf_css2 + "\n")
    text2 = open(OUT2, encoding="utf-8").read()
    bad2 = re.findall(r"(?m)^\s*(?:body|html|:root)[\s,{:]", text2)
    print(f"[{PREFIX2}] kept rules: {kept2}   skipped: {len(skipped2)}")
    print(f"[{PREFIX2}] keyframes used: {len(used2)}/{len(kf)}")
    print(f"[{PREFIX2}] UNSCOPED global selectors: {len(bad2)}")
    print(f"[{PREFIX2}] lines: {text2.count(chr(10))}   bytes: {os.path.getsize(OUT2)}")

    text = open(OUT, encoding="utf-8").read()
    bad = re.findall(r"(?m)^\s*(?:body|html|:root)[\s,{:]", text)
    print(f"kept rules: {kept}   skipped: {len(skipped)}")
    print(f"keyframes used: {len(used)}/{len(kf)}")
    print(f"vars defined: {len(set(defined))}   used: {len(used_vars)}")
    print(f"UNSCOPED global selectors: {len(bad)}")
    print(f"UNDEFINED vars referenced: {len(undefined)}")
    if undefined:
        print("  " + ", ".join(undefined[:20]))
    print(f"lines: {text.count(chr(10))}   bytes: {os.path.getsize(OUT)}")
    if bad or undefined or bad2:
        sys.exit(1)


main()
