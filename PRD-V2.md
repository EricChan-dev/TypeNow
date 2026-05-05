# TypeNow（码上英语）产品需求文档 V2.0

---

## 产品信息

| 项目 | 内容 |
|------|------|
| **产品名** | 码上英语 |
| **英文名** | TypeNow |
| **域名** | typenow.cn |
| **Slogan** | 码上一小句，人生一大步 |
| **定位** | 以「中译英逐词打字练习」为入口，以「智能复习 + AI 强化训练」为壁垒的英语学习工具 |
| **平台** | Web 端（桌面优先，移动端响应式适配） |
| **目标市场** | 中国大陆 |

> **TypeNow = 句乐部的打字练习入口 + 智能复习系统 + AI 强化训练。不只刷句子，更要记住句子。**

---

## 三层架构

```
┌──────────────────────────────────────────────────┐
│   Layer 1: 打字练习（引流 · 获客 · 激活）           │
│   ┌──────────────────────────────────────────┐    │
│   │ 中译英 → 逐词敲击 → 规则判分 → 即时反馈    │    │
│   │ 场景选择 → 键盘流畅 → 连击数字 → 等级称号  │    │
│   └──────────────────────────────────────────┘    │
│        │ 一轮结束后                               │
│        ▼                                          │
│   Layer 2: 智能复习（留存 · 价值）                  │
│   ┌──────────────────────────────────────────┐    │
│   │ 错误收集 → 艾宾浩斯间隔 → 混入正常练习       │    │
│   │ 连续 3 次 Perfect → 从复习队列移除           │    │
│   └──────────────────────────────────────────┘    │
│        │ 用户触发 / 系统提示                      │
│        ▼                                          │
│   Layer 3: AI 强化训练（变现 · 壁垒）              │
│   ┌──────────────────────────────────────────┐    │
│   │ AI 分析薄弱点 → 用户自选形式               │    │
│   │ ├─ 出题练习：生成针对性题目                 │    │
│   │ ├─ 场景对话：AI 角色扮演文字对话            │    │
│   │ └─ 写一段：AI 批改写作                     │    │
│   └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

> **用户因为打字练习而来，因为「学了不会忘」而留下，因为 AI 强化训练而付费。**

---

## 快速导航

### 📄 页面需求

| 页面 | 路由 | 文档 |
|------|------|------|
| 全局设计系统 | - | [00-global-design](docs/pages/00-global-design.md) |
| 未登录首页 | `/` | [01-landing](docs/pages/01-landing.md) |
| 登录页 | `/login` | [02-login](docs/pages/02-login.md) |
| 已登录首页 | `/home` | [03-home-dashboard](docs/pages/03-home-dashboard.md) |
| 打字练习 | `/practice` | [04-practice](docs/pages/04-practice.md) |
| 练习结果 | `/practice/result` | [05-practice-result](docs/pages/05-practice-result.md) |
| AI 出题练习 | `/strengthen/quiz` | [06-strengthen-quiz](docs/pages/06-strengthen-quiz.md) |
| 场景对话 | `/strengthen/chat` | [07-strengthen-chat](docs/pages/07-strengthen-chat.md) |
| 写作练习 | `/strengthen/write` | [08-strengthen-write](docs/pages/08-strengthen-write.md) |
| 批改报告 | `/write/report` | [09-write-report](docs/pages/09-write-report.md) |
| 个人主页 | `/profile` | [10-profile](docs/pages/10-profile.md) |
| 学习历史 | `/profile/history` | [11-profile-history](docs/pages/11-profile-history.md) |
| 设置页 | `/profile/settings` | [12-settings](docs/pages/12-settings.md) |
| 定价页 | `/pricing` | [13-pricing](docs/pages/13-pricing.md) |
| 分享卡片 | `/share/card` | [14-share-card](docs/pages/14-share-card.md) |

### 📐 架构 & 策略

| 文档 | 说明 |
|------|------|
| [技术架构](docs/architecture.md) | 技术选型 · 数据库 · AI Prompt · 成本 |
| [策略文档](docs/strategy.md) | 市场 · 用户 · 定价 · 内容 · 获客 · 风险 · 迭代 |
| [开发计划](docs/dev-plan.md) | 30天里程碑 · 每日任务 · 成功指标 |

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-29 | 初稿（被否决） |
| V2.0 | 2026-04-29 | 重构：三层架构、去游戏化、纯键盘流、Web 桌面优先 |
| V2.1 | 2026-05-01 | 文档拆分：页面需求拆为 15 个子文档，目录归类清理 |
