# 场景对话 `/strengthen/chat`

> AI 角色扮演文字对话，有意识地触发用户的薄弱点。

---

## 功能说明

| 项目 | 说明 |
|------|------|
| **AI 做什么** | 生成一个自然对话场景，AI 扮演角色引导对话 |
| **形式** | 文字聊天式对话，AI 有意识地在对话中触发用户的薄弱点 |
| **交互** | 用户用英语回复，AI 自然接话 + 暗含纠错 |
| **结尾** | 对话结束后 AI 给简短反馈 |

---

## 交互示例（薄弱点：过去时）

```
AI: Hey! How was your weekend? Did you do anything fun?

用户: I go to the park with my dog.

AI: Sounds nice! So you *went* to the park — what did you do there?
     ↑ 自然纠正，不打断对话
```

---

## 技术要点

- 每轮对话 1-3 次 API 调用
- 纠错方式：用 *italic* 隐式纠正，不中断对话
- 对话 6-8 轮后给出简短反馈
- 成本：≈ ¥0.05/次

---

## 路由

| 路由 | 说明 |
|------|------|
| `/strengthen/chat` | AI 场景对话 |
