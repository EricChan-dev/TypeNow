# 打字练习页 · 句乐部对齐矩阵

> 版本：V1.1 ｜ 首版 2026-06-09 ｜ 最近更新 2026-09-24
> 目标：把「练习页尽量保持句乐部体验、甚至一比一复刻」拆成可判定的能力项，界定做什么、不做什么、按什么顺序做。
> 对标：句乐部 `julebu.co` ｜ 主要依据：`docs/archive/julebu-research.md`（含 147 个 JS chunk 逆向结果）+ 本地代码审计 + 线上库实测
>
> **当前进度**：阶段 0（闭环快修）与阶段 1（高杠杆对齐）**已完成并验证**；六项待拍板决策**已全部拍板**（见 §五）。
> 下一步是阶段 2（核心手感：把 `ReviewClient` 的逐字符引擎抽成 `src/lib/typing-engine.ts`）。
>
> 本文档同时是**决策台账**——开始讨论练习页改动前先看 §五，不要重复讨论已定的事项。

---

## 〇、三句话结论

1. **能对齐的是「交互骨架」，不能对齐的是「手感」**——句乐部练习界面是 Canvas/WebGL 渲染，DOM 里没有句子数据（`docs/archive/julebu-research.md` 记录当初必须拦截网络层才拿到内容）。截图给得了静态视觉，给不了动画时序、按键判定延迟、连击公式松紧、音效波形。这一层只能等效重做 + 自己调参。
2. **有两个「数据/代码已经躺在那、但一次没用过」的高杠杆项**：依存语法树覆盖率 **57.1%**（`Ctrl+2` 句子树的数据底座，`nodes` 非空的真实可用率；按 `IS NOT NULL` 算的 95.0% 是虚高，详见 §一 更正），以及 `ReviewClient` 里**已经实现好的逐字符实时判定引擎**（练习页还在用「空格结算」）。这两项是性价比最高的对齐动作。
3. **真正的瓶颈不是 UI，是「练习会话（session）」缺失**。句乐部有 `practice.createSession` / `getExistingSessionDetail` / `completeSession` / `abandonSession` 一整套；你库里没有会话模型，所以「退出再进从第 1 句开始」不是 bug，是没有地基。

---

## 一、数据底座实测（决定哪些能力「能有」）

**口径**：线上库只读 SQL，`sentences JOIN lessons JOIN courses WHERE courses.is_published = 1`（用户实际可达的句子）。查询时间 2026-06-09。

| 句子级字段 | 可达句覆盖 | 覆盖率 | 说明 |
|---|---:|---:|---|
| 可达句总数 | 461,801 | 100% | `content-audit.json`（2026-09-22）记录为 444,135，内容仍在增长 |
| `english` / `chinese` | — | — | 另有 153 句英文为空、1,387 句英中相同（已由 `usableSentenceSql` 在 API 层过滤） |
| `words`（逐词） | 335,159 | **72.6%** | |
| `words[].phonetic` | 335,159 | **100%**（占有 words 的） | 其中 271,124 为 `{uk,us}` 双音标对象，约 6.4 万仍是旧字符串形态 |
| `words[].definition`（中文释义） | **0** | **0%** | ⚠️ 类型里定义了（`types/index.ts:17`），数据从未落地 |
| `chunks`（语块） | 22,878 | **5.0%** | ⚠️ 语块/渐进难度没有数据底座 |
| `dependency_analysis`（依存树） | 438,902 | **95.0%** ⚠️ 见下方更正 | ✅ **前端零使用**（阶段 1 已接上） |
| `sentence_structure`（句子成分） | 80,011 | **17.3%** | 稀疏，做 UI 必须设计降级态 |
| `wordGroups`（语块组合） | — | 不存在 | schema 无此列，需新增 |

> **更正（阶段 1 收尾时发现）**：上表 `dependency_analysis` 95.0% 是**虚高口径**。
> 它用的是 `IS NOT NULL`，而实测有 **175,029 条可达句存的是 `{"edges": [], "nodes": []}`**
> ——分析跑过但没产出，是空壳而非 NULL。改用 `JSON_LENGTH($.nodes) > 0` 后：
>
> | 口径 | 可达句 | 占比 |
> |---|---:|---:|
> | 有记录（`IS NOT NULL`，虚高） | 438,902 | 95.0% |
> | **真正能画出树**（`nodes` 非空） | **263,873** | **57.1%** |
> | 画不出树（无记录或空壳） | 197,928 | 42.9% |
>
> 结论修正：C4 语法树**不是**「数据已就位、纯前端工作」。`Ctrl+2` 在近 43% 可达句上
> 只能显示空状态。已并入审计脚本 `[H]` 段落，后续不再依赖临时 SQL。
> `sentence_structure` 同口径复测后仍为 17.3%（79,948 / 80,011），不受影响。

