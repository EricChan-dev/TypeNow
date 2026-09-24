/**
 * 「打开 AI 助手」的请求通道。
 *
 * 存在的理由：AI 助手面板挂在首页 layout 上，而练习页是全屏沉浸界面 ——
 * 浮在右下角的按钮会盖住练习 UI，所以按钮在练习页必须隐藏。但练习页又最需要
 * 这个老师（材料里 C12 的原话是「随时有一个英语老师在旁边」）。
 *
 * 折中：练习页不放浮窗按钮，改为 Ctrl+/ 打开讲解面板，面板里的「问小码」通过
 * 这条通道请 layout 上的面板打开自己。用具名事件而不是把 open 状态提到 Context，
 * 是因为全站约定「不用 React Context 做全局状态」。
 */

const listeners = new Set<() => void>()

/** 请求打开 AI 助手面板。没有订阅者时静默忽略（例如面板未挂载）。 */
export function requestOpenAiChat(): void {
  for (const listener of listeners) listener()
}

/** 订阅打开请求，返回取消订阅函数。 */
export function subscribeOpenAiChat(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
