# TypeNow 文档索引

> 最后更新：2026-05-01

---

## 快速开始

| 你想做什么 | 看这里 |
|-----------|--------|
| 了解产品全貌 | [PRD-V2.md](../PRD-V2.md) — 三层架构 + 完整导航 |
| 看某个页面的设计 | [pages/](pages/) — 15 个页面需求子文档 |
| 了解技术方案 | [architecture.md](architecture.md) — 技术选型 + 数据库 + AI |
| 看定价和市场策略 | [strategy.md](strategy.md) |
| 看开发排期 | [dev-plan.md](dev-plan.md) — 30 天每日任务 |

---

## 目录结构

```
TypeNow/
├── PRD-V2.md                        # 产品主文档（索引版）
├── docs/
│   ├── README.md                    # 你在这里
│   ├── architecture.md              # 技术架构
│   ├── strategy.md                  # 策略文档
│   ├── dev-plan.md                  # 30天开发计划
│   └── pages/                       # 各页面详细需求
│       ├── 00-global-design.md      # 全局设计系统
│       ├── 01-landing.md            # 未登录首页
│       ├── 02-login.md              # 登录页
│       ├── 03-home-dashboard.md     # 已登录首页
│       ├── 04-practice.md           # 打字练习（最核心）
│       ├── 05-practice-result.md    # 练习结果
│       ├── 06-strengthen-quiz.md    # AI出题
│       ├── 07-strengthen-chat.md    # AI对话
│       ├── 08-strengthen-write.md   # AI写作
│       ├── 09-write-report.md       # 批改报告
│       ├── 10-profile.md            # 个人主页
│       ├── 11-profile-history.md    # 学习历史
│       ├── 12-settings.md           # 设置
│       ├── 13-pricing.md            # 定价页
│       └── 14-share-card.md         # 分享卡片
├── specs/                           # 早期设计稿
│   └── practice-page.md
└── src/                             # 👈 代码写这里（待创建）
```

---

## 开发时的打开顺序

如果你要开始写代码，建议按这个顺序对照文档：

1. `00-global-design.md` — 先把颜色/字体/间距定好
2. `01-landing.md` + `02-login.md` — 先做未登录用户看到的页面
3. `04-practice.md` — 核心页面，最重要的
4. `05-practice-result.md` — 打字完的结果页
5. `03-home-dashboard.md` + `10-profile.md` — 用户系统
6. `06-08` — AI 强化功能
7. `13-pricing.md` + `14-share-card.md` — 变现 + 传播