**由此得出的硬约束：**

- 句子树 / 语法可视化 → **数据只够一半**（57.1% 可画树），前端工作之外还需评估空壳回填
- 内联释义（点词看中文）→ **零数据**，要先补数（AI 批量生成或重抓）
- 语块模式、i+1 渐进难度 → **5% 数据**，要做就得先补 30 万句的语块
- 句子成分标注 → 数据稀疏，只能做「有则显示」

---

## 二、能力对齐矩阵

图例：✅ 已具备 ｜ ⚠️ 部分具备 ｜ ❌ 缺失
优先级：**P0** 闭环破损/用户必然撞到 ｜ **P1** 差距最大且数据代码已就位（高杠杆）｜ **P2** 打磨 ｜ **P3** 后置

### A. 输入与判定引擎（手感核心）

| # | 能力点 | 句乐部 | TypeNow 现状 | 代码位置 | 差距 | 优先级 | 工时粗估 |
|---|---|---|---|---|---|---|---|
| A1 | 逐字符实时判定 | ✅ 边打边判 | ⚠️ **只有复习页有** | `ReviewClient.tsx:157-249` | 练习页是「空格结算」，两套引擎 | **P1** | 2-3d |
| A2 | 打满一个词自动前进 | ✅ | ⚠️ 仅复习页 | `ReviewClient.tsx:195-221` | 练习页必须按空格 | **P1** | 含 A1 |
| A3 | 空格键语义 | ✅ 确认/口语识别 | ⚠️ **两页冲突** | `LearnClient.tsx:839` vs `ReviewClient.tsx:188` | 练习页空格=确认；复习页空格被当字符输入，`normalizeForTyping` trim 掉后仍会让「hel␣l」判错 | **P0** | 0.5d |
| A4 | 输入长度上限 | ❌ 不限制 | ❌ 静默吞键 | `LearnClient.tsx:816` | `value.length >= expected.length` 直接 return，敲到上限后按键无反应且不提示 | **P0** | 0.5d |
| A5 | 错因可视化 | ✅ 标出错误位置 | ❌ 整词变红 | `LearnClient.tsx:583-595` | 不指出哪个字母错，答案默认不显示，用户只能退格猜 | **P0** | 1d |
| A6 | 错误后清空/可续打 | ✅ | ❌ 保留错误输入 | 同上 | 错值不清空且长度可能已达上限，用户卡在「按什么都没反应」 | **P0** | 含 A5 |
| A7 | 键盘事件守卫 | ✅ | ❌ 无任何守卫 | `LearnClient.tsx:714-855` | 不检查 `pauseRef`、不检查 `e.target`、不检查弹窗；暂停/设置弹窗开着时敲字照样进题 | **P0** | 0.5d |
| A8 | 移动端输入 | PC 优先，不承诺移动 | ⚠️ 靠隐藏 input 唤软键盘 | `LearnClient.tsx:190-209` | 中文输入法/多数 Android 键盘发 `Unidentified`/`keyCode 229`，字符到不了 handler；而 `PricingFAQ.tsx:36` 承诺「手机浏览器也能用」 | **P0** | 1-2d |
| A9 | 整句连打（不逐词停） | ✅ | ❌ | — | 空格被占用，无法一口气打完 | **P1** | 含 A1 |

> **A1/A2 的可行性已经验证**：`ReviewClient.tsx:157-249` 是一份可用的逐字符引擎（`isTypingPrefix` 实时判前缀、打满自动前进、错则标红抖动）。练习页对齐不需要从零设计，是**移植 + 补空格/连打语义**。

### B. 反馈层（爽感）

