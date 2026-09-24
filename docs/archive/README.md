# 归档文档

> 归档日期：2026-09-24

这里存放**已经执行完毕、或者已被新版本取代**的历史文档。

保留而不是删除的原因：这些文档记录了当初的调研过程、数据结构对照和取舍理由，
排查老数据或回溯「为什么当初这么设计」时仍然有用。但**不要把它们当作当前事实**——
里面的技术选型（Supabase / PostgreSQL / Vercel / OpenAI）大多已经过时。

当前有效文档请看 [docs/README.md](../README.md)。

---

## 清单

| 文档 | 原位置 | 归档原因 |
|------|--------|---------|
| [PRD-V2.md](PRD-V2.md) | 仓库根目录 | 产品主文档已被 [PRD_V3.md](../../PRD_V3.md) 取代 |
| [dev-plan.md](dev-plan.md) | `docs/` | 2026-05 制定的 30 天排期，早已走完 |
| [typenow-improvement-plan.md](typenow-improvement-plan.md) | `docs/` | 与数据导入方案、练习页对标矩阵重叠，结论已合并 |
| [julebu-import-plan.md](julebu-import-plan.md) | `docs/` | 句乐部数据导入已执行完毕；日常操作见 [julebu-import-guide.md](../julebu-import-guide.md) |
| [julebu-research.md](julebu-research.md) | `docs/` | 一次性竞品调研（147 个 JS chunk 逆向）；结论已沉淀进 [practice-page-alignment-matrix.md](../practice-page-alignment-matrix.md) |

---

## 归档时已经过时的关键结论

读这些文档时请自行做下面的替换，避免被误导：

| 文档里写的 | 实际情况（2026-09） |
|-----------|-------------------|
| Supabase (PostgreSQL) | MySQL + Drizzle ORM，`src/lib/supabase/` 已不存在 |
| Vercel 部署 | 自建服务器 `typenow.cn`，pm2 + nginx，`deploy.sh` 部署 |
| OpenAI GPT-4o-mini | DeepSeek API（`src/lib/llm.ts`） |
| Supabase Storage | 未使用对象存储；分享卡片为前端 Canvas 生成 |
| `user_achievements` 表 | 不存在（成就走 `check_ins` / `task_logs` / `diamond_logs`） |
| `profiles` 表 | 实际叫 `users` |
| `sentence_knowledge_cache` 表 | 实际叫 `sentence_knowledge` |
