# TypeNow 文档索引

> 最后更新：2026-09-24

`docs/` 只放**当前有效**的文档。已经执行完毕或已被取代的历史文档统一移到
[archive/](archive/README.md)。

---

## 快速导航

| 你想了解 | 看这里 |
|---------|--------|
| 产品全貌、功能规划、路线图 | [../PRD_V3.md](../PRD_V3.md) |
| 技术架构、数据模型、AI 与部署 | [architecture.md](architecture.md) |
| 练习页与句乐部的差距、阶段规划、**已拍板决策** | [practice-page-alignment-matrix.md](practice-page-alignment-matrix.md) |
| 市场、用户、定价、获客、风险 | [strategy.md](strategy.md) |
| 各页面详细需求（15 篇） | [pages/](pages/) |
| 页面设计稿与交付规格 | [../specs/practice-page.md](../specs/practice-page.md) |
| 句乐部数据导入的**日常操作** | [julebu-import-guide.md](julebu-import-guide.md) |
| 本地开发、命令、踩坑清单 | [../CLAUDE.md](../CLAUDE.md)、[../AGENTS.md](../AGENTS.md) |
| 已归档的历史文档 | [archive/](archive/README.md) |

---

## 目录结构

```
TypeNow/
├── PRD_V3.md                       # 产品主文档（当前版本）
├── README.md                       # 项目介绍 + 快速开始
├── CLAUDE.md / AGENTS.md           # 给 AI 编码助手的仓库指南
├── docs/
│   ├── README.md                   # 你在这里
│   ├── architecture.md             # 技术架构（当前真实系统）
│   ├── strategy.md                 # 市场与定价策略
│   ├── practice-page-alignment-matrix.md  # 练习页对标句乐部：差距 / 阶段 / 决策
│   ├── julebu-import-guide.md      # 内容导入操作手册
│   ├── pages/                      # 15 篇页面级需求文档
│   └── archive/                    # 已归档（PRD-V2、30天计划、竞品调研…）
├── specs/
│   ├── practice-page.md            # 练习页交付规格（含交互时序）
│   ├── practice-page-20260430-221700.pen   # 设计稿源文件
│   ├── axure/                      # 登录页原型
│   └── images/
├── src/                            # 应用代码
├── scripts/                        # 内容审计 / 导入 / 运维脚本
└── supabase/migrations/            # MySQL DDL（目录名为历史遗留）
```

---

## 文档定位说明（避免重复维护）

| 文档 | 负责什么 | **不**负责什么 |
|------|---------|--------------|
| `PRD_V3.md` | 产品要做什么、优先级 | 具体技术实现 |
| `docs/pages/*` | 单页的信息结构与交互 | 全局技术方案 |
| `specs/practice-page.md` | 练习页的像素级/时序级规格 | 排期与决策记录 |
| `practice-page-alignment-matrix.md` | 现状差距、阶段拆分、决策台账 | 重复描述页面设计 |
| `docs/architecture.md` | 系统怎么搭、数据怎么存 | 产品需求 |

改需求前先确认改哪一层；**技术事实以代码为准**，架构文档与代码冲突时以代码为准并回修文档。

---

## 阅读顺序建议

**新加入的工程师**：`README.md` → `docs/architecture.md` → `CLAUDE.md`（踩坑清单）
→ `docs/pages/04-practice.md` + `specs/practice-page.md`（核心链路）

**要动练习页**：`practice-page-alignment-matrix.md`（先看已拍板的决策，别重复讨论）
→ `specs/practice-page.md` → `src/components/home/learn/LearnClient.tsx`

**要动数据/内容**：`docs/architecture.md` §四 → `docs/julebu-import-guide.md`
→ `pnpm audit:content` 先看现状再动手

---

## 历史文档

已归档：PRD-V2、30 天开发计划、句乐部竞品调研、数据导入方案、早前的改进计划。
清单与「归档时已过时的结论」对照表见 [archive/README.md](archive/README.md)。