| # | 能力点 | 句乐部 | TypeNow 现状 | 代码位置 | 差距 | 优先级 |
|---|---|---|---|---|---|---|
| B1 | 连击（Combo） | ✅ 核心留存机制 | ⚠️ 仅 ≥2 连触发 | `LearnClient.tsx:474-484` | 无连击数常驻展示、无连击中断提示 | **P1** |
| B2 | Perfect 评分 | ✅ | ✅ `SentenceFeedback` | `SentenceFeedback.tsx` | 已有，可保留 | — |
| B3 | 击键音效 | ✅ | ⚠️ **不可关闭** | `LearnClient.tsx:82-140` | 每次按键 2400Hz sine，`SettingsModal` 只有 TTS 音量，无音效开关 | **P1** |
| B4 | 完成动画（撒花） | ✅ | ✅ animejs 烟花 | `LearnClient.tsx:904-987` | 已有 | — |
| B5 | 连击/分数进 session 统计 | ✅ | ❌ 客户端算 | `LearnClient.tsx:501-505` | 弹窗 score 与服务端 `scoreForMistakes` 两套口径，用户看到的和档案里的不是一个数 | **P1** |

### C. 辅助学习内容（差异化）

| # | 能力点 | 句乐部 | TypeNow 现状 | 数据 | 优先级 |
|---|---|---|---|---|---|
| C1 | 英美双音标 | ✅ | ✅ 兼容 `{uk,us}` | 271,124 句 | — |
| C2 | 词性 13 色体系 | ✅ | ✅ 已抄映射 | — | — |
| C3 | 内联中文释义 | ✅ `definition` | ❌ 类型有、数据 0 | **0%** | **P2**（先补数） |
| C4 | **依存句子树（Ctrl+2）** | ✅ canvas 可视化 | ✅ 阶段 1 已接上 | **57.1%**（真实可用） | ✅ 已完成 |
| C5 | 句子成分标注 | ✅ 主谓宾+解释 | ❌ 零使用 | 17.3% | **P2** |
| C6 | 语块组合 `wordGroups` | ✅ | ❌ 无此字段 | 不存在 | **P3** |
| C7 | 点词查详情+发音 | ✅ | ⚠️ 仅**完成后** hover 可达 | `CompletedSentence.tsx:136` | **P1** |
| C8 | 加入生词本（Ctrl+N） | ✅ | ❌ **快捷键 disabled** | `LearnClient.tsx:1489` | **P1** |
| C9 | 标记掌握（Ctrl+M） | ✅ | ❌ **快捷键 disabled** | `LearnClient.tsx:1488` | **P1** |
| C10 | 句子笔记 | ✅ `statementNotes` | ⚠️ 表存在、练习页无入口 | `user_notes` | **P2** |
| C11 | 学习内容面板（Ctrl+1） | ✅ | ⚠️ 只有 `OutlineModal`（句子大纲） | — | **P2** |
| C12 | AI 助手（Ctrl+/） | ✅ "随时有一个英语老师在旁边" | ❌ **练习页显式隐藏** | `AiChatWidget.tsx:74` | **P1** ⭐ |

> **C4 与 C12 是本次审计最刺眼的两处**：句子树数据 95% 就绪却一次没渲染；AI 老师在最需要它的页面被 `pathname.startsWith("/home/learn/")` 主动关掉。而 `SentenceKnowledge.tsx`（AI 语法讲解组件）**全库 0 引用**，是死代码。

### D. 练习模式与难度体系

| # | 能力点 | 句乐部 | TypeNow 现状 | 优先级 |
|---|---|---|---|---|
| D1 | 中译英打字 | ✅ | ✅ | — |
| D2 | 听写 | ✅ | ❌ | **P3** |
| D3 | 听力 | ✅ | ❌ | **P3** |
| D4 | 口语评测 | ✅ | ❌（有 `youdao/evaluate` 接口但无 UI） | **P3** |
| D5 | 用户难度层（初/中/高级/自定义） | ✅ `presetKey` | ❌ 只有句子级 `difficulty` 标签 | **P2** |
| D6 | i+1 渐进编排 | ✅ 见下表 | ❌ 模式由**数据**决定，不由用户等级决定 | **P3** |

句乐部难度 → 模式矩阵（来自 `docs/archive/julebu-research.md`）：

```
presetKey   | sentence | chunk | combinedChunks | phraseAndWord
beginner    | ✓        | ✓     | ✓              | ✓
intermediate| ✓        | ✓     | ✓              | ✗
advanced    | ✓        | ✗     | ✗              | ✗
custom      | ✓        | ✓     | ✓              | ✓
```

