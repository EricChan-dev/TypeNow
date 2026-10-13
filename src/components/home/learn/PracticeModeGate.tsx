"use client"

import { useEffect, useSyncExternalStore } from "react"
import {
  modeStorageKey,
  normalizePracticeMode,
  resolvePracticeMode,
} from "@/lib/practice-mode"
import { DictationPractice } from "./DictationPractice"

/**
 * `storage` 事件订阅。同标签页内我们自己是写入方（下面那个 effect），
 * 这里只需要覆盖**跨标签页**的改动，所以不必轮询也不必自造事件。
 * 订阅回调只在客户端被调用，`window` 一定存在。
 */
function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange)
  return () => window.removeEventListener("storage", onChange)
}

/** 服务端没有 `window.localStorage`，一律回落到 null（= 按默认模式渲染）。 */
function noServerSnapshot() {
  return null
}

/**
 * 按模式把练习页分发到不同的实现。
 *
 * 为什么需要这一层：参考站四种模式的界面差异大到无法共用一套 DOM，
 * 但**外壳只有一套** —— 所以四种模式全部走重写版 `DictationPractice`，
 * 各自传 `mode` 复用同一外壳，只有 `main` 分支里换一套填充。
 * （早期 `puzzle` / `learning` 曾暂走旧版 `LearnClient`，现已全部收编。）
 * 这一层只负责回答「现在该渲染哪一个」。
 *
 * 模式解析优先级与参考站一致：URL `?mode=` > localStorage > 默认听写。
 * URL 在服务端就能读到，所以 `urlMode` 由 server component 传进来；
 * localStorage 读不到（服务端没有 window），只能在挂载后补读。
 *
 * 水合一致性：用 `useSyncExternalStore` 而不是「effect 里 setState 补读」。
 * 它有两个快照 —— 服务端/水合期用 `getServerSnapshot`（null），
 * 水合完成后 React 自己切到 `getSnapshot`（读 localStorage）并按需重渲染，
 * 所以第一帧渲染结果与服务端 HTML 一致，不会有水合不匹配；
 * 同时它天然订阅 `storage`，跨标签页改模式也能跟上。
 * 早先那版在 effect 里 `setStoredMode(...)` 会被
 * `react-hooks/set-state-in-effect` 判为级联渲染（确实是多余的第二次渲染）。
 *
 * 两个实现都在**本文件里** import，而不是由 server component 当 props 传进来：
 * React Server Components 只能跨边界传可序列化的数据，函数不行。
 * 早先写成 `legacy={(m) => <LearnClient …/>}` 时，`next build` 能通过，
 * 但运行时抛 "Functions cannot be passed directly to Client Components"，
 * 整页被错误边界接管、白屏 —— 静态构建查不出来，只有真跑才会暴露。
 */
export function PracticeModeGate({
  urlMode,
  lessonId,
  courseId,
}: {
  urlMode?: string
  lessonId: string
  courseId: string
}) {
  const storedMode = useSyncExternalStore(
    subscribeStorage,
    () => {
      // URL 已经明确指定模式时不必看 localStorage：URL 优先级更高，
      // 读了也不会改变结果。顺带避免把 `storage` 订阅白搭上去。
      if (urlMode) return null
      try {
        return window.localStorage.getItem(modeStorageKey(lessonId))
      } catch {
        /* 隐私模式下 localStorage 不可用，回落到默认模式即可 */
        return null
      }
    },
    noServerSnapshot,
  )

  const mode = resolvePracticeMode({ urlMode, storedMode })

  // 记忆用户的选择。只记 URL 显式带来的模式：默认值不该被写成「用户选过听写」，
  // 否则用户从没选过模式，localStorage 里却已经有了一条记录。
  // 真切换一定走 URL（听写页两处入口都是整页跳转带 `&mode=`），
  // 所以这里是唯一的写入点；`DictationPractice` 里那段无条件写入已删除，
  // 否则它会抢先把自己的 "dictation" 覆盖掉用户存的选择，恢复路径就断了。
  useEffect(() => {
    if (!urlMode) return
    try {
      window.localStorage.setItem(modeStorageKey(lessonId), normalizePracticeMode(urlMode))
    } catch {
      /* ignore */
    }
  }, [urlMode, lessonId])

  if (mode === "dictation") {
    return <DictationPractice courseId={courseId} lessonId={lessonId} />
  }
  if (mode === "speaking") {
    /*
      口语模式复用**同一个练习外壳**，只把内部内容换成跟读界面。
      参考站也是这么做的：练习页只有一份外壳，`practice.js:4421-4423` 在口语
      模式下执行 `initSpeakingMode(document.getElementById('practiceContent'), …)`，
      顶栏 / 进度条 / 计时器 / 底部工具栏全部保留。所以这里传 `mode` 而不是
      挂一个新页面 —— 另起满屏组件会让顶栏、模式切换器、底栏一起消失。
    */
    return <DictationPractice courseId={courseId} lessonId={lessonId} mode={mode} />
  }
  if (mode === "puzzle") {
    /*
      拼图（拼拼乐）模式同样复用外壳，而且比口语更彻底：参考站
      `initInputs()`（practice.js:6217-6220）只是把 `#inputContainer` 的内容
      换成词按钮，连中文提示条与 `#resultMessage` 结果条都留着 ——
      所以本仓也让 `DictationPractice` 来承载，只是它的 `main` 分支里换一套
      填充。顶栏 / 进度条 / 模式切换器 / 底栏与听写完全一致。
    */
    return <DictationPractice courseId={courseId} lessonId={lessonId} mode={mode} />
  }
  if (mode === "learning") {
    /*
      学习模式同样复用外壳。参考站 `loadCurrentSentence()` 的学习模式分支
      （practice.js:4216）只把 `main#practiceContent` 换成 `.learning-container`，
      顶栏 / 进度条 / 计时器 / 模式切换器 / 底部工具栏全部保留 —— 与口语、拼图
      一模一样。学习模式与其余三种的差别只在**何时算完成**：它是「渲染即完成」
      （practice.js:4400），且永不自动跳转。
    */
    return <DictationPractice courseId={courseId} lessonId={lessonId} mode={mode} />
  }

  /*
    四种模式在上面全部 return 了，而 `PRACTICE_MODES` 恰好就是这四个
    （`src/lib/practice-mode.ts:12`），`resolvePracticeMode` 不可能返回别的值 ——
    所以 `mode` 到这里已被 TS 收窄成 `never`，不需要兜底分支。

    这里曾经有一行 `return <LearnClient … />`。它不是死代码清理时才没用的：
    自四种模式全部改走 `DictationPractice` 起，类型上它就已经不可达了 ——
    编译器能证明，但没人去删，于是连带 `LearnClient` 整棵树（14 个文件）一直
    留在仓库里被当成「可能还在用」。留着比删掉更危险：`analytics-events` 的
    触屏提示接线测试就是照着它写的，测的是永远不会执行的代码。
  */
  return null
}
