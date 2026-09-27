# 数据库目录说明

> 本目录前身是 `supabase/`，是 Supabase 时期的命名遗留。2026-09-26 已重命名为 `db/`。

## 权威顺序

| 位置 | 作用 |
|---|---|
| `src/lib/db/schema.ts` | **日常改结构的地方**（Drizzle 定义）。e2e 测试库由 `drizzle-kit push` 从这里生成 |
| `schema-snapshot.sql` | **线上实际结构的只读快照**（仅结构无数据），用于比对 |
| `migrations/*.sql` | 已对线上执行过的增量 DDL |

**改结构时的约束**：`migrations/` 与 `schema.ts` 必须同步修改。e2e 走
`drizzle-kit push`（不读 `migrations/`），生产走手工执行 `migrations/`，
两条路径只有靠人工保持一致。

**新增表必须显式写排序规则**：`DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`。

不写的后果（2026-09-27 实际踩到，排查了很久）：MySQL 8 的服务器默认是
`utf8mb4_0900_ai_ci`，于是新表与既有表（含 `users`）**排序规则不一致**。一旦有查询
把两张表 JOIN 起来比较字符串列，MySQL 直接报
`ERROR 1267 Illegal mix of collations ... for operation '='`，表现为
**某个页面莫名 500**，而服务端日志里往往看不到有用信息（错在驱动层就抛了）。

当时生产库里就躺着 4 张这种表（`post_likes` / `practice_sessions` /
`task_logs` / `user_feedback`），直到新写的后台反馈接口做了
`user_feedback LEFT JOIN users` 才炸出来（见 `00021_unify_collation.sql`）。

⚠️ **e2e 抓不到这类问题**：它的库是 `drizzle-kit push` 一次性生成的，所有表排序规则
天然一致。所以只能靠核对线上库：

```sql
SELECT table_collation, COUNT(*) AS tables
FROM information_schema.tables
WHERE table_schema='typenow' AND table_type='BASE TABLE'
GROUP BY table_collation;
-- 只应有一行；出现第二行就说明漂移了
```

## 关于被删除的 10 个文件

2026-09-26 删除了 `init-all.sql` 与 `migrations/00001`–`00008`、`00010`，
共 10 个文件。原因：**它们是 PostgreSQL DDL，不是 MySQL**。

判定依据（这些文件里没有任何 MySQL 特征，却大量出现 PG 专有语法）：

- `auth.users`、`public.` schema、`CREATE POLICY` / `ROW LEVEL SECURITY`
- `UUID`、`gen_random_uuid()`、`JSONB`

把它们当 MySQL 迁移执行会直接报错。而当时的文档（`CLAUDE.md`、`README.md`、
`docs/architecture.md`）却写着「`db/migrations/*.sql` 里面是 MySQL DDL，
新增迁移后需在生产库手动执行」——照着做会在 10 个文件里踩空。

删除后 SQL 级别的结构记录由 `schema-snapshot.sql` 接管。
**如需查阅原文**，git 历史里仍在：

```bash
git show <旧提交>:supabase/migrations/00001_initial_schema.sql
```

## 现存 4 个迁移（均为 MySQL）

| 文件 | 内容 |
|---|---|
| `00009_tasks_feed_feedback.sql` | `task_logs` / `posts` / `user_feedback` 等 |
| `00011_practice_sessions.sql` | 练习会话恢复槽位 |
| `00012_trial_claim.sql` | `users.trial_claimed_at`（体验会员一次性领取）+ 存量回填 |
| `00013_invite_purchase.sql` | `task_logs.task_type` 追加 `invite_purchase`、幂等键改为 `(task_type, ref_id)` |

编号不连续是正常的（中间的是被删掉的 PG 文件）。**不要为了连续而重排编号**：
文档与提交信息里都按编号引用过这些文件。

## 重新生成结构快照

只读操作，在服务器上以 `.env.local` 的 `DATABASE_URL` 执行：

```bash
mysqldump --no-data --skip-comments --single-transaction --routines --triggers typenow > schema-snapshot.sql
```

## 迁移是手工执行的

仓库没有任何迁移执行器：`package.json` 无 migrate 脚本、`.github/` 下无 workflows、
`deploy.sh` 不含 SQL 步骤。新增迁移后需在生产库手动执行，执行前先备份。