> 初级会把一句话拆成**短语/单词**层级来练，高级才整句上。这是句乐部「像玩游戏」的骨架之一。你的 `chunks` 覆盖率只有 **5.0%**，所以 D5/D6 当前**没有数据底座**，不能排在前两阶段。

### E. 会话与进度（地基）

| # | 能力点 | 句乐部 | TypeNow 现状 | 代码位置 | 优先级 |
|---|---|---|---|---|---|
| E1 | 创建练习会话 | ✅ `practice.createSession` | ❌ | — | **P1** |
| E2 | 恢复进行中的会话 | ✅ `getExistingSessionDetail` | ❌ **无此能力** | — | **P1** ⭐ |
| E3 | 完成/放弃会话 | ✅ `completeSession` / `abandonSession` | ❌ | — | **P1** |
| E4 | 退出后回到原句 | ✅ | ❌ **永远从第 1 句开始** | `api/user/progress/route.ts:48-56` | **P1** |
| E5 | 记录写入 | ✅ | ⚠️ 6 个独立 `useEffect` 各打一个接口 | `LearnClient.tsx:421-492` | **P1** |
| E6 | 学习路线进度 | ✅ `getCoursePackLearningPathProgress` | ⚠️ `user_course_progress` 只有句子计数 | — | **P2** |
| E7 | 高光时刻 | ✅ `getHighlightMoments` | ⚠️ 档案页有类似展示 | `archive` | **P2** |

> `user_course_progress.sentence_count` 用 `GREATEST` 单调递增（`route.ts:56`），所以它记的是「最多完成过几句」，**不是「上次练到第几句」**——这两个语义完全不同，也是 E4 无法实现的直接原因。

### F. 会话内的干扰与中断处理

| # | 能力点 | 句乐部 | TypeNow 现状 | 代码位置 | 优先级 |
|---|---|---|---|---|---|
| F1 | 暂停时冻结输入 | ✅ | ❌ 仅冻结计时器 | `LearnClient.tsx:714-855` | **P0** |
| F2 | 弹窗打开时冻结输入 | ✅ | ❌ | 同上 | **P0** |
| F3 | 练习中不被会员弹窗打断 | ✅ | ❌ `ExpiryWarningModal` 无路由隔离 | `home/layout.tsx:54` | **P0** |
| F4 | 首屏不强制等待 | ✅「先玩一把」直进 | ❌ **强制 2 秒假进度条** | `LearnClient.tsx:390-403` | **P1** |
| F5 | 自动播音可靠 | ✅ | ⚠️ 首句受 autoplay 策略拦截，错误被 `.catch` 吞掉 | `useTTSSettings.ts:138-145` | **P1** |
| F6 | 完成后有下一步 | ✅ | ❌ 只有「再来一次 / 返回课程」 | `LearnClient.tsx:1455-1461` | **P1** |

### G. 平台与商业化（战略层，非练习页范畴但影响对齐）

| # | 维度 | 句乐部 | TypeNow |
|---|---|---|---|
| G1 | 平台定位 | 明确 **PC 优先**，FAQ 直说「为什么没有 App」 | 响应式，并在定价页承诺手机可用（实际不可靠，见 A8） |
| G2 | 免费体验 | 零基础包 30+ 节免费 + 免费体验会员 | 3 天试用，`learn` 页硬 `redirect("/pricing")` |
| G3 | 用户自建内容 | ✅ 编辑端（任何英文内容变课程） | ❌ 仅 `admin/` 后台，用户端无 |
| G4 | 价格 | 39 元/月 | 29 元/月 · 199 元/年 |
| G5 | 视觉定位 | 游戏化 | `specs/practice-page.md` 1.2 写的差异化是「**比句乐部更克制的视觉**」「不像游戏，像练习册」 |

> ⚠️ G5 与「一比一复刻」直接冲突。这是需要拍板的产品决策，见第五节。

---

## 三、不能「一比一」的三条边界

| 边界 | 原因 | 应对 |
|---|---|---|
| **手感无法抄** | 练习界面是 Canvas/WebGL，DOM 无句子数据，动画时序/判定延迟/音效资源都不在可提取范围内 | 用 `ReviewClient` 的判定引擎做基线，等效重做交互，**参数靠自测调**（建议用 `pnpm test` 补一组判定单测锁行为） |
| **数据有硬上限** | 句乐部试用过期后游戏入口与 `courses.findOne` 均 401（research 文档记录）；`definition` 现为 0%，`chunks` 仅 5% | 释义改用 AI 批量生成；语块用 `/api/admin/sentences/[id]/split` 已有的 AI 拆句能力补 |
| **视觉与内容有法律风险** | 玩法/快捷键属「思想」，模仿无碍；但视觉做到像素级一致可能触及美术作品侵权/不正当竞争，**付费墙内课程内容用于自己收费产品是已存在的高风险**（库里 46 万句） | 玩法照做，**视觉建立自己的设计语言**，内容逐步转向自建（AI 拆句翻译链路已成熟） |

---

## 四、建议实施顺序（按依赖关系排，不按诱惑力排）

### 阶段 0 · 闭环快修（1-2 天，风险最低）
> 目标：把「用户必然撞到的破损」先堵上，不动架构。

- F1/F2 键盘事件加三重守卫：`pauseRef` / 弹窗开关 / `e.target` 是否可编辑
- A3 统一空格语义（练习页与复习页必须一致）
- A4 去掉静默吞键，改为「超出长度则整词标错」并给提示
- A5/A6 错误态：标出错误字符位置 + 清空重打 + 可显示正确拼写
- F3 `ExpiryWarningModal` / `ExpiryBanner` 加 learn 路由隔离
- B3 音效开关（全局设置项，默认开）
- F6 完成弹窗补「继续下一课」+「再练错句」

### 阶段 1 · 高杠杆对齐（3-5 天）
> 目标：把「数据/代码已就位」的能力一次性点亮，单位投入回报最高。

- **C4 依存句子树**（`Ctrl+2`）：数据真实可用率 57.1%（95.0% 为虚高口径），已完成 `DependencyTree` 组件挂进练习页
- **C12 AI 助手接回练习页**（`Ctrl+/`）：把 `SentenceKnowledge.tsx`（原 0 引用）接入，实现「针对当前句子的讲解」。**偏差**：没有解除 `AiChatWidget` 的 learn 路由隐藏，改为「沉浸路由一律隐藏 + 弹窗按钮唤起」——浮窗按钮会压住练习操作区
- C7/C8/C9：点词详情 + 加入生词本 + 标记掌握，三个快捷键从 `disabled` 转正
- E1-E5 练习会话最小可用版：建表 `practice_sessions(courseId, lessonId, index, state)`，进入时恢复、退出时落盘 —— 一次解决 E2/E3/E4/E5
- F4 去掉强制 2 秒等待；F5 首句播音补用户手势触发

#### 阶段 1 交付记录（已完成）

| 项 | 落地物 | 与计划的偏差 |
|---|---|---|
| C4 依存句子树 | `src/lib/dependency-tree.ts`（排版纯函数 + 17 单测）、`src/components/home/learn/DependencyTree.tsx`（`DependencyTree` + `SentenceTreeModal`）、`Ctrl+2` 接入 LearnClient | 无 |
| C12 AI 助手 | `src/components/home/learn/SentenceExplainModal.tsx` 包裹 `SentenceKnowledge`（首次有调用方），`Ctrl+/` 打开；`src/lib/ai-chat.ts`（3 单测）让 modal 能唤起 `AiChatWidget` 面板 | **偏差**：没有解除浮窗在练习页的隐藏，而是改为「两个沉浸路由一律隐藏 + 弹窗里按钮唤起」。浮窗按钮会压住复习页操作区 |
| C7 点词详情 | 完成/出错的词外面套 `WordDetailPopover` | 刻意只挂已答完的词：未答的词挂上等于悬停即看答案 |
| C8 加入生词本 | `Ctrl+N` + 抽屉条目转正 | 无 |
| C9 标记掌握 | `Ctrl+M`（标记 + 跳下一句）；完成页「已掌握 ✓」按钮复用同一实现但**不**跳转 | 无 |
| E1-E5 会话持久化 | `supabase/migrations/00011_practice_sessions.sql`、`src/lib/practice-session.ts`（21 单测）、`GET/POST /api/practice/sessions`、LearnClient 进入恢复 + 完成上报 | 无（迁移已在 typenow 库应用） |
| F4 强制等待 | 仅修正注释 | **偏差**：实测该等待早已不阻塞（加载画面由 `if (!sentence)` 把关，2 秒只驱动装饰进度条），本阶段无行为改动 |
| F5 首句播音 | `needsAudioGesture` + 「点击开启发音」按钮 | 无 |
| 额外（C11 邻接） | `OutlineModal` 不再对每句渲染英文，未练句显示中文题干 + 「未练」标记 | 计划外补漏：原实现让 `Ctrl+1` 变成整课答案册 |

### 阶段 2 · 核心手感（5-8 天）
> 目标：对齐「打字」本身。**这是全程最关键、也最需要反复调参的一段。**

- A1/A2/A9：把 `ReviewClient` 的逐字符引擎抽成共享模块（`src/lib/typing-engine.ts`），练习页接入，补齐整句连打
- ~~A8 移动端~~ —— **已关闭**（决策 3 选 PC 优先）：不重写输入层，改为 `src/lib/desktop-only.ts` 判定触屏设备 + `Layer 2.4` 提示条引导换电脑，并修正了定价页 `PricingFAQ` 里「手机浏览器也能打开用」的过度承诺。软键盘捕获框保留为尽力而为，不再作为承诺
- B1/B5：连击常驻展示 + 统计口径统一到服务端
- C3 补 `definition` 数据（AI 批量生成，走已有 `analyzeSentence` 链路）
- **新增（阶段 1 收尾时发现）**：`dependency_analysis` 有 197,928 条可达句画不出树（其中 175,029 条是 `{"edges":[],"nodes":[]}` 空壳），`Ctrl+2` 在这些句子上只会显示空状态。需评估回填，或在无树时给更有信息量的兜底文案

### 阶段 3 · 体系化（按数据补齐进度决定）
- D5/D6 难度 preset + i+1 编排 —— **前置条件：`chunks` 覆盖率从 5% 提上来**
- E6/E7 学习路线进度 + 高光时刻打通
- C5 句子成分标注（数据 17%，需先补）

### 阶段 4 · 后置项
- D2/D3/D4 听写/听力/口语、C6 `wordGroups`、G3 用户自建内容编辑端

---

## 五、已拍板的决策

> 全部已决策，2026 年本轮确认。

| # | 决策 | 结论 | 落地状态 |
|---|---|---|---|
| 1 | **视觉路线** | **A** — 照 `specs/practice-page.md` 原定位：「比句乐部更克制的视觉、像练习册」 | 持续生效，作为阶段 2 调参的目标观感 |
| 2 | **内容来源** | **A** — 逐步转向自建（AI 拆句 + 翻译，`analyzeSentence` 链路已成熟） | 待排期，不阻塞阶段 2；需在阶段 3 前建立替换机制 |
| 3 | **移动端方向** | **PC 优先（G1）** — 不做 `beforeinput` 输入层重写 | 已落地：触屏设备显示「建议在电脑上打开」提示（可关闭、已持久化），并修正定价页 `PricingFAQ` 的过度承诺。软键盘捕获框保留为**尽力而为**，不再当作承诺 |
| 4 | **生产库迁移** | 本项目**只有一个库**（`typenow.cn/typenow`），即生产库 | 已执行并核实：13 字段 + `uk_practice_session`(UNIQUE) + `idx_practice_session_user` 与迁移文件一致，0 行数据 |
| 5 | **AI 解析降级** | 失败时不再展示伪造内容，改为「暂不可用」+ 重试 | 已落地 |
| 6 | **审计盲区** | 把 `dependency_analysis` / `sentence_structure` 并入 `scripts/audit-course-data.ts` | 已落地 |

### 决策 5/6 落地时发现并修掉的问题

**① `dedupRequest` 与 `AbortController` 天生冲突（已修）**

原 `SentenceKnowledge` 一边用 `dedupRequest` 共享在途 Promise，一边把自己的
`AbortController` 信号传进那次 fetch。两者不能共存：任何一个调用者 abort，
就会把这唯一的在途请求打掉，而 dedup 表里仍留着那个注定失败的 Promise，
下一个调用者立刻收到同一个失败。

实测后果：React StrictMode 的「挂载→卸载→重挂载」序列下**必然**把「AI 讲解」
渲染成「网络连接失败」（浏览器实测 `net::ERR_ABORTED`，且全程只发出过一个请求）。
同样的机制会让**阶段 1 新加的「重试」按钮在请求进行中点击时必然失效**。

修法：去掉 per-caller abort，改用本地 `cancelled` 标记忽略结果，请求跑完即可
（服务端有 `sentence_knowledge` 缓存，多跑的一次会命中缓存）。修后实测
StrictMode 下**只发出 1 个请求**（原为 2 个，其一被中断），且返回 200。
已在 `src/lib/dedup.ts` 顶部写明这个坑，避免下次再踩。

**② `sentence_knowledge_cache` 这个表名不存在**

CLAUDE.md 与旧注释写的是 `sentence_knowledge_cache`，实际表名是
**`sentence_knowledge`**（`src/lib/db/schema.ts:328`）。按文档写的 SQL 会直接报表不存在。

**③ 缓存命中先于 key 检查，这是对的**

未配置 key 时，**已缓存**的句子仍能正常返回 200 与真实解析内容——因为缓存查询
在未配置检查之前。只有缓存未命中才会得到 503。这是刻意保留的行为：
缓存里是真实 AI 产出，不是伪造内容，没有理由因为没 key 就不给看。
（验证时首次误判为缺陷，实为测试选到了已缓存句。）

**④ 先前「本地没有 DeepSeek key」的判断是错的**

`DEEPSEEK_API_KEY` 实际已配置：直接请求接口返回 200 与完整真实解析。
阶段 1 记录里把它当成「本地环境缺 key」属于误判，据此得出的
「`Ctrl+/` 会展示 mock 文本」的真实原因是 ① 的中断 bug，而非缺 key。

### 决策 2 的衍生约束（转向自建内容）

选定 A 后，内容替换成为**有前置条件**的工作，需在阶段 3 前明确：

- **不能立刻停用现有 46 万句**。它撑起当前全部可达句（461,801），撤掉等于课程清空。
- 因此现实路径是**增量替换**：新课程用自建内容，存量课程按热度/质量分批重做。
- 阶段 3 的 D5/D6（难度 preset + i+1 编排）本来就卡在 `chunks` 覆盖率 5%，**这两件事可以合并排期** —— 重做内容时顺带产出 chunks 与 `definition`，一次解决三个数据缺口。
- `definition` 覆盖率为 **0%**，意味着 C7 点词详情目前拿不到释义；自建链路应把释义作为必产字段。

---

## 六、审计盲区

1. ~~**`content-audit.json` 未覆盖 `dependency_analysis` / `sentence_structure`**~~ —— **已修**：两项已并入 `scripts/audit-course-data.ts`，不再需要临时 SQL。
2. **`wordGroups` 在 schema 中不存在**，若要做 C6 需先加列 + 补数。
3. **截图未核对 —— 已随决策 1 关闭**：视觉路线选了 A（克制、像练习册），不需要逐帧复刻句乐部，这 15 张截图的核对不再是前置条件。若日后改选 B，仍需换支持图像输入的模型，或提供关键页面的文字要点。
4. **`strengthen_sessions` / `writing_entries`** 两张表存在但无任何前端（PRD 1.2 已记录），归属待定。

---

## 附：本次实测 SQL 口径

```sql
-- 可达句基线（重复用于各字段覆盖率）
FROM sentences s
JOIN lessons l ON s.lesson_id = l.id
JOIN courses c ON l.course_id = c.id
WHERE c.is_published = 1

-- 依存树 / 成分标注
AND s.dependency_analysis IS NOT NULL   -- 438,902  ← 虚高：把空壳算作有值
-- 真实可画树的口径（阶段 1 修正）：
AND s.dependency_analysis IS NOT NULL
    AND JSON_LENGTH(JSON_EXTRACT(s.dependency_analysis, '$.nodes')) > 0   -- 263,873（57.1%）
AND s.sentence_structure  IS NOT NULL   --  80,011（79,948 数组非空，差 63 条是空数组）

-- 逐词与释义
AND JSON_LENGTH(IFNULL(s.words, JSON_ARRAY())) > 0              -- 335,159
AND JSON_CONTAINS_PATH(s.words,'one','$[*].phonetic') = 1       -- 335,159
AND JSON_CONTAINS_PATH(s.words,'one','$[*].definition') = 1     --       0
AND JSON_LENGTH(IFNULL(s.chunks, JSON_ARRAY())) > 0             --  22,878
```

> 注：`content-audit.json` 记录的 444,135 是 2026-09-22 快照，本次实测为 461,801，内容仍在增长；两份数字的差异不影响覆盖率结论。
